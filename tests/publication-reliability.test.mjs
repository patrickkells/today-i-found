import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PublicationRunGate } from "../lib/publication-run-gate.js";
import {
  readValidTerminalRunReceipt,
  writeTerminalRunReceipt,
} from "../lib/publication-run-receipt.js";
import {
  adaptWatchdogInstruction,
  buildCurationInvocation,
  isWatchdogEligible,
  hasValidLocalEdition,
  runPublicationWatchdog,
  todayInNewYork,
  watchdogEnvironment,
} from "../lib/publication-watchdog.js";
import { launchAgentPlan } from "../lib/launch-agent-config.js";
import { loadWatchdogCredentials } from "../lib/watchdog-credentials.js";
import { prepareWatchdogFeedbackBoundary } from "../lib/watchdog-feedback-boundary.js";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const node = process.execPath;

function runScript(relativePath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [path.join(projectRoot, relativePath), ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
}

async function withTempDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "today-i-found-publication-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function responseAt(body, url, init = {}) {
  const response = new Response(body, { status: 200, ...init });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

test("the date-scoped gate permits one active owner and hides its claim ID from status", async () => {
  await withTempDirectory(async (directory) => {
    const gate = new PublicationRunGate({ rootDirectory: directory, now: () => new Date("2026-08-21T11:00:00.000Z") });
    const [first, second] = await Promise.all([
      gate.claim({ date: "2026-08-21", owner: "scheduled-task" }),
      gate.claim({ date: "2026-08-21", owner: "watchdog" }),
    ]);
    const claimed = [first, second].filter((result) => result.claimed);
    const rejected = [first, second].filter((result) => !result.claimed);

    assert.equal(claimed.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason, "active");
    const status = await gate.status({ date: "2026-08-21" });
    assert.deepEqual(status, {
      date: "2026-08-21",
      status: "active",
      owner: claimed[0].owner,
      attempt: 1,
      claimedAt: "2026-08-21T11:00:00.000Z",
      expiresAt: "2026-08-21T13:00:00.000Z",
    });
    assert.equal("claimId" in status, false);
  });
});

test("a stale active gate is atomically recovered while a completed gate prevents duplicate publication", async () => {
  await withTempDirectory(async (directory) => {
    let currentTime = new Date("2026-08-21T11:00:00.000Z");
    const gate = new PublicationRunGate({ rootDirectory: directory, staleAfterMs: 60_000, now: () => currentTime });
    const first = await gate.claim({ date: "2026-08-21", owner: "scheduled-task" });

    currentTime = new Date("2026-08-21T11:02:00.000Z");
    assert.equal((await gate.status({ date: "2026-08-21" })).status, "stale");
    const recovered = await gate.claim({ date: "2026-08-21", owner: "watchdog" });
    assert.equal(recovered.claimed, true);
    assert.equal(recovered.attempt, 2);
    await assert.rejects(
      gate.complete({ date: "2026-08-21", claimId: first.claimId, result: "published" }),
      /does not own/i,
    );

    await gate.complete({ date: "2026-08-21", claimId: recovered.claimId, result: "published" });
    const duplicate = await gate.claim({ date: "2026-08-21", owner: "scheduled-task" });
    assert.deepEqual(duplicate, { claimed: false, date: "2026-08-21", reason: "completed" });
    assert.equal((await gate.status({ date: "2026-08-21" })).result, "published");
  });
});

test("stale recovery cannot be overwritten by the owner it replaces", async () => {
  await withTempDirectory(async (directory) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      let currentTime = new Date("2026-08-21T11:00:00.000Z");
      const rootDirectory = path.join(directory, String(attempt));
      const gate = new PublicationRunGate({ rootDirectory, staleAfterMs: 60_000, now: () => currentTime });
      const original = await gate.claim({ date: "2026-08-21", owner: "scheduled-task" });
      currentTime = new Date("2026-08-21T11:02:00.000Z");

      const [settlement, recovery] = await Promise.allSettled([
        gate.complete({ date: "2026-08-21", claimId: original.claimId, result: "published" }),
        gate.claim({ date: "2026-08-21", owner: "watchdog" }),
      ]);
      const status = await gate.status({ date: "2026-08-21" });
      if (recovery.status === "fulfilled" && recovery.value.claimed) {
        assert.equal(status.status, "active");
        assert.equal(status.owner, "watchdog");
        assert.equal(settlement.status, "rejected");
      } else {
        assert.equal(settlement.status, "fulfilled");
        assert.equal(status.status, "completed");
      }
    }
  });
});

test("a failed gate records a bounded reason and permits a later catch-up attempt", async () => {
  await withTempDirectory(async (directory) => {
    let currentTime = new Date("2026-08-21T11:00:00.000Z");
    const gate = new PublicationRunGate({ rootDirectory: directory, now: () => currentTime });
    const first = await gate.claim({ date: "2026-08-21", owner: "scheduled-task" });
    await gate.fail({ date: "2026-08-21", claimId: first.claimId, reason: "publication-failed" });
    assert.equal((await gate.status({ date: "2026-08-21" })).reason, "publication-failed");

    currentTime = new Date("2026-08-21T12:00:00.000Z");
    const retry = await gate.claim({ date: "2026-08-21", owner: "watchdog" });
    assert.equal(retry.claimed, true);
    assert.equal(retry.attempt, 2);
  });
});

