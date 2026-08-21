import assert from "node:assert/strict";
import test from "node:test";
import {
  createCandidateLedger,
  publicDiscoveryStats,
  setCandidateDecision,
  summarizeCandidateLedger,
  validateCandidateLedger,
} from "../lib/candidate-ledger.js";

const discoveries = [
  { discoveryId: "feed:a", url: "https://example.com/a", origin: { kind: "rss" } },
  { discoveryId: "github:acme/old", url: "https://github.com/acme/old", origin: { kind: "github-trending" } },
];

test("a completed ledger reconciles every eligible item and Trending rejection", () => {
  let ledger = createCandidateLedger({ editionDate: "2026-08-20", discoveries, failures: [] });
  ledger = setCandidateDecision(ledger, "feed:a", { status: "eligible", itemId: "item-a", rationale: "Current release." });
  ledger.candidates[0].copy = { promptVersion: "broad-tech-baseline-v1", evidenceFacts: ["A current release shipped."], title: "Title", summary: "Summary" };
  ledger = setCandidateDecision(ledger, "github:acme/old", { status: "rejected", reason: "inactive", rationale: "No activity in twelve months." });
  assert.deepEqual(validateCandidateLedger(ledger, { date: "2026-08-20", items: [{ id: "item-a", title: "Title", summary: "Summary" }] }), []);
  assert.deepEqual(summarizeCandidateLedger(ledger), {
    rawCandidates: 2,
    clusteredCandidates: 2,
    eligibleCandidates: 1,
    rejectedCandidates: 1,
    pendingCandidates: 0,
    trendingReviewed: 1,
    feedFailures: 0,
  });
  assert.deepEqual(publicDiscoveryStats(ledger, { publishedItems: 1, explorationItems: 0 }), {
    rawCandidates: 2,
    clusteredCandidates: 2,
    eligibleCandidates: 1,
    publishedItems: 1,
    trendingReviewed: 1,
    explorationItems: 0,
  });
});

test("discovery creates evidence-backed stale decisions outside each freshness class", () => {
  const ledger = createCandidateLedger({
    editionDate: "2026-08-20",
    discoveries: [
      { discoveryId: "release", url: "https://example.com/release", ageDays: 8, freshnessClass: "standard" },
      { discoveryId: "research", url: "https://example.com/research", ageDays: 8, freshnessClass: "extended" },
    ],
  });
  assert.equal(ledger.candidates[0].decision.reason, "stale");
  assert.equal(ledger.candidates[1].decision.status, "pending");
});

test("ledger validation rejects pending and unaccounted candidates", () => {
  const ledger = createCandidateLedger({ editionDate: "2026-08-20", discoveries, failures: [] });
  assert.equal(validateCandidateLedger(ledger).filter((error) => error.includes("pending")).length, 2);
});

test("canonical duplicates cluster before editorial decisions", () => {
  const ledger = createCandidateLedger({
    editionDate: "2026-08-20",
    discoveries: [
      { discoveryId: "one", url: "https://example.com/story?utm_source=a" },
      { discoveryId: "two", url: "https://example.com/story" },
    ],
  });
  assert.equal(new Set(ledger.candidates.map((item) => item.clusterId)).size, 1);
  assert.deepEqual(ledger.candidates[1].decision, { status: "rejected", reason: "clustered", rationale: "Clustered with one." });
});
