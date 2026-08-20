import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { publishEdition } from "../lib/publishing.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const script = path.join(root, "scripts", "publish-edition.mjs");
const fixture = path.join(root, "tests", "fixtures", "edition.json");

async function runPublish(args, environment = {}) {
  const child = await new Promise((resolve, reject) => {
    const process = spawn(node, [script, ...args], {
      cwd: root,
      env: { ...globalThis.process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    process.stdout.on("data", (chunk) => { output += chunk; });
    process.stderr.on("data", (chunk) => { output += chunk; });
    process.on("error", reject);
    process.on("close", (code) => resolve({ code, output }));
  });
  return child;
}

async function makeTempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "today-i-found-publish-"));
}

test("dry run validates a candidate and does not write its static archive", async () => {
  const directory = await makeTempDirectory();
  try {
    const archiveDirectory = path.join(directory, "archive");
    const result = await runPublish([
      "--input", fixture,
      "--history-dir", path.join(directory, "history"),
      "--output-dir", archiveDirectory,
      "--dry-run",
      "--skip-source-audit",
    ]);

    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Dry run passed for 2026-08-19/i);
    await assert.rejects(readFile(path.join(archiveDirectory, "2026-08-19.json"), "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a valid dry run with a registration URL makes no network request or file mutation", async () => {
  const directory = await makeTempDirectory();
  try {
    const archiveDirectory = path.join(directory, "data", "editions");
    const manifest = path.join(directory, "data", "manifest.json");
    await mkdir(archiveDirectory, { recursive: true });
    await writeFile(path.join(archiveDirectory, "2026-08-19.json"), "archive-before\n");
    await writeFile(manifest, "{}\n");
    let registrations = 0;

    const result = await publishEdition({
      input: fixture,
      outputDirectory: archiveDirectory,
      historyDirectory: path.join(directory, "no-history"),
      manifestFile: manifest,
      dryRun: true,
      registerUrl: "https://feedback.example/v1/editions",
      curatorToken: "test-token",
      fetchImpl: async () => {
        registrations += 1;
        return new Response("{}", { status: 201 });
      },
    });

    assert.equal(result.dryRun, true);
    assert.equal(registrations, 0);
    assert.equal(await readFile(path.join(archiveDirectory, "2026-08-19.json"), "utf8"), "archive-before\n");
    assert.equal(await readFile(manifest, "utf8"), "{}\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dry runs apply supported feedback only as an editorial-tier tie-break", async () => {
  const directory = await makeTempDirectory();
  try {
    const candidate = JSON.parse(await readFile(fixture, "utf8"));
    const itemsById = new Map(candidate.items.map((item) => [item.id, item]));
    candidate.items = [
      { ...itemsById.get("huggingface-smolagents-code"), id: "watch" },
      { ...itemsById.get("anthropic-claude-code-hooks"), id: "other-notable" },
      { ...itemsById.get("openai-gpt-5-responses-tools"), id: "must-try" },
      { ...itemsById.get("cloudflare-workers-ai-gateway"), id: "boosted-notable" },
    ];
    const input = path.join(directory, "candidate.json");
    const feedbackFile = path.join(directory, "feedback.json");
    await writeFile(input, `${JSON.stringify(candidate)}\n`);
    await writeFile(feedbackFile, JSON.stringify({
      preferences: { category: [{ value: "Tools", effectiveVotes: 10, adjustment: 0.5 }] },
    }));

    const result = await publishEdition({
      input,
      outputDirectory: path.join(directory, "archive"),
      historyDirectory: path.join(directory, "no-history"),
      dryRun: true,
      feedbackFile,
    });

    assert.deepEqual(result.edition.items.map((item) => item.id), ["must-try", "boosted-notable", "other-notable", "watch"]);
    assert.deepEqual(result.edition.items[1].curation, { feedbackSignal: 0.5, eligiblePreferenceCount: 1 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid editions do not register with the feedback service or write an archive", async () => {
  const directory = await makeTempDirectory();
  try {
    const candidate = JSON.parse(await readFile(fixture, "utf8"));
    candidate.items = [];
    const invalidPath = path.join(directory, "invalid.json");
    const archiveDirectory = path.join(directory, "archive");
    await writeFile(invalidPath, `${JSON.stringify(candidate, null, 2)}\n`);
    const result = await runPublish([
      "--input", invalidPath,
      "--history-dir", path.join(directory, "history"),
      "--output-dir", archiveDirectory,
      "--register-url", "http://127.0.0.1:1/v1/editions",
    ], { CURATOR_TOKEN: "test-token" });

    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Publication blocked/i);
    assert.match(result.output, /validation: Edition must contain between 1 and 15 items/i);
    await assert.rejects(readFile(path.join(archiveDirectory, "2026-08-19.json"), "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed source audit blocks registration and leaves the archive untouched", async () => {
  const directory = await makeTempDirectory();
  try {
    const archiveDirectory = path.join(directory, "data", "editions");
    const manifest = path.join(directory, "data", "manifest.json");
    await mkdir(archiveDirectory, { recursive: true });
    await writeFile(path.join(archiveDirectory, "2026-08-19.json"), "archive-before\n");
    await writeFile(manifest, "{}\n");
    let registrations = 0;

    await assert.rejects(
      publishEdition({
        input: fixture,
        outputDirectory: archiveDirectory,
        historyDirectory: path.join(directory, "no-history"),
        manifestFile: manifest,
        auditSources: true,
        registerUrl: "https://feedback.example/v1/editions",
        curatorToken: "test-token",
        fetchImpl: async (url, options) => {
          if (options?.method === "POST") {
            registrations += 1;
            return new Response("{}", { status: 201 });
          }
          return { ok: false, status: 404, url };
        },
      }),
      /source audit: openai-gpt-5-responses-tools source returned HTTP 404/i,
    );

    assert.equal(registrations, 0);
    assert.equal(await readFile(path.join(archiveDirectory, "2026-08-19.json"), "utf8"), "archive-before\n");
    assert.equal(await readFile(manifest, "utf8"), "{}\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an invalid static-only candidate never registers or creates undefined archive files", async () => {
  const directory = await makeTempDirectory();
  try {
    const candidate = JSON.parse(await readFile(fixture, "utf8"));
    delete candidate.date;
    const input = path.join(directory, "candidate.json");
    const archiveDirectory = path.join(directory, "data", "editions");
    const manifest = path.join(directory, "data", "manifest.json");
    await writeFile(input, `${JSON.stringify(candidate)}\n`);
    let registrations = 0;

    await assert.rejects(
      publishEdition({
        input,
        outputDirectory: archiveDirectory,
        historyDirectory: path.join(directory, "no-history"),
        manifestFile: manifest,
        registerUrl: "https://feedback.example/v1/editions",
        curatorToken: "test-token",
        fetchImpl: async () => {
          registrations += 1;
          return new Response("{}", { status: 201 });
        },
      }),
      /edition.date is required/i,
    );

    assert.equal(registrations, 0);
    await assert.rejects(readFile(path.join(archiveDirectory, "undefined.json"), "utf8"));
    await assert.rejects(readFile(manifest, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a static-only publication writes a dated archive and manifest without history or registration", async () => {
  const directory = await makeTempDirectory();
  try {
    const archiveDirectory = path.join(directory, "data", "editions");
    const manifest = path.join(directory, "data", "manifest.json");
    let networkCalls = 0;
    await publishEdition({
      input: fixture,
      outputDirectory: archiveDirectory,
      historyDirectory: path.join(directory, "no-history"),
      manifestFile: manifest,
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("No remote request was expected.");
      },
    });

    assert.equal(networkCalls, 0);
    assert.equal((await JSON.parse(await readFile(manifest, "utf8"))).latestEdition, "2026-08-19");
    assert.equal((await JSON.parse(await readFile(path.join(archiveDirectory, "2026-08-19.json"), "utf8"))).date, "2026-08-19");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("feedback retrieval failure leaves existing archive and manifest bytes unchanged", async () => {
  const directory = await makeTempDirectory();
  try {
    const archiveDirectory = path.join(directory, "data", "editions");
    const manifest = path.join(directory, "data", "manifest.json");
    await mkdir(archiveDirectory, { recursive: true });
    await writeFile(path.join(archiveDirectory, "2026-08-19.json"), "archive-before\n");
    await writeFile(manifest, "manifest-before\n");
    let requests = 0;

    await assert.rejects(
      publishEdition({
        input: fixture,
        outputDirectory: archiveDirectory,
        historyDirectory: path.join(directory, "no-history"),
        manifestFile: manifest,
        feedbackUrl: "https://feedback.example/v1/feedback/summary?days=90",
        curatorToken: "test-token",
        fetchImpl: async () => {
          requests += 1;
          return new Response("{}", { status: 503 });
        },
      }),
      /Feedback summary request failed: 503/i,
    );

    assert.equal(requests, 1);
    assert.equal(await readFile(path.join(archiveDirectory, "2026-08-19.json"), "utf8"), "archive-before\n");
    assert.equal(await readFile(manifest, "utf8"), "manifest-before\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