test("an owner renews its lease and can assert ownership before a protected side effect", async () => {
  await withTempDirectory(async (directory) => {
    let currentTime = new Date("2026-08-21T11:00:00.000Z");
    const gate = new PublicationRunGate({ rootDirectory: directory, staleAfterMs: 60_000, now: () => currentTime });
    const claim = await gate.claim({ date: "2026-08-21", owner: "scheduled-task" });

    currentTime = new Date("2026-08-21T11:00:45.000Z");
    const renewed = await gate.renew({ date: "2026-08-21", claimId: claim.claimId });
    assert.equal(renewed.expiresAt, "2026-08-21T11:01:45.000Z");
    currentTime = new Date("2026-08-21T11:01:15.000Z");
    await assert.doesNotReject(gate.assertOwned({ date: "2026-08-21", claimId: claim.claimId }));
    assert.equal((await gate.claim({ date: "2026-08-21", owner: "watchdog" })).reason, "active");

    currentTime = new Date("2026-08-21T11:01:46.000Z");
    await assert.rejects(gate.renew({ date: "2026-08-21", claimId: claim.claimId }), /expired/i);
    await assert.rejects(gate.assertOwned({ date: "2026-08-21", claimId: claim.claimId }), /expired/i);
  });
});

test("a no-edition receipt requires an owned claim and a completed zero-eligible ledger", async () => {
  await withTempDirectory(async (directory) => {
    const date = "2026-08-21";
    const gate = new PublicationRunGate({ rootDirectory: path.join(directory, ".curation", "run-gates") });
    const claim = await gate.claim({ date, owner: "watchdog" });
    const ledgerDirectory = path.join(directory, ".curation", "ledgers");
    await mkdir(ledgerDirectory, { recursive: true });
    await writeFile(path.join(ledgerDirectory, `${date}.json`), JSON.stringify({
      schemaVersion: 1,
      editionDate: date,
      failures: [],
      candidates: [{
        discoveryId: "old-item",
        clusterId: "old-item",
        decision: { status: "rejected", reason: "stale", rationale: "Outside the publication window." },
      }],
    }));

    await writeTerminalRunReceipt({
      projectRoot: directory,
      gate,
      receipt: { schemaVersion: 1, date, claimId: claim.claimId, result: "no-edition", completedAt: "2026-08-21T12:00:00.000Z" },
    });
    const receipt = await readValidTerminalRunReceipt({ projectRoot: directory, gate, date, claimId: claim.claimId });
    assert.equal(receipt.result, "no-edition");
    const claimFile = path.join(directory, ".curation", "run-claims", `${date}.json`);
    await mkdir(path.dirname(claimFile), { recursive: true });
    await writeFile(claimFile, JSON.stringify({ schemaVersion: 1, date, claimId: claim.claimId }), { mode: 0o600 });
    const command = await runScript("scripts/publication-run-receipt.mjs", [
      "record", "--project-root", directory, "--root", path.join(directory, ".curation", "run-gates"),
      "--date", date, "--claim-file", claimFile, "--result", "no-edition",
    ]);
    assert.equal(command.code, 0, command.output);
    assert.equal(JSON.parse(command.output).result, "no-edition");

    const ledger = JSON.parse(await readFile(path.join(ledgerDirectory, `${date}.json`), "utf8"));
    ledger.candidates[0].decision = { status: "pending" };
    await writeFile(path.join(ledgerDirectory, `${date}.json`), JSON.stringify(ledger));
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        receipt: { schemaVersion: 1, date, claimId: claim.claimId, result: "no-edition", completedAt: "2026-08-21T12:01:00.000Z" },
      }),
      /ledger/i,
    );
  });
});

