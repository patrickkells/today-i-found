#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchAgentPlan } from "../lib/launch-agent-config.js";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function requiredOption(name) {
  const value = option(name);
  if (!value || value.startsWith("--")) throw new Error(`${name} is required and must name an absolute executable`);
  return value;
}

async function requireExecutable(label, executable) {
  if (!path.isAbsolute(executable)) throw new Error(`${label} path must be absolute`);
  try { await access(executable, constants.X_OK); }
  catch { throw new Error(`${label} executable is unavailable`); }
}

function launchctl(args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("launchctl", args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => code === 0 || allowFailure ? resolve() : reject(new Error(`launchctl ${args[0]} failed with exit code ${code}`)));
  });
}

const dryRun = process.argv.includes("--dry-run");
const nodePath = path.resolve(option("--node-path", process.execPath));
const packageManagerPath = requiredOption("--package-manager-path");
const codexPath = requiredOption("--codex-path");
const productionOrigin = option("--production-origin");
if (!productionOrigin || productionOrigin.startsWith("--")) throw new Error("--production-origin is required and must be a dedicated HTTPS origin");
await requireExecutable("Node", nodePath);
await requireExecutable("Package manager", packageManagerPath);
await requireExecutable("Codex", codexPath);
const plan = launchAgentPlan({
  homeDirectory: path.resolve(option("--home", homedir())),
  projectRoot: path.resolve(option("--project-root", defaultProjectRoot)),
  nodePath,
  packageManagerPath,
  codexPath,
  productionOrigin,
  uid: process.getuid(),
  feedbackEnabled: process.argv.includes("--feedback-enabled"),
});

if (!dryRun && process.platform !== "darwin") throw new Error("LaunchAgents can be installed only on macOS");
if (!dryRun) {
  await mkdir(plan.launchAgentsDirectory, { recursive: true, mode: 0o700 });
  await mkdir(plan.logDirectory, { recursive: true, mode: 0o700 });
}

for (const agent of plan.agents) {
  console.log(`launchctl bootout ${plan.domain} ${agent.file}`);
  if (!dryRun) await launchctl(["bootout", plan.domain, agent.file], { allowFailure: true });
  console.log(`write ${agent.file}`);
  if (dryRun) console.log(agent.contents.trimEnd());
  else await writeFile(agent.file, agent.contents, { mode: 0o600 });
  console.log(`launchctl bootstrap ${plan.domain} ${agent.file}`);
  if (!dryRun) await launchctl(["bootstrap", plan.domain, agent.file]);
}
