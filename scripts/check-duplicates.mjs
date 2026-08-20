import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { findDuplicates } from "../lib/curation.js";

const editionsDirectory = "data/editions";
const files = (await readdir(editionsDirectory)).filter((file) => file.endsWith(".json")).sort();
const priorItems = [];
const duplicates = [];

for (const file of files) {
  const edition = JSON.parse(await readFile(path.join(editionsDirectory, file), "utf8"));
  for (const item of edition.items) {
    for (const match of findDuplicates(item, priorItems, edition.date)) {
      duplicates.push(`${file}: ${item.id} duplicates ${match.item.id} via ${match.reasons.join(", ")}`);
    }
    priorItems.push({ ...item, editionDate: edition.date });
  }
}

if (duplicates.length) {
  console.error("Duplicate check failed:");
  for (const duplicate of duplicates) console.error(`- ${duplicate}`);
  process.exitCode = 1;
} else {
  console.log(`Duplicate check passed across ${files.length} edition(s).`);
}