test("a published receipt proves edition validation, configured registration, verification, push, and deployment", async () => {
  await withTempDirectory(async (directory) => {
    const date = "2026-08-20";
    const gate = new PublicationRunGate({ rootDirectory: path.join(directory, ".curation", "run-gates") });
    const claim = await gate.claim({ date, owner: "watchdog" });
    const editionDirectory = path.join(directory, "data", "editions");
    await mkdir(editionDirectory, { recursive: true });
    await writeFile(path.join(editionDirectory, `${date}.json`), await readFile(path.join(projectRoot, "tests", "fixtures", "edition-v3.json")));
    const manifestJson = JSON.stringify({ latestEdition: date, editions: [date] });
    await writeFile(path.join(directory, "data", "manifest.json"), manifestJson);
    const productionEditionUrl = `https://patrickkells.github.io/today-i-found/data/editions/${date}.json`;
    const productionManifestUrl = "https://patrickkells.github.io/today-i-found/data/manifest.json";
    const receipt = {
      schemaVersion: 1,
      date,
      claimId: claim.claimId,
      result: "published",
      completedAt: "2026-08-21T12:00:00.000Z",
      checks: {
        editionValidated: true,
        fullTests: true,
        feedbackTests: true,
        archivesValidated: true,
        build: true,
        sitesTests: true,
        registration: "registered",
        commit: "0123456789abcdef0123456789abcdef01234567",
        pushed: true,
        deployment: { verified: true, url: productionEditionUrl, verifiedAt: "2026-08-21T12:00:00.000Z" },
      },
    };
    const publishedEdition = await readFile(path.join(editionDirectory, `${date}.json`));
    const validation = {
      gitState: async () => ({
        head: receipt.checks.commit,
        pushed: true,
        editionBytes: publishedEdition,
        manifestBytes: Buffer.from(manifestJson),
      }),
      fetchImpl: async (url) => url === productionEditionUrl
        ? responseAt(publishedEdition, productionEditionUrl)
        : responseAt(manifestJson, productionManifestUrl),
    };

    const boundReceipt = await writeTerminalRunReceipt({ projectRoot: directory, gate, receipt, feedbackEnabled: true, ...validation });
    assert.match(boundReceipt.checks.deployment.editionSha256, /^[0-9a-f]{64}$/);
    assert.match(boundReceipt.checks.deployment.manifestSha256, /^[0-9a-f]{64}$/);
    assert.equal((await readValidTerminalRunReceipt({ projectRoot: directory, gate, date, claimId: claim.claimId, feedbackEnabled: true, ...validation })).result, "published");
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        feedbackEnabled: true,
        receipt,
        gitState: async () => ({
          head: receipt.checks.commit,
          pushed: true,
          editionBytes: Buffer.from(JSON.stringify({ ...JSON.parse(publishedEdition), date })),
          manifestBytes: Buffer.from(manifestJson),
        }),
        fetchImpl: validation.fetchImpl,
      }),
      /commit.*edition|edition.*commit/i,
    );
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        feedbackEnabled: true,
        receipt,
        gitState: async () => ({ head: "abcdefabcdefabcdefabcdefabcdefabcdefabcd", pushed: false }),
        fetchImpl: validation.fetchImpl,
      }),
      /commit.*push|push.*commit/i,
    );
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        feedbackEnabled: true,
        receipt: { ...receipt, checks: { ...receipt.checks, deployment: { ...receipt.checks.deployment, verified: false } } },
        ...validation,
      }),
      /deployment/i,
    );
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        feedbackEnabled: true,
        receipt: {
          ...receipt,
          checks: {
            ...receipt.checks,
            deployment: { ...receipt.checks.deployment, url: `https://attacker.example/${date}.json` },
          },
        },
        gitState: validation.gitState,
        fetchImpl: async (url) => responseAt(publishedEdition, url),
      }),
      /production.*deployment|deployment.*production/i,
    );
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        feedbackEnabled: true,
        receipt: {
          ...receipt,
          checks: {
            ...receipt.checks,
            deployment: { ...receipt.checks.deployment, url: `https://patrickkells.github.io/today-i-found/${date}.json` },
          },
        },
        gitState: validation.gitState,
        fetchImpl: async (url) => responseAt(publishedEdition, url),
      }),
      /exact production deployment/i,
    );
    const differentEdition = JSON.parse(publishedEdition);
    differentEdition.items[0].summary = "The deployed copy is valid but does not match the local archive.";
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        feedbackEnabled: true,
        receipt,
        gitState: validation.gitState,
        fetchImpl: async (url) => url === productionEditionUrl
          ? responseAt(JSON.stringify(differentEdition), productionEditionUrl)
          : responseAt(manifestJson, productionManifestUrl),
      }),
      /does not match.*local|local.*does not match/i,
    );
    const differentManifest = JSON.stringify({ latestEdition: date, editions: ["2026-08-19", date] });
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        feedbackEnabled: true,
        receipt,
        gitState: validation.gitState,
        fetchImpl: async (url) => url === productionEditionUrl
          ? responseAt(publishedEdition, productionEditionUrl)
          : responseAt(differentManifest, productionManifestUrl),
      }),
      /does not match.*local|local.*does not match/i,
    );
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        feedbackEnabled: true,
        receipt,
        gitState: validation.gitState,
        fetchImpl: async (url) => url === productionEditionUrl
          ? responseAt(publishedEdition, `https://attacker.example/${date}.json`)
          : responseAt(manifestJson, productionManifestUrl),
      }),
      /redirect|production.*deployment/i,
    );
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        feedbackEnabled: true,
        receipt: { ...receipt, checks: { ...receipt.checks, secret: "must-not-be-persisted" } },
        ...validation,
      }),
      /field secret is not allowed/i,
    );
    await assert.rejects(
      writeTerminalRunReceipt({
        projectRoot: directory,
        gate,
        feedbackEnabled: true,
        receipt: {
          ...receipt,
          checks: {
            ...receipt.checks,
            deployment: { ...receipt.checks.deployment, token: "must-not-be-persisted" },
          },
        },
        ...validation,
      }),
      /deployment field token is not allowed/i,
    );
  });
});

