#!/usr/bin/env node
import path from "node:path";
import { publishEdition } from "../lib/publishing.js";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function required(name) {
  const value = option(name);
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  const input = required("--input");
  const outputDirectory = option("--output-dir", "data/editions");
  const result = await publishEdition({
    input,
    outputDirectory,
    historyDirectory: option("--history-dir", outputDirectory),
    manifestFile: option("--manifest", path.join(path.dirname(outputDirectory), "manifest.json")),
    dryRun: process.argv.includes("--dry-run"),
    feedbackFile: option("--feedback"),
    ledgerFile: option("--ledger"),
    feedbackUrl: option("--feedback-url"),
    registerUrl: option("--register-url"),
    registrationProxyUrl: option("--registration-proxy-url"),
    curatorToken: process.env.CURATOR_TOKEN,
    auditSources: !process.argv.includes("--skip-source-audit"),
  });
  if (result.skipped) {
    console.log("No edition published: no qualifying candidates.");
  } else {
    const stats = result.edition.discoveryStats;
    if (stats) console.log(`Candidates ${stats.rawCandidates}; clustered ${stats.clusteredCandidates}; eligible ${stats.eligibleCandidates}; published ${stats.publishedItems}; Trending reviewed ${stats.trendingReviewed}; exploration ${stats.explorationItems}.`);
    if (result.dryRun) console.log(`Dry run passed for ${result.edition.date}; no files were written or registered.`);
    else console.log(`Published ${result.edition.date} to ${outputDirectory}.`);
  }
}

main().catch((error) => {
  console.error(error.message.startsWith("Publication blocked:") ? error.message : `Publication blocked: ${error.message}`);
  process.exitCode = 1;
});
