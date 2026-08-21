#!/usr/bin/env node
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PairingStore } from "./pairing-store.js";
import { createSourceFetcher } from "./source-fetcher.js";
import { createCodexRunner } from "./codex-runner.js";
import { createArtifactStore } from "./artifacts.js";
import { createReportPipeline } from "./report-pipeline.js";
import { ReportJobManager } from "./job-manager.js";
import { createCompanionServer } from "./server.js";
import { startLoopbackCompanion } from "./runtime.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = process.env.TODAY_I_FOUND_STATE_DIR
  ? path.resolve(process.env.TODAY_I_FOUND_STATE_DIR)
  : path.join(homedir(), "Library", "Application Support", "today-i-found");
const outputDir = process.env.TODAY_I_FOUND_REPORT_DIR
  ? path.resolve(process.env.TODAY_I_FOUND_REPORT_DIR)
  : path.join(homedir(), "Documents", "today-i-found-reports");
const tempRoot = process.env.TODAY_I_FOUND_JOB_DIR
  ? path.resolve(process.env.TODAY_I_FOUND_JOB_DIR)
  : path.join(projectRoot, ".report-jobs");
const port = Number(process.env.TODAY_I_FOUND_PORT ?? 43_121);
const productionOrigin = process.env.TODAY_I_FOUND_PRODUCTION_ORIGIN || undefined;

if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("TODAY_I_FOUND_PORT must be a valid unprivileged port");

const pairingStore = new PairingStore({ stateDir });
const artifactStore = createArtifactStore({ outputDir });
const pipeline = createReportPipeline({
  fetchSource: createSourceFetcher(),
  codexRunner: createCodexRunner({ codexPath: process.env.CODEX_PATH || "codex" }),
  artifactStore,
  tempRoot,
});
const jobs = new ReportJobManager({ pipeline });
const server = createCompanionServer({
  pairingStore,
  jobs,
  editionsDir: path.join(projectRoot, "data", "editions"),
  productionOrigin,
  port,
});

await startLoopbackCompanion({ server, pairingStore, port });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
