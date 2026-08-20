import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "validate-archives.mjs");
const fixture = path.join(root, "data", "editions", "2026-08-19.json");

async function runValidator(dataDirectory) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--data-dir", dataDirectory], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

async function fixtureEdition(date) {
  const edition = JSON.parse(await readFile(fixture, "utf8"));
  edition.date = date;
  edition.curatedAt = `${date}T07:42:00-04:00`;
  return edition;
}

async function writeArchive(dataDirectory, filename, edition) {
  await mkdir(path.join(dataDirectory, "editions"), { recursive: true });
  await writeFile(path.join(dataDirectory, "editions", `${filename}.json`), `${JSON.stringify(edition)}\n`);
}

async function writeManifest(dataDirectory, manifest) {
  await writeFile(path.join(dataDirectory, "manifest.json"), `${JSON.stringify(manifest)}\n`);
}

test("archive validation accepts a manifest whose latest and dated edition files are valid", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "today-i-found-archive-"));
  try {
    await writeArchive(dataDirectory, "2026-08-19", await fixtureEdition("2026-08-19"));
    await writeManifest(dataDirectory, { latestEdition: "2026-08-19", editions: ["2026-08-19"] });

    const result = await runValidator(dataDirectory);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Archive validation passed for 1 edition/i);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("archive validation rejects a manifest whose latest edition file is missing", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "today-i-found-archive-"));
  try {
    await writeManifest(dataDirectory, { latestEdition: "2026-08-20", editions: ["2026-08-20"] });
    const result = await runValidator(dataDirectory);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /latestEdition.*missing/i);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("archive validation checks the latest archive file even when the manifest list omits it", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "today-i-found-archive-"));
  try {
    await writeManifest(dataDirectory, { latestEdition: "2026-08-20", editions: [] });
    const result = await runValidator(dataDirectory);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /latestEdition archive.*missing/i);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("archive validation blocks a later invalid edition instead of validating only the latest fixture", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "today-i-found-archive-"));
  try {
    const invalidLater = await fixtureEdition("2026-08-20");
    invalidLater.items = [];
    await writeArchive(dataDirectory, "2026-08-19", await fixtureEdition("2026-08-19"));
    await writeArchive(dataDirectory, "2026-08-20", invalidLater);
    await writeManifest(dataDirectory, { latestEdition: "2026-08-20", editions: ["2026-08-19", "2026-08-20"] });

    const result = await runValidator(dataDirectory);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /2026-08-20\.json.*between 1 and 15 items/i);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("archive validation rejects an unlisted invalid on-disk archive", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "today-i-found-archive-"));
  try {
    const unlistedInvalid = await fixtureEdition("2026-08-20");
    unlistedInvalid.items = [];
    await writeArchive(dataDirectory, "2026-08-19", await fixtureEdition("2026-08-19"));
    await writeArchive(dataDirectory, "2026-08-20", unlistedInvalid);
    await writeManifest(dataDirectory, { latestEdition: "2026-08-19", editions: ["2026-08-19"] });

    const result = await runValidator(dataDirectory);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /unlisted archive.*2026-08-20/i);
    assert.match(result.output, /2026-08-20\.json.*between 1 and 15 items/i);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("archive validation rejects a latestEdition that is not the maximum listed date", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "today-i-found-archive-"));
  try {
    await writeArchive(dataDirectory, "2026-08-19", await fixtureEdition("2026-08-19"));
    await writeArchive(dataDirectory, "2026-08-20", await fixtureEdition("2026-08-20"));
    await writeManifest(dataDirectory, { latestEdition: "2026-08-19", editions: ["2026-08-19", "2026-08-20"] });

    const result = await runValidator(dataDirectory);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /latestEdition.*maximum listed date.*2026-08-20/i);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("archive validation rejects an edition whose filename and top-level date disagree", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "today-i-found-archive-"));
  try {
    await writeArchive(dataDirectory, "2026-08-19", await fixtureEdition("2026-08-18"));
    await writeManifest(dataDirectory, { latestEdition: "2026-08-19", editions: ["2026-08-19"] });
    const result = await runValidator(dataDirectory);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /filename date.*does not match/i);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("archive validation tolerates a legacy schema version 1 edition", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "today-i-found-archive-"));
  try {
    const legacy = await fixtureEdition("2026-08-19");
    legacy.schemaVersion = 1;
    for (const item of legacy.items) {
      delete item.editorialTier;
      delete item.rankingRationale;
      item.timeToTry = "2–5 min";
      item.signal.impact = 8;
      item.signal.confidence = 8;
      item.signal.novelty = 7;
    }
    await writeArchive(dataDirectory, "2026-08-19", legacy);
    await writeManifest(dataDirectory, { latestEdition: "2026-08-19", editions: ["2026-08-19"] });

    const result = await runValidator(dataDirectory);
    assert.equal(result.code, 0, result.output);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