test("a claim interrupted before its state write expires instead of blocking the date forever", { timeout: 500 }, async () => {
  await withTempDirectory(async (directory) => {
    const abandoned = path.join(directory, "2026-08-21");
    await mkdir(abandoned);
    await utimes(abandoned, new Date("2026-08-21T10:00:00.000Z"), new Date("2026-08-21T10:00:00.000Z"));
    const gate = new PublicationRunGate({
      rootDirectory: directory,
      staleAfterMs: 60_000,
      now: () => new Date("2026-08-21T11:00:00.000Z"),
    });

    const recovered = await gate.claim({ date: "2026-08-21", owner: "watchdog" });
    assert.equal(recovered.claimed, true);
    assert.equal(recovered.attempt, 1);
  });
});

test("the watchdog catches up a missed run and completes its gate after curation", async () => {
  await withTempDirectory(async (directory) => {
    const gate = new PublicationRunGate({ rootDirectory: path.join(directory, "gates"), now: () => new Date("2026-08-21T15:30:00.000Z") });
    let received;
    const result = await runPublicationWatchdog({
      projectRoot: directory,
      date: "2026-08-21",
      gate,
      eligible: () => true,
      readInstruction: async () => "Curate and publish today's verified edition.",
      runCodex: async (request) => {
        received = request;
        return { exitCode: 0 };
      },
      readReceipt: async () => ({ result: "published" }),
    });

    assert.deepEqual(result, { status: "completed", date: "2026-08-21", result: "published" });
    assert.equal(received.invocation.command, "codex");
    assert.match(received.prompt, /watchdog already owns and renews the publication gate/i);
    assert.match(received.prompt, /Curate and publish today's verified edition/);
    assert.equal((await gate.status({ date: "2026-08-21" })).status, "completed");
  });
});

test("the watchdog validates an existing dated edition and manifest before claiming", async () => {
  await withTempDirectory(async (directory) => {
    const date = "2026-08-20";
    await mkdir(path.join(directory, "data", "editions"), { recursive: true });
    await writeFile(path.join(directory, "data", "editions", `${date}.json`), await readFile(path.join(projectRoot, "tests", "fixtures", "edition-v3.json")));
    await writeFile(path.join(directory, "data", "manifest.json"), JSON.stringify({ latestEdition: date, editions: [date] }));
    let executions = 0;
    const runCodex = async () => { executions += 1; return { exitCode: 0 }; };
    const gate = new PublicationRunGate({ rootDirectory: path.join(directory, "gates"), now: () => new Date("2026-08-21T11:00:00.000Z") });

    assert.equal(await hasValidLocalEdition({ projectRoot: directory, date }), true);
    const blocked = await runPublicationWatchdog({
      projectRoot: directory,
      date,
      gate,
      eligible: () => true,
      runCodex,
    });
    assert.deepEqual(blocked, { status: "noop", date, reason: "existing-edition" });
    assert.equal(executions, 0);
    assert.equal((await gate.status({ date })).status, "idle");
  });
});

test("the watchdog does not trust zero exit without a valid terminal receipt", async () => {
  await withTempDirectory(async (directory) => {
    let executions = 0;
    const runCodex = async () => { executions += 1; return { exitCode: 0 }; };
    const gate = new PublicationRunGate({ rootDirectory: path.join(directory, "gates"), now: () => new Date("2026-08-21T11:00:00.000Z") });
    const blocked = await runPublicationWatchdog({
      projectRoot: directory,
      date: "2026-08-21",
      gate,
      eligible: () => true,
      runCodex,
      readInstruction: async () => "Curate.",
      readReceipt: async () => { throw new Error("deployment receipt missing"); },
    });
    assert.deepEqual(blocked, { status: "failed", date: "2026-08-21", reason: "verification-failed" });
    assert.equal(executions, 1);

    const activeClaim = await gate.claim({ date: "2026-08-21", owner: "scheduled-task" });
    const active = await runPublicationWatchdog({
      projectRoot: directory,
      date: "2026-08-21",
      gate,
      eligible: () => true,
      runCodex,
    });
    assert.deepEqual(active, { status: "noop", date: "2026-08-21", reason: "active" });
    assert.equal(executions, 1);
    await gate.fail({ date: "2026-08-21", claimId: activeClaim.claimId, reason: "publication-failed" });
  });
});

test("the watchdog aborts its Codex child when lease renewal fails", async () => {
  let childAborted = false;
  const gate = {
    claim: async () => ({ claimed: true, claimId: "claim-id" }),
    renew: async () => { throw new Error("claim was replaced"); },
    fail: async () => { throw new Error("claim was replaced"); },
  };
  const result = await runPublicationWatchdog({
    projectRoot: "/project",
    date: "2026-08-21",
    gate,
    eligible: () => true,
    heartbeatIntervalMs: 5,
    readInstruction: async () => "Curate.",
    runCodex: async ({ signal }) => new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        childAborted = true;
        resolve({ exitCode: null });
      }, { once: true });
    }),
  });

  assert.equal(childAborted, true);
  assert.deepEqual(result, { status: "failed", date: "2026-08-21", reason: "lease-lost" });
});

