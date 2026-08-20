#!/usr/bin/env node
import feeds from "../config/discovery-feeds.json" with { type: "json" };
import policy from "../config/curation-policy.json" with { type: "json" };
import { collectFeedCandidates } from "../lib/rss-discovery.js";

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
const result = await collectFeedCandidates({
  feeds: feeds.feeds,
  editionDate,
  maxAgeDays: policy.freshness.maxAgeDays,
});

console.log(JSON.stringify({ editionDate, ...result }, null, 2));
if (result.failures.length === feeds.feeds.length) process.exitCode = 1;
