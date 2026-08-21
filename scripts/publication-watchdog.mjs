#!/usr/bin/env node
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicationRunGate } from "../lib/publication-run-gate.js";
import { runPublicationWatchdog } from "../lib/publication-watchdog.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gate = new PublicationRunGate({ rootDirectory: path.join(projectRoot, ".curation", "run-gates") });

async function requiredExecutable(name, value) {
  if (!path.isAbsolute(value ?? "")) throw new Error(`${name} path must be absolute`);
  try { await access(value, constants.X_OK); }
  catch { throw new Error(`${name} executable is unavailable`); }
  return value;
}

try {
  const nodePath = await requiredExecutable("Node", process.env.TODAY_I_FOUND_NODE_PATH);
  const packageManagerPath = await requiredExecutable("Package manager", process.env.TODAY_I_FOUND_PACKAGE_MANAGER_PATH);
  const codexPath = await requiredExecutable("Codex", process.env.CODEX_PATH);
  const feedbackSetting = process.env.TODAY_I_FOUND_FEEDBACK_ENABLED;
  if (feedbackSetting !== "0" && feedbackSetting !== "1") throw new Error("Feedback-enabled setting must be 0 or 1");
  const result = await runPublicationWatchdog({
    projectRoot,
    gate,
    nodePath,
    packageManagerPath,
    codexPath,
    feedbackEnabled: feedbackSetting === "1",
  });
  console.log(JSON.stringify(result));
  if (result.status === "failed") process.exitCode = 1;
} catch (error) {
  console.error(`Publication watchdog failed: ${error.message}`);
  process.exitCode = 1;
}
