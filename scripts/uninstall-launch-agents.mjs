#!/usr/bin/env node
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchAgentPlan } from "../lib/launch-agent-config.js";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function launchctl(args) {
  return new Promise((resolve) => {
    const child = spawn("launchctl", args, { stdio: "ignore" });
    child.once("error", () => resolve());
    child.once("close", () => resolve());
  });
}

const dryRun = process.argv.includes("--dry-run");
const plan = launchAgentPlan({
  homeDirectory: path.resolve(option("--home", homedir())),
  projectRoot: path.resolve(option("--project-root", defaultProjectRoot)),
  nodePath: path.resolve(option("--node-path", process.execPath)),
  packageManagerPath: path.resolve(option("--package-manager-path", process.execPath)),
  codexPath: path.resolve(option("--codex-path", process.execPath)),
  productionOrigin: "https://today-i-found.pages.dev",
  uid: process.getuid(),
});

if (!dryRun && process.platform !== "darwin") throw new Error("LaunchAgents can be removed only on macOS");
for (const agent of [...plan.agents].reverse()) {
  console.log(`launchctl bootout ${plan.domain} ${agent.file}`);
  if (!dryRun) await launchctl(["bootout", plan.domain, agent.file]);
  console.log(`remove ${agent.file}`);
  if (!dryRun) await rm(agent.file, { force: true });
}
