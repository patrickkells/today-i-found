import { readFile } from "node:fs/promises";
import { validateEdition } from "../lib/curation.js";

const file = process.argv[2] ?? "data/editions/2026-08-20.json";
const edition = JSON.parse(await readFile(file, "utf8"));
const errors = validateEdition(edition);

if (errors.length) {
  console.error(`Edition validation failed for ${file}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Edition validation passed for ${file} (${edition.items.length} items).`);
}