test("the watchdog checks Eastern eligibility before claiming", async () => {
  let claims = 0;
  const result = await runPublicationWatchdog({
    projectRoot: "/project",
    date: "2026-08-21",
    gate: { claim: async () => { claims += 1; } },
    eligible: () => false,
  });
  assert.deepEqual(result, { status: "noop", date: "2026-08-21", reason: "before-eastern-window" });
  assert.equal(claims, 0);
});

test("feedback credentials stay in a trusted parent boundary and inherited secrets never reach the child", async () => {
  const credentials = {
    FEEDBACK_SUMMARY_URL: "https://feedback.example/summary",
    REGISTER_EDITION_URL: "https://feedback.example/register",
    CURATOR_TOKEN: "private-token",
  };
  const makeGate = () => ({
    claim: async () => ({ claimed: true, claimId: "claim-id" }),
    renew: async () => {},
    complete: async () => {},
    fail: async () => {},
  });
  let childRequest;
  let boundaryCredentials;
  let boundaryClosed = false;
  const completed = await runPublicationWatchdog({
    projectRoot: "/project",
    date: "2026-08-21",
    gate: makeGate(),
    eligible: () => true,
    feedbackEnabled: true,
    loadCredentials: async () => credentials,
    prepareFeedbackBoundary: async (options) => {
      boundaryCredentials = options.credentials;
      return {
        feedbackFile: "/project/.curation/watchdog-inputs/2026-08-21.json",
        registrationProxyUrl: "http://127.0.0.1:32123/register/one-time",
        registered: () => true,
        close: async () => { boundaryClosed = true; },
      };
    },
    environment: {
      HOME: "/Users/curator",
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      GH_TOKEN: "gh-secret",
      GITHUB_TOKEN: "github-secret",
      NPM_TOKEN: "npm-secret",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      SSH_AUTH_SOCK: "/private/ssh-agent",
      UNRELATED_PASSWORD: "other-secret",
    },
    readInstruction: async () => "Run the publication contract.",
    runCodex: async (request) => { childRequest = request; return { exitCode: 0 }; },
    readReceipt: async () => ({ result: "published" }),
  });
  assert.equal(completed.status, "completed");
  assert.deepEqual(boundaryCredentials, credentials);
  assert.equal(boundaryClosed, true);
  for (const value of [...Object.values(credentials), "gh-secret", "github-secret", "npm-secret", "aws-secret", "/private/ssh-agent", "other-secret"]) {
    assert.equal(Object.values(childRequest.environment).includes(value), false);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(childRequest.environment).filter(([key]) => ["HOME", "PATH", "LANG"].includes(key))), {
    HOME: "/Users/curator", PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8",
  });
  assert.equal(childRequest.environment.TODAY_I_FOUND_CLAIM_ID, "claim-id");
  assert.doesNotMatch(childRequest.prompt, /private-token|feedback\.example/);
  assert.doesNotMatch(childRequest.prompt, /claim-id/);
  assert.match(childRequest.prompt, /--feedback \/project\/\.curation\/watchdog-inputs\/2026-08-21\.json/);
  assert.match(childRequest.prompt, /--registration-proxy-url http:\/\/127\.0\.0\.1:32123\/register\/one-time/);

  let executions = 0;
  await assert.rejects(runPublicationWatchdog({
    projectRoot: "/project",
    date: "2026-08-21",
    gate: makeGate(),
    eligible: () => true,
    feedbackEnabled: true,
    loadCredentials: async () => { throw new Error("Keychain credentials are unavailable"); },
    runCodex: async () => { executions += 1; },
  }), /Keychain credentials are unavailable/i);
  assert.equal(executions, 0);
});

