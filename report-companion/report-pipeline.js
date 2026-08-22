import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateStorySummaries } from "./report-schema.js";

const MODEL = "gpt-5.6-sol";
const REASONING = "high";
const PROMPT_VERSION = "tts-report-v1";

async function mapLimit(values, limit, operation) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      results[index] = await operation(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function retryOperation(operation, signal) {
  let firstError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (signal?.aborted) throw signal.reason ?? firstError ?? new Error("Report cancelled");
    try { return await operation(); } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      firstError ??= error;
      const maxAttempts = error?.code === "report_schema" ? 3 : 2;
      if (error?.retryable !== true || attempt >= maxAttempts) {
        error.cause ??= firstError === error ? undefined : firstError;
        throw error;
      }
    }
  }
  throw firstError;
}

async function runValidated(codexRunner, { phase, input, expectedIds, signal, recordUsage }) {
  let validationFeedback;
  return retryOperation(async () => {
    let response;
    const attemptInput = validationFeedback ? { ...input, validationFeedback } : input;
    try { response = await codexRunner.run({ phase, input: attemptInput, signal }); }
    catch (error) {
      if (error?.usage) recordUsage(error.usage);
      throw error;
    }
    if (response.usage) recordUsage(response.usage);
    try {
      return { response, stories: validateStorySummaries(response.stories, expectedIds) };
    } catch (error) {
      if (error?.retryable === true) validationFeedback = [error.message];
      throw error;
    }
  }, signal);
}

function editionFallback(item) {
  return [
    `Verified edition headline: ${item.title}`,
    `Verified edition summary: ${item.summary}`,
    `Publisher: ${item.source.publisher}`,
    `Publication date: ${item.publicationDate}`,
    `Verification date: ${item.source.verification.verifiedAt}`,
    `Evidence date basis: ${item.source.evidence.dateBasis}`,
  ].join("\n");
}

export function createReportPipeline({ fetchSource, codexRunner, artifactStore, tempRoot, now = () => new Date() }) {
  if (!fetchSource || !codexRunner || !artifactStore || !tempRoot) throw new Error("Report pipeline dependencies are required");
  return {
    async run({ edition, items, signal, onProgress = () => {}, onCommitStart = () => {}, jobId = randomUUID() }) {
      const jobDir = path.join(tempRoot, jobId);
      await mkdir(jobDir, { recursive: true, mode: 0o700 });
      const warningSlots = new Array(items.length);
      const usage = [];
      const recordUsage = (value) => usage.push(value);
      try {
        onProgress({ phase: "source-retrieval", completed: 0, total: items.length });
        let retrieved = 0;
        const prepared = await mapLimit(items, 3, async (item, index) => {
          if (signal?.aborted) throw signal.reason ?? new Error("Report cancelled");
          let sourceText;
          let sourceCoverage = "full";
          let finalUrl = item.source.url;
          try {
            const result = await fetchSource(item.source.url, { signal });
            sourceText = result.text;
            finalUrl = result.finalUrl;
          } catch (error) {
            if (signal?.aborted) throw signal.reason ?? error;
            sourceCoverage = "reduced";
            sourceText = editionFallback(item);
            warningSlots[index] = `${item.title}: the source could not be retrieved; the summary used verified edition facts only.`;
          }
          const sourcePath = path.join(jobDir, `${String(index + 1).padStart(2, "0")}-${item.id}.txt`);
          await writeFile(sourcePath, sourceText, { mode: 0o600 });
          retrieved += 1;
          onProgress({ phase: "source-retrieval", completed: retrieved, total: items.length });
          return {
            id: item.id,
            title: item.title,
            editionSummary: item.summary,
            publisher: item.source.publisher,
            publicationDate: item.publicationDate,
            verifiedAt: item.source.verification.verifiedAt,
            sourceCoverage,
            sourceText,
            sourceUrl: item.source.url,
            finalUrl,
          };
        });

        onProgress({ phase: "batch-summarization", completed: 0, total: items.length <= 4 ? 1 : Math.ceil(items.length / 5) });
        let stories;
        if (items.length <= 4) {
          const result = await runValidated(codexRunner, { phase: "summarize", input: { stories: prepared }, expectedIds: items.map(({ id }) => id), signal, recordUsage });
          stories = result.stories;
          onProgress({ phase: "batch-summarization", completed: 1, total: 1 });
        } else {
          const batches = [];
          for (let index = 0; index < prepared.length; index += 5) batches.push(prepared.slice(index, index + 5));
          let completed = 0;
          const draftBatches = await mapLimit(batches, 3, async (batch) => {
            const result = await runValidated(codexRunner, { phase: "summarize", input: { stories: batch }, expectedIds: batch.map(({ id }) => id), signal, recordUsage });
            completed += 1;
            onProgress({ phase: "batch-summarization", completed, total: batches.length });
            return result.stories;
          });
          const drafts = draftBatches.flat();
          onProgress({ phase: "editing", completed: 0, total: 1 });
          const edited = await runValidated(codexRunner, { phase: "edit", input: { drafts }, expectedIds: items.map(({ id }) => id), signal, recordUsage });
          stories = edited.stories;
          onProgress({ phase: "editing", completed: 1, total: 1 });
        }

        onProgress({ phase: "validation", completed: 0, total: 1 });
        const preparedById = new Map(prepared.map((item) => [item.id, item]));
        const reportStories = stories.map((story) => ({
          ...story,
          sourceUrl: preparedById.get(story.id).sourceUrl,
          sourceCoverage: preparedById.get(story.id).sourceCoverage,
        }));
        const selected = new Set(items.map(({ id }) => id));
        const report = {
          schemaVersion: 1,
          editionDate: edition.date,
          generatedAt: now().toISOString(),
          promptVersion: PROMPT_VERSION,
          model: MODEL,
          reasoningEffort: REASONING,
          execution: items.length <= 4 ? {
            strategy: "single-codex-worker",
            batchSize: items.length,
            maxConcurrentWorkers: 1,
            usesCodexSubagents: false,
          } : {
            strategy: "isolated-codex-worker-batches",
            batchSize: 5,
            maxConcurrentWorkers: 3,
            usesCodexSubagents: false,
          },
          voteSnapshot: {
            includedItemIds: [...selected],
            excludedItemIds: edition.items.map(({ id }) => id).filter((id) => !selected.has(id)),
          },
          sourceCoverage: reportStories.every(({ sourceCoverage }) => sourceCoverage === "full") ? "full" : "reduced",
          warnings: warningSlots.filter(Boolean),
          usage: usage.filter(Boolean).reduce((total, item) => ({
            inputTokens: total.inputTokens + (item.inputTokens ?? 0),
            outputTokens: total.outputTokens + (item.outputTokens ?? 0),
            totalTokens: total.totalTokens + (item.totalTokens ?? 0),
          }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
          stories: reportStories,
        };
        onProgress({ phase: "validation", completed: 1, total: 1 });
        if (signal?.aborted) throw signal.reason ?? new Error("Report cancelled");
        onCommitStart();
        onProgress({ phase: "saving", completed: 0, total: 1 });
        const artifact = await artifactStore.save(report);
        onProgress({ phase: "saving", completed: 1, total: 1 });
        return { jobId, report, ...artifact };
      } finally {
        await rm(jobDir, { recursive: true, force: true });
      }
    },
  };
}
