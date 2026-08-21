import assert from "node:assert/strict";
import test from "node:test";
import { applyFeedbackTieBreak, selectPersonalizedItems } from "../lib/editorial-ranking.js";

function makeItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    category: index % 2 ? "Security & Privacy" : "Software & Developer Tools",
    editorialTier: index % 3 === 0 ? "must-try" : index % 3 === 1 ? "notable" : "watch",
    tags: [index % 2 ? "topic:security" : "topic:developer-tools", "format:release"],
    source: { publisher: index % 2 ? "Security Lab" : "Dev Lab" },
  }));
}

function feedbackFavoring(value) {
  return { preferences: { tag: [{ value, effectiveVotes: 20, adjustment: 0.5 }] } };
}

test("feedback below ten effective votes keeps cold-start editorial order", () => {
  const items = makeItems(2);
  const result = selectPersonalizedItems(items, {
    preferences: { category: [{ value: "Security & Privacy", effectiveVotes: 9.9, adjustment: 0.5 }] },
  });
  assert.deepEqual(result.items.map((item) => item.id), ["item-0", "item-1"]);
  assert.equal(result.stats.eligiblePreferenceGroups, 0);
  assert.equal(items[0].curation, undefined);
});

test("eligible preferences select thirty-two matches and eight exploration items from fifty", () => {
  const items = makeItems(50);
  const result = selectPersonalizedItems(items, feedbackFavoring("topic:security"), { maxItems: 40, explorationRatio: 0.2 });
  assert.equal(result.items.length, 40);
  assert.equal(result.stats.explorationItems, 8);
  assert.equal(result.items.filter((item) => item.curation.selectionMode === "exploration").length, 8);
  assert.ok(result.items.filter((item) => item.curation.selectionMode !== "exploration").slice(0, 25)
    .every((item) => item.tags.includes("topic:security")));
});

test("cold start uses editorial order and does not manufacture exploration", () => {
  const items = makeItems(45);
  const result = selectPersonalizedItems(items, {}, { maxItems: 40, explorationRatio: 0.2 });
  assert.deepEqual(result.items.map((item) => item.id), items.slice(0, 40).map((item) => item.id));
  assert.equal(result.stats.explorationItems, 0);
});

test("the schema 2 compatibility wrapper preserves editorial tiers", () => {
  const edition = { items: [
    { id: "must", category: "AI & Automation", editorialTier: "must-try", tags: ["topic:ai"], source: { publisher: "A" } },
    { id: "preferred", category: "Security & Privacy", editorialTier: "watch", tags: ["topic:security"], source: { publisher: "B" } },
  ] };
  const result = applyFeedbackTieBreak(edition, feedbackFavoring("topic:security"));
  assert.deepEqual(result.items.map((item) => item.id), ["must", "preferred"]);
  assert.equal(result.items[1].curation.feedbackSignal, 0.5);
});