test("the trusted feedback boundary writes only validated feedback and registers only the owned dated edition", async () => {
  await withTempDirectory(async (directory) => {
    const date = "2026-08-20";
    const edition = JSON.parse(await readFile(path.join(projectRoot, "tests", "fixtures", "edition-v3.json"), "utf8"));
    const credentials = {
      FEEDBACK_SUMMARY_URL: "https://feedback.example/summary",
      REGISTER_EDITION_URL: "https://feedback.example/register",
      CURATOR_TOKEN: "private-token",
    };
    const summary = {
      preferences: {
        category: [{ value: "Tools", effectiveVotes: 12, adjustment: 0.25 }],
        source: [],
        tag: [],
      },
    };
    const calls = [];
    let assertions = 0;
    const boundary = await prepareWatchdogFeedbackBoundary({
      projectRoot: directory,
      date,
      claimId: "private-claim",
      gate: { assertOwned: async () => { assertions += 1; } },
      credentials,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url) === credentials.FEEDBACK_SUMMARY_URL) return new Response(JSON.stringify(summary));
        return new Response(null, { status: 204 });
      },
    });
    try {
      assert.equal((await stat(boundary.feedbackFile)).mode & 0o777, 0o600);
      const privateInput = await readFile(boundary.feedbackFile, "utf8");
      assert.deepEqual(JSON.parse(privateInput), summary);
      assert.doesNotMatch(privateInput, /private-token|feedback\.example/);
      const rejected = await fetch(boundary.registrationProxyUrl, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...edition, date: "2026-08-19" }),
      });
      assert.equal(rejected.ok, false);
      assert.equal(boundary.registered(), false);
      const accepted = await fetch(boundary.registrationProxyUrl, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(edition),
      });
      assert.equal(accepted.status, 204);
      assert.equal(boundary.registered(), true);
      assert.equal(assertions, 1);
      const registration = calls.find((call) => call.url === credentials.REGISTER_EDITION_URL);
      assert.equal(registration.init.headers.authorization, "Bearer private-token");
      assert.equal(JSON.parse(registration.init.body).date, date);
    } finally {
      await boundary.close();
    }
  });
});

test("the watchdog command pins ChatGPT Codex to gpt-5.6-sol with high reasoning", () => {
  assert.deepEqual(buildCurationInvocation({ projectRoot: "/project", codexPath: "/opt/codex" }), {
    command: "/opt/codex",
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
      "-C", "/project",
      "-",
    ],
  });
  assert.equal(todayInNewYork(new Date("2026-08-22T02:00:00.000Z")), "2026-08-21");
  assert.deepEqual(watchdogEnvironment({
    HOME: "/Users/curator",
    PATH: "/bin",
    CURATOR_TOKEN: "worker-token",
    GH_TOKEN: "blocked",
    SSH_AUTH_SOCK: "/private/ssh",
    UNRELATED_SECRET: "blocked",
    OPENAI_API_KEY: "blocked",
    CODEX_API_KEY: "blocked",
    ANOTHER_API_KEY: "blocked",
  }), { HOME: "/Users/curator", PATH: "/bin" });
  assert.equal(adaptWatchdogInstruction(
    "Run node scripts/tool.mjs, npm run build, then pnpm run test:sites.",
    { nodePath: "/opt/node/bin/node", packageManagerPath: "/opt/pnpm/bin/pnpm" },
  ), "Run /opt/node/bin/node scripts/tool.mjs, /opt/pnpm/bin/pnpm run build, then /opt/pnpm/bin/pnpm run test:sites.");
});

test("watchdog runtime eligibility follows 07:15 America/New_York across system timezones", () => {
  assert.equal(isWatchdogEligible(new Date("2026-08-21T11:14:59.000Z")), false);
  assert.equal(isWatchdogEligible(new Date("2026-08-21T11:15:00.000Z")), true);
  assert.equal(isWatchdogEligible(new Date("2026-12-21T12:14:59.000Z")), false);
  assert.equal(isWatchdogEligible(new Date("2026-12-21T12:15:00.000Z")), true);
});

test("feedback-enabled watchdogs load all credentials from Keychain and fail closed when one is unavailable", async () => {
  const values = {
    FEEDBACK_SUMMARY_URL: "https://feedback.example/v1/feedback/summary?days=90",
    REGISTER_EDITION_URL: "https://feedback.example/v1/editions",
    CURATOR_TOKEN: "private-token",
  };
  assert.deepEqual(await loadWatchdogCredentials({ feedbackEnabled: true, readSecret: async (account) => values[account] }), values);
  let reads = 0;
  assert.deepEqual(await loadWatchdogCredentials({ feedbackEnabled: false, readSecret: async () => { reads += 1; } }), {});
  assert.equal(reads, 0);
  await assert.rejects(
    loadWatchdogCredentials({ feedbackEnabled: true, readSecret: async (account) => account === "CURATOR_TOKEN" ? null : values[account] }),
    (error) => {
      assert.match(error.message, /Keychain credentials are unavailable/i);
      assert.doesNotMatch(error.message, /private-token|feedback\.example/);
      return true;
    },
  );
});

