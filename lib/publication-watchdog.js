import { readFile } from "node:fs/promises";
import path from "node:path";
import { createProcessSpawner, verifyChatGptAuthentication } from "../report-companion/codex-runner.js";
import { readValidTerminalRunReceipt } from "./publication-run-receipt.js";
import { loadWatchdogCredentials } from "./watchdog-credentials.js";
import { validateEdition } from "./curation.js";
import { prepareWatchdogFeedbackBoundary } from "./watchdog-feedback-boundary.js";

export function todayInNewYork(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isWatchdogEligible(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 7 * 60 + 15;
}

export function buildCurationInvocation({ projectRoot, codexPath = "codex" }) {
  return {
    command: codexPath,
    args: [
      "--search",
      "exec",
      "--model", "gpt-5.6-sol",
      "--config", 'model_reasoning_effort="high"',
      "--sandbox", "workspace-write",
      "--approve-for-me",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "-C", projectRoot,
      "-",
    ],
  };
}

export function watchdogEnvironment(environment) {
  const clean = {};
  for (const key of ["HOME", "CODEX_HOME", "PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "SHELL", "USER", "LOGNAME"]) {
    if (typeof environment[key] === "string") clean[key] = environment[key];
  }
  return clean;
}

const spawnProcess = createProcessSpawner();

export async function runAuthenticatedCuration({ invocation, prompt, projectRoot, environment = process.env, signal }) {
  const env = watchdogEnvironment(environment);
  await verifyChatGptAuthentication(() => spawnProcess({
    command: invocation.command,
    args: ["login", "status"],
    stdin: "",
    env,
    cwd: projectRoot,
    signal,
  }));
  return spawnProcess({ ...invocation, stdin: prompt, env, cwd: projectRoot, signal });
}

function watchdogPrompt(date, instruction, boundary) {
  const feedback = boundary
    ? ` Protected feedback was fetched and validated by the trusted watchdog parent. Use --feedback ${boundary.feedbackFile} for dry-run and live publisher commands. For the live publisher command use --registration-proxy-url ${boundary.registrationProxyUrl}. Do not use --feedback-url, --register-url, protected endpoint variables, or CURATOR_TOKEN.`
    : " Feedback is not configured; do not use protected feedback or registration options.";
  return `The local watchdog already owns and renews the publication gate for ${date}. Skip the instruction's claim, heartbeat, completion, and failure commands. Use the existing claim ID from the TODAY_I_FOUND_CLAIM_ID environment variable only for ownership assertions and the terminal receipt command. The watchdog validates the receipt and records the gate result. Never print the claim ID or credentials.${feedback}\n\n${instruction}`;
}

export async function hasValidLocalEdition({ projectRoot, date }) {
  try {
    const [edition, manifest] = await Promise.all([
      readFile(path.join(projectRoot, "data", "editions", `${date}.json`), "utf8").then(JSON.parse),
      readFile(path.join(projectRoot, "data", "manifest.json"), "utf8").then(JSON.parse),
    ]);
    return edition.date === date && validateEdition(edition).length === 0
      && manifest.latestEdition === date && Array.isArray(manifest.editions) && manifest.editions.includes(date);
  } catch { return false; }
}

export function adaptWatchdogInstruction(instruction, { nodePath, packageManagerPath }) {
  return instruction
    .replace(/\bnode (?=scripts\/)/g, () => `${nodePath} `)
    .replace(/\b(?:npm|pnpm) run\b/g, () => `${packageManagerPath} run`);
}

export async function runPublicationWatchdog({
  projectRoot,
  date = todayInNewYork(),
  gate,
  readInstruction = () => readFile(path.join(projectRoot, "docs", "curator-scheduled-task.md"), "utf8"),
  runCodex = runAuthenticatedCuration,
  codexPath = process.env.CODEX_PATH || "codex",
  heartbeatIntervalMs = 5 * 60 * 1_000,
  feedbackEnabled = false,
  eligible = () => isWatchdogEligible(),
  loadCredentials = (options) => loadWatchdogCredentials(options),
  prepareFeedbackBoundary = prepareWatchdogFeedbackBoundary,
  localEditionExists = hasValidLocalEdition,
  environment = process.env,
  nodePath = process.env.TODAY_I_FOUND_NODE_PATH || process.execPath,
  packageManagerPath = process.env.TODAY_I_FOUND_PACKAGE_MANAGER_PATH || "pnpm",
  readReceipt = ({ claimId }) => readValidTerminalRunReceipt({ projectRoot, gate, date, claimId, feedbackEnabled }),
}) {
  if (!eligible()) return { status: "noop", date, reason: "before-eastern-window" };
  if (await localEditionExists({ projectRoot, date })) return { status: "noop", date, reason: "existing-edition" };
  const claim = await gate.claim({ date, owner: "watchdog" });
  if (!claim.claimed) return { status: "noop", date, reason: claim.reason };

  const invocation = buildCurationInvocation({ projectRoot, codexPath });
  const controller = new AbortController();
  let leaseFailure;
  let renewalPending = false;
  const heartbeat = setInterval(async () => {
    if (renewalPending || leaseFailure) return;
    renewalPending = true;
    try {
      await gate.renew({ date, claimId: claim.claimId });
    } catch (error) {
      leaseFailure = error;
      controller.abort(error);
    } finally {
      renewalPending = false;
    }
  }, heartbeatIntervalMs);
  heartbeat.unref?.();
  const safeFail = async (reason) => {
    try { await gate.fail({ date, claimId: claim.claimId, reason }); } catch { /* ownership was already lost */ }
  };
  let boundary;
  try {
    const credentials = await loadCredentials({ feedbackEnabled });
    if (feedbackEnabled) boundary = await prepareFeedbackBoundary({ projectRoot, date, gate, claimId: claim.claimId, credentials });
    const instruction = adaptWatchdogInstruction(await readInstruction(), { nodePath, packageManagerPath });
    const processResult = await runCodex({
      invocation,
      prompt: watchdogPrompt(date, instruction, boundary),
      projectRoot,
      signal: controller.signal,
      environment: { ...watchdogEnvironment(environment), TODAY_I_FOUND_CLAIM_ID: claim.claimId },
    });
    if (leaseFailure) {
      await safeFail("curation-failed");
      return { status: "failed", date, reason: "lease-lost" };
    }
    if (processResult.exitCode !== 0) {
      await safeFail("curation-failed");
      return { status: "failed", date, reason: "curation-failed", exitCode: processResult.exitCode };
    }
    let receipt;
    try {
      receipt = await readReceipt({ claimId: claim.claimId });
    } catch {
      await safeFail("verification-failed");
      return { status: "failed", date, reason: "verification-failed" };
    }
    if (feedbackEnabled && receipt.result === "published" && !boundary.registered()) {
      await safeFail("verification-failed");
      return { status: "failed", date, reason: "verification-failed" };
    }
    await gate.complete({ date, claimId: claim.claimId, result: receipt.result });
    return { status: "completed", date, result: receipt.result };
  } catch (error) {
    const reason = /authentication|sign in|chatgpt|credentials|keychain/i.test(error.message) ? "authentication-failed" : "curation-failed";
    await safeFail(reason);
    throw error;
  } finally {
    clearInterval(heartbeat);
    await boundary?.close();
  }
}
