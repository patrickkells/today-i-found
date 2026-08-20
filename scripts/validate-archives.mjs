#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateEdition } from "../lib/curation.js";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function archiveJsonFiles(directory) {
  try {
    return (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function main() {
  const dataDirectory = option("--data-dir", "data");
  const manifest = await readJson(path.join(dataDirectory, "manifest.json"));
  const listedDates = Array.isArray(manifest.editions) ? manifest.editions : [];
  const listedSet = new Set(listedDates);
  const editionsDirectory = path.join(dataDirectory, "editions");
  const archiveFiles = await archiveJsonFiles(editionsDirectory);
  const archiveDates = archiveFiles.map((file) => path.basename(file, ".json"));
  const archiveSet = new Set(archiveDates);
  const errors = [];
  const validListedDates = [];

  if (!manifest.latestEdition) errors.push("manifest.latestEdition is required.");
  if (!listedSet.has(manifest.latestEdition)) errors.push("manifest.latestEdition is missing from manifest.editions.");
  if (manifest.latestEdition && !archiveSet.has(manifest.latestEdition)) {
    errors.push(`manifest.latestEdition archive ${manifest.latestEdition} is missing.`);
  }
  if (listedSet.size !== listedDates.length) errors.push("manifest.editions must not contain duplicate dates.");
  for (const date of listedSet) {
    if (!archiveSet.has(date)) errors.push(`manifest entry ${date} is missing an archive file.`);
  }
  for (const date of archiveSet) {
    if (!listedSet.has(date)) errors.push(`unlisted archive ${date} is present on disk.`);
  }

  for (const date of archiveDates) {
    const filename = path.join(dataDirectory, "editions", `${date}.json`);
    let edition;
    try {
      edition = await readJson(filename);
    } catch (error) {
      if (error.code === "ENOENT") {
        errors.push(`archive ${date} is missing: ${filename}.`);
        continue;
      }
      errors.push(`${filename}: cannot be read as JSON.`);
      continue;
    }
    const validationErrors = validateEdition(edition, { allowLegacy: true });
    if (edition.date !== date) errors.push(`${filename}: filename date ${date} does not match edition.date ${edition.date}.`);
    for (const validationError of validationErrors) errors.push(`${filename}: ${validationError}`);
    if (listedSet.has(date) && edition.date === date && !validationErrors.length) validListedDates.push(date);
  }

  const maximumListedDate = validListedDates.sort().at(-1);
  if (!maximumListedDate) {
    errors.push("manifest.editions has no valid listed archive date.");
  } else if (manifest.latestEdition !== maximumListedDate) {
    errors.push(`manifest.latestEdition ${manifest.latestEdition} must equal maximum listed date ${maximumListedDate}.`);
  }

  if (errors.length) {
    console.error("Archive validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Archive validation passed for ${archiveDates.length} edition${archiveDates.length === 1 ? "" : "s"}.`);
}

main().catch((error) => {
  console.error(`Archive validation failed: ${error.message}`);
  process.exitCode = 1;
});