test("LaunchAgent plan uses deterministic absolute tools, a periodic trigger, and no credential values", () => {
  const plan = launchAgentPlan({
    homeDirectory: "/Users/patrick",
    projectRoot: "/project",
    nodePath: "/opt/node/bin/node",
    packageManagerPath: "/opt/pnpm/bin/pnpm",
    codexPath: "/Applications/ChatGPT.app/Contents/Resources/codex",
    productionOrigin: "https://today-i-found.pages.dev",
    uid: 501,
    feedbackEnabled: true,
    searchPath: "/untrusted",
  });
  const watchdog = plan.agents.find((agent) => agent.label.endsWith("publication-watchdog")).contents;
  const companion = plan.agents.find((agent) => agent.label.endsWith("report-companion")).contents;
  assert.match(watchdog, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  assert.doesNotMatch(watchdog, /StartCalendarInterval|\/untrusted/);
  assert.match(watchdog, /\/opt\/node\/bin:\/opt\/pnpm\/bin:\/Applications\/ChatGPT\.app\/Contents\/Resources:\/usr\/local\/bin:\/usr\/bin:\/bin:\/usr\/sbin:\/sbin/);
  assert.match(watchdog, /TODAY_I_FOUND_FEEDBACK_ENABLED[\s\S]*<string>1<\/string>/);
  assert.match(watchdog, /TODAY_I_FOUND_PACKAGE_MANAGER_PATH[\s\S]*\/opt\/pnpm\/bin\/pnpm/);
  assert.match(watchdog, /CODEX_PATH[\s\S]*\/Applications\/ChatGPT\.app\/Contents\/Resources\/codex/);
  assert.doesNotMatch(watchdog, /CURATOR_TOKEN|FEEDBACK_SUMMARY_URL|REGISTER_EDITION_URL/);
  assert.doesNotMatch(watchdog, /TODAY_I_FOUND_PRODUCTION_ORIGIN/);
  assert.match(companion, /TODAY_I_FOUND_PRODUCTION_ORIGIN[\s\S]*https:\/\/today-i-found\.pages\.dev/);
  assert.doesNotMatch(companion, /TODAY_I_FOUND_FEEDBACK_ENABLED/);
});

test("the run-gate CLI keeps its claim private and refuses to finalize without a valid receipt", async () => {
  await withTempDirectory(async (directory) => {
    const date = "2026-08-21";
    const root = path.join(directory, ".curation", "run-gates");
    const claimFile = path.join(directory, ".curation", "run-claims", `${date}.json`);
    const common = ["--date", date, "--root", root, "--project-root", directory, "--claim-file", claimFile];
    const claim = await runScript("scripts/publication-run-gate.mjs", ["claim", ...common, "--owner", "scheduled-task"]);
    assert.equal(claim.code, 0, claim.output);
    const claimed = JSON.parse(claim.output);
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.claimId, undefined);
    assert.doesNotMatch(claim.output, /[0-9a-f]{8}-[0-9a-f-]{27,}/i);
    assert.equal((await stat(claimFile)).mode & 0o777, 0o600);
    const privateClaim = JSON.parse(await readFile(claimFile, "utf8"));
    assert.equal(privateClaim.date, date);
    assert.match(privateClaim.claimId, /^[0-9a-f-]{36}$/i);

    const status = await runScript("scripts/publication-run-gate.mjs", ["status", ...common]);
    assert.equal(status.code, 0, status.output);
    assert.equal(JSON.parse(status.output).claimId, undefined);

    const renewed = await runScript("scripts/publication-run-gate.mjs", ["renew", ...common]);
    assert.equal(renewed.code, 0, renewed.output);
    assert.equal(JSON.parse(renewed.output).status, "active");
    const owned = await runScript("scripts/publication-run-gate.mjs", ["assert-owned", ...common]);
    assert.equal(owned.code, 0, owned.output);
    const wrongClaimFile = path.join(directory, ".curation", "run-claims", "wrong.json");
    const wrongClaimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await writeFile(wrongClaimFile, JSON.stringify({ schemaVersion: 1, date, claimId: wrongClaimId }), { mode: 0o600 });
    const rejectedOwner = await runScript("scripts/publication-run-gate.mjs", [
      "renew", "--date", date, "--root", root, "--project-root", directory, "--claim-file", wrongClaimFile,
    ]);
    assert.equal(rejectedOwner.code, 1, rejectedOwner.output);
    assert.doesNotMatch(rejectedOwner.output, new RegExp(wrongClaimId, "i"));

    const rawComplete = await runScript("scripts/publication-run-gate.mjs", ["complete", ...common, "--result", "published"]);
    assert.equal(rawComplete.code, 1, rawComplete.output);
    assert.match(rawComplete.output, /finalize|usage/i);
    const missingReceipt = await runScript("scripts/publication-run-gate.mjs", ["finalize", ...common]);
    assert.equal(missingReceipt.code, 1, missingReceipt.output);
    assert.match(missingReceipt.output, /receipt/i);
    const receiptDirectory = path.join(directory, ".curation", "run-receipts");
    await mkdir(receiptDirectory, { recursive: true });
    await writeFile(path.join(receiptDirectory, `${date}.json`), JSON.stringify({
      schemaVersion: 1,
      date,
      claimId: privateClaim.claimId,
      result: "no-edition",
      completedAt: "2026-08-21T12:00:00.000Z",
    }), { mode: 0o600 });
    const invalidReceipt = await runScript("scripts/publication-run-gate.mjs", ["finalize", ...common]);
    assert.equal(invalidReceipt.code, 1, invalidReceipt.output);
    assert.match(invalidReceipt.output, /ledger|receipt/i);
    const stillActive = await runScript("scripts/publication-run-gate.mjs", ["status", ...common]);
    assert.equal(stillActive.code, 0, stillActive.output);
    assert.equal(JSON.parse(stillActive.output).status, "active");

    const ledgerDirectory = path.join(directory, ".curation", "ledgers");
    await mkdir(ledgerDirectory, { recursive: true });
    await writeFile(path.join(ledgerDirectory, `${date}.json`), JSON.stringify({
      schemaVersion: 1,
      editionDate: date,
      failures: [],
      candidates: [{
        discoveryId: "old-item",
        clusterId: "old-item",
        decision: { status: "rejected", reason: "stale", rationale: "Outside the publication window." },
      }],
    }));
    const receipt = await runScript("scripts/publication-run-receipt.mjs", [
      "record", ...common, "--result", "no-edition",
    ]);
    assert.equal(receipt.code, 0, receipt.output);
    const finalized = await runScript("scripts/publication-run-gate.mjs", ["finalize", ...common]);
    assert.equal(finalized.code, 0, finalized.output);
    assert.equal(JSON.parse(finalized.output).status, "completed");
    assert.equal(JSON.parse(finalized.output).result, "no-edition");
  });
});

