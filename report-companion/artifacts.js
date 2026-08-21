import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function renderReportMarkdown(report) {
  const date = new Date(`${report.editionDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const lines = ["# today i found", "", `Today is ${date}. Here are the stories I kept from this edition.`, ""];
  for (const story of report.stories) {
    lines.push(`## ${story.title}`, "", ...story.paragraphs.flatMap((paragraph) => [paragraph, ""]));
  }
  lines.push("## Sources and coverage", "", "_This appendix is not part of the spoken narration._", "");
  for (const story of report.stories) {
    lines.push(`- **${story.title}** — ${story.sourceCoverage} source coverage — ${story.sourceUrl}`);
  }
  if (report.warnings.length) lines.push("", "### Warnings", "", ...report.warnings.map((warning) => `- ${warning}`));
  return `${lines.join("\n").trim()}\n`;
}

async function writeDurable(fileSystem, filePath, contents) {
  const handle = await fileSystem.open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(fileSystem, directory) {
  const handle = await fileSystem.open(directory, "r");
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function exists(fileSystem, filePath) {
  try { await fileSystem.stat(filePath); return true; }
  catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function createArtifactStore({ outputDir, now = () => new Date(), fileSystem = fsPromises }) {
  if (!outputDir) throw new Error("Report output directory is required");
  return {
    async save(report) {
      await fileSystem.mkdir(outputDir, { recursive: true, mode: 0o700 });
      const markdown = renderReportMarkdown(report);
      for (let version = 1; version <= 999; version += 1) {
        const suffix = String(version).padStart(3, "0");
        const basename = `${report.editionDate}-report-v${suffix}`;
        const finalDirectory = path.join(outputDir, basename);
        if (await exists(fileSystem, finalDirectory)
          || await exists(fileSystem, path.join(outputDir, `${basename}.md`))
          || await exists(fileSystem, path.join(outputDir, `${basename}.json`))) continue;
        const temporaryDirectory = path.join(outputDir, `.${basename}-${randomUUID()}.tmp`);
        const markdownPath = path.join(finalDirectory, `${basename}.md`);
        const jsonPath = path.join(finalDirectory, `${basename}.json`);
        const temporaryMarkdown = path.join(temporaryDirectory, `${basename}.md`);
        const temporaryJson = path.join(temporaryDirectory, `${basename}.json`);
        const saved = { ...report, artifactVersion: version, savedAt: now().toISOString() };
        await fileSystem.mkdir(temporaryDirectory, { mode: 0o700 });
        try {
          await writeDurable(fileSystem, temporaryMarkdown, markdown);
          await writeDurable(fileSystem, temporaryJson, `${JSON.stringify(saved, null, 2)}\n`);
          await syncDirectory(fileSystem, temporaryDirectory);
          try {
            await fileSystem.rename(temporaryDirectory, finalDirectory);
          } catch (error) {
            if (error.code === "EEXIST" || error.code === "ENOTEMPTY") continue;
            throw error;
          }
          try { await syncDirectory(fileSystem, outputDir); }
          catch (error) {
            await fileSystem.rm(finalDirectory, { recursive: true, force: true });
            throw error;
          }
          return { markdown, markdownPath, jsonPath, artifactVersion: version };
        } finally {
          await fileSystem.rm(temporaryDirectory, { recursive: true, force: true });
        }
      }
      throw new Error("No report artifact version is available");
    },
    async read(filePath) {
      const resolved = path.resolve(filePath);
      const root = `${path.resolve(outputDir)}${path.sep}`;
      if (!resolved.startsWith(root)) throw new Error("Artifact path is outside the report directory");
      return fileSystem.readFile(resolved);
    },
  };
}
