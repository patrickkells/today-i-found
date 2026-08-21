#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import feeds from "../config/discovery-feeds.json" with { type: "json" };
import policy from "../config/curation-policy.json" with { type: "json" };
import { createCandidateLedger, summarizeCandidateLedger } from "../lib/candidate-ledger.js";
import { collectTrendingRepositories } from "../lib/github-trending.js";
import { collectFeedDiscoveries } from "../lib/rss-discovery.js";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function todayInNewYork() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const editionDate = option("--edition-date") ?? todayInNewYork();
const outputFile = option("--output") ?? path.join(".curation", "ledgers", `${editionDate}.json`);
const [feedResult, trendingResult] = await Promise.all([
  collectFeedDiscoveries({ feeds: feeds.feeds, editionDate, maxDiscoveryAgeDays: policy.discovery.maxDiscoveryAgeDays }),
  collectTrendingRepositories({ windows: policy.discovery.githubTrendingWindows, editionDate }),
]);
const ledger = createCandidateLedger({
  editionDate,
  discoveries: [...feedResult.discoveries, ...trendingResult.discoveries],
  failures: [...feedResult.failures, ...trendingResult.failures],
});
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ editionDate, outputFile, ...summarizeCandidateLedger(ledger), failures: ledger.failures }, null, 2));
if (trendingResult.failures.length === policy.discovery.githubTrendingWindows.length && feedResult.failures.length === feeds.feeds.length) process.exitCode = 1;
