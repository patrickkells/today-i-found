#!/usr/bin/env node
import feeds from "../config/discovery-feeds.json" with { type: "json" };
import policy from "../config/curation-policy.json" with { type: "json" };
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
const result = await collectFeedDiscoveries({
  feeds: feeds.feeds,
  editionDate,
  maxDiscoveryAgeDays: policy.discovery.maxDiscoveryAgeDays,
});

const fresh = result.discoveries.filter((item) => {
  const limit = policy.freshness.windows[item.freshnessClass];
  return item.ageDays >= 0 && Number.isInteger(limit) && item.ageDays <= limit;
});
const topicCounts = Object.fromEntries(policy.categories.map((topic) => [
  topic,
  fresh.filter((item) => item.topics.includes(topic)).length,
]));

console.log(JSON.stringify({
  editionDate,
  rawDiscoveryCount: result.discoveries.length,
  freshCandidateCount: fresh.length,
  topicCounts,
  discoveries: result.discoveries,
  failures: result.failures,
}, null, 2));
if (result.failures.length === feeds.feeds.length) process.exitCode = 1;
