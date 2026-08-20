import assert from "node:assert/strict";
import test from "node:test";

import { applyFeedbackTieBreak } from "../lib/editorial-ranking.js";

const editionWithTwoNotableItems = {
  items: [
    { id: "first", category: "Models", editorialTier: "notable", tags: [], source: { publisher: "A" } },
    { id: "second", category: "Tools", editorialTier: "notable", tags: [], source: { publisher: "B" } },
  ],
};

const editionWithMixedTiers = {
  items: [
    { id: "watch", category: "Tools", editorialTier: "watch", tags: [], source: { publisher: "A" } },
    { id: "other-notable", category: "Models", editorialTier: "notable", tags: [], source: { publisher: "B" } },
    { id: "must-try", category: "Models", editorialTier: "must-try", tags: [], source: { publisher: "C" } },
    {
      id: "boosted-notable",
      category: "Tools",
      editorialTier: "notable",
      tags: ["agents"],
      source: { publisher: "D" },
      curation: { baseScore: 9.2, adjustedScore: 9.7 },
    },
  ],
};

test("feedback below ten effective votes cannot reorder a tier", () => {
  const result = applyFeedbackTieBreak(editionWithTwoNotableItems, {
    preferences: { category: [{ value: "Tools", effectiveVotes: 9.9, adjustment: 0.5 }] },
  });

  assert.deepEqual(result.items.map((item) => item.id), ["first", "second"]);
  assert.deepEqual(result.items[1].curation, { feedbackSignal: 0, eligiblePreferenceCount: 0 });
  assert.equal(editionWithTwoNotableItems.items[0].curation, undefined);
});

test("eligible feedback reorders only inside the same tier", () => {
  const result = applyFeedbackTieBreak(editionWithMixedTiers, {
    preferences: {
      category: [{ value: "Tools", effectiveVotes: 10, adjustment: 0.5 }],
      source: [{ value: "D", effectiveVotes: 10, adjustment: 0.6 }],
      tag: [{ value: "agents", effectiveVotes: 10, adjustment: 0.5 }],
    },
  });

  assert.deepEqual(result.items.map((item) => item.id), ["must-try", "boosted-notable", "other-notable", "watch"]);
  assert.deepEqual(result.items[1].curation, { feedbackSignal: 0.5, eligiblePreferenceCount: 3 });
  assert.equal("baseScore" in result.items[1].curation, false);
  assert.equal("adjustedScore" in result.items[1].curation, false);
});
