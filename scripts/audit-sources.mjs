#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { auditEditionSources } from "../lib/source-audit.js";

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/audit-sources.mjs <candidate-edition.json>");

const edition = JSON.parse(await readFile(file, "utf8"));
const errors = await auditEditionSources(edition);
if (errors.length) {
  console.error(`Source audit failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Source audit passed for ${edition.date} (${edition.items.length} sources).`);
}
