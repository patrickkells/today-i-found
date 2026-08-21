import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { findDuplicates, validateEdition } from "./curation.js";
import { applyFeedbackTieBreak, selectPersonalizedItems } from "./editorial-ranking.js";
import { publicDiscoveryStats, validateCandidateLedger } from "./candidate-ledger.js";
import { auditEditionSources } from "./source-audit.js";

export function publicationErrors(edition, history, { candidatePool = false } = {}) {
  const errors = validateEdition(edition, { candidatePool }).map((message) => `validation: ${message}`);
  const priorItems = history.flatMap((previous) => {
    if (previous.date === edition.date) return [];
    return (previous.items ?? []).map((item) => ({ ...item, editionDate: previous.date }));
  });

  for (const item of edition.items ?? []) {
    for (const match of findDuplicates(item, priorItems, edition.date)) {
      errors.push(`duplicate: ${item.id} matches ${match.item.id} via ${match.reasons.join(", ")}`);
    }
  }
  return errors;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readHistory(directory) {
  try {
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    return Promise.all(files.map((file) => readJson(path.join(directory, file))));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function feedbackFromOptions({ feedbackFile, feedbackUrl, curatorToken, fetchImpl }) {
  if (feedbackFile) return readJson(feedbackFile);
  if (!feedbackUrl) return {};
  if (!curatorToken) throw new Error("CURATOR_TOKEN is required with --feedback-url.");
  const response = await fetchImpl(feedbackUrl, {
    headers: { authorization: `Bearer ${curatorToken}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Feedback summary request failed: ${response.status}.`);
  return response.json();
}

async function registerEdition(edition, registerUrl, curatorToken, fetchImpl) {
  if (!curatorToken) throw new Error("CURATOR_TOKEN is required with --register-url.");
  const response = await fetchImpl(registerUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${curatorToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(edition),
  });
  if (!response.ok) throw new Error(`Edition registration failed: ${response.status}.`);
}

function nextManifest(previous, edition) {
  const editions = [...new Set([...(previous?.editions ?? []), edition.date])].sort();
  return {
    schemaVersion: previous?.schemaVersion ?? 1,
    product: previous?.product ?? "today i found",
    timezone: edition.timezone,
    latestEdition: editions.at(-1),
    editions,
  };
}

function publicationFailure(errors) {
  return new Error(`Publication blocked:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

export async function publishEdition({
  input,
  outputDirectory = "data/editions",
  historyDirectory = outputDirectory,
  manifestFile = path.join(path.dirname(outputDirectory), "manifest.json"),
  dryRun = false,
  feedbackFile,
  ledgerFile,
  feedbackUrl,
  registerUrl,
  curatorToken,
  auditSources = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const candidate = await readJson(input);
  const history = await readHistory(historyDirectory);
  const schemaThree = candidate.schemaVersion === 3;
  let ledger = null;
  if (schemaThree) {
    if (!ledgerFile) throw publicationFailure(["ledger: schema 3 publication requires a completed candidate ledger."]);
    ledger = await readJson(ledgerFile);
    const ledgerErrors = validateCandidateLedger(ledger, candidate);
    if (ledgerErrors.length) throw publicationFailure(ledgerErrors.map((error) => `ledger: ${error}`));
    if (!(candidate.items ?? []).length) {
      return { edition: null, dryRun, skipped: true, reason: "no-qualifying-candidates" };
    }
  }
  const initialErrors = publicationErrors(candidate, history, { candidatePool: schemaThree });
  if (initialErrors.length) throw publicationFailure(initialErrors);
  if (auditSources) {
    const sourceErrors = await auditEditionSources(candidate, { fetchImpl });
    if (sourceErrors.length) throw publicationFailure(sourceErrors.map((error) => `source audit: ${error}`));
  }

  const feedback = await feedbackFromOptions({
    feedbackFile,
    feedbackUrl,
    curatorToken,
    fetchImpl,
  });
  let selection = null;
  let edition;
  if (schemaThree) {
    selection = selectPersonalizedItems(candidate.items, feedback, {
      maxItems: 40,
      explorationRatio: 0.2,
    });
    edition = {
      ...candidate,
      items: selection.items,
      discoveryStats: publicDiscoveryStats(ledger, {
        publishedItems: selection.items.length,
        explorationItems: selection.stats.explorationItems,
      }),
    };
  } else edition = applyFeedbackTieBreak(candidate, feedback);
  const errors = publicationErrors(edition, history);
  if (errors.length) throw publicationFailure(errors);
  const ledgerPreview = ledger ? withSelectionResults(ledger, edition.items) : null;
  if (dryRun) return { edition, dryRun: true, ledgerPreview };

  if (registerUrl) await registerEdition(edition, registerUrl, curatorToken, fetchImpl);

  let previousManifest = null;
  try {
    previousManifest = await readJson(manifestFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(path.dirname(manifestFile), { recursive: true });
  await writeFile(path.join(outputDirectory, `${edition.date}.json`), `${JSON.stringify(edition, null, 2)}\n`);
  await writeFile(manifestFile, `${JSON.stringify(nextManifest(previousManifest, edition), null, 2)}\n`);
  if (ledgerFile && ledgerPreview) await writeFile(ledgerFile, `${JSON.stringify(ledgerPreview, null, 2)}\n`);
  return { edition, dryRun: false, ledgerPreview };
}

function withSelectionResults(ledger, publishedItems) {
  const published = new Map(publishedItems.map((item, index) => [item.id, { rank: index + 1, mode: item.curation?.selectionMode ?? "editorial" }]));
  return {
    ...ledger,
    candidates: (ledger.candidates ?? []).map((candidate) => {
      if (candidate.decision?.status !== "eligible") return candidate;
      const selected = published.get(candidate.decision.itemId);
      return {
        ...candidate,
        selection: selected
          ? { status: "published", ...selected }
          : { status: "not-selected", reason: "not-selected" },
      };
    }),
  };
}