test("a claim-file write failure immediately releases the date for retry", async () => {
  await withTempDirectory(async (directory) => {
    const date = "2026-08-21";
    const root = path.join(directory, ".curation", "run-gates");
    const blockedParent = path.join(directory, "not-a-directory");
    await writeFile(blockedParent, "claim file parent is intentionally blocked");
    const failed = await runScript("scripts/publication-run-gate.mjs", [
      "claim", "--date", date, "--root", root, "--project-root", directory,
      "--owner", "scheduled-task", "--claim-file", path.join(blockedParent, "claim.json"),
    ]);
    assert.equal(failed.code, 1, failed.output);

    const status = await runScript("scripts/publication-run-gate.mjs", ["status", "--date", date, "--root", root]);
    assert.equal(status.code, 0, status.output);
    assert.equal(JSON.parse(status.output).status, "failed");
    assert.equal(JSON.parse(status.output).reason, "curation-failed");

    const retry = await runScript("scripts/publication-run-gate.mjs", [
      "claim", "--date", date, "--root", root, "--project-root", directory,
      "--owner", "watchdog", "--claim-file", path.join(directory, ".curation", "run-claims", `${date}.json`),
    ]);
    assert.equal(retry.code, 0, retry.output);
    assert.equal(JSON.parse(retry.output).attempt, 2);
  });
});

test("LaunchAgent install and uninstall dry runs print reversible user-level actions only", async () => {
  await withTempDirectory(async (homeDirectory) => {
    const shared = [
      "--dry-run", "--home", homeDirectory, "--project-root", projectRoot,
      "--node-path", node, "--package-manager-path", node, "--codex-path", node,
      "--production-origin", "https://today-i-found.pages.dev",
      "--feedback-enabled",
    ];
    const install = await runScript("scripts/install-launch-agents.mjs", shared);
    assert.equal(install.code, 0, install.output);
    assert.match(install.output, /com\.today-i-found\.report-companion/);
    assert.match(install.output, /com\.today-i-found\.publication-watchdog/);
    assert.match(install.output, /Library\/LaunchAgents/);
    assert.match(install.output, /StartInterval/);
    assert.doesNotMatch(install.output, /StartCalendarInterval/);
    assert.match(install.output, /EnvironmentVariables[\s\S]*<key>PATH<\/key>/);
    assert.match(install.output, /launchctl bootout gui\/.*com\.today-i-found\.report-companion\.plist/);
    assert.match(install.output, /launchctl bootstrap gui\//);
    assert.doesNotMatch(install.output, /pmset|CURATOR_TOKEN|API_KEY/i);
    await assert.rejects(access(path.join(homeDirectory, "Library")));

    const uninstall = await runScript("scripts/uninstall-launch-agents.mjs", shared);
    assert.equal(uninstall.code, 0, uninstall.output);
    assert.match(uninstall.output, /launchctl bootout gui\//);
    assert.match(uninstall.output, /remove .*com\.today-i-found\.report-companion\.plist/i);
    assert.match(uninstall.output, /remove .*com\.today-i-found\.publication-watchdog\.plist/i);
    assert.doesNotMatch(uninstall.output, /pmset/i);

    const missing = await runScript("scripts/install-launch-agents.mjs", [
      "--dry-run", "--home", homeDirectory, "--project-root", projectRoot,
      "--node-path", node, "--package-manager-path", path.join(homeDirectory, "missing-pnpm"), "--codex-path", node,
      "--production-origin", "https://today-i-found.pages.dev",
    ]);
    assert.equal(missing.code, 1);
    assert.match(missing.output, /package manager.*executable/i);
  });
});
