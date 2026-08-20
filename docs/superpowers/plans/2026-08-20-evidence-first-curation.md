# Evidence-First today i found Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace quota-driven numerical curation with evidence-first editorial tiers, explicit GitHub discovery, optional action material, structured duplicate exceptions, and sufficiently supported feedback tie-breaking.

**Architecture:** Introduce one machine-readable curation policy consumed by validation and ranking. Version the edition contract so new publications use schema version 2 while archive validation can still read version 1. Keep the curator responsible for evidence-backed editorial ordering, then allow deterministic feedback movement only inside the same tier.

**Tech Stack:** Node.js ESM, React 19, Vite 6, Cloudflare Worker + D1-compatible SQL, Node test runner, Testing Library, static JSON archives, Codex cron automation.

**Spec:** `docs/superpowers/specs/2026-08-20-evidence-first-curation-design.md`

## Global Constraints

- New editions contain 1–15 items; never add filler.
- Verified primary sources, prohibited-topic checks, builder utility, and the 30-day duplicate gate remain hard requirements.
- New editions use `editorialTier` and `rankingRationale`, not numerical impact, confidence, novelty, usefulness, or time-to-try values.
- `caveat` and `experiment` are optional; an experiment contains 1–3 nonempty steps.
- Diversity never blocks publication and never displaces a stronger signal.
- Feedback is eligible only at 10 weighted votes, is capped at ±0.5, and may reorder only within an editorial tier.
- GitHub Trending and repository acceleration are discovery leads, not quality evidence.
- Preserve `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs`.
- This workspace currently has no Git repository metadata. Do not initialize Git or create commits without separate user authorization.

---

### Task 1: Machine-Readable Policy and Versioned Edition Contract

**Files:**
- Create: `config/curation-policy.json`
- Modify: `lib/curation.js`
- Modify: `scripts/validate-archives.mjs`
- Modify: `data/editions/2026-08-19.json`
- Test: `tests/foundation.test.mjs`
- Test: `tests/archive-validation.test.mjs`

**Interfaces:**
- Consumes: existing `validateEdition(edition)` and JSON edition records.
- Produces: `validateEdition(edition, { allowLegacy?: boolean })`, policy keys `edition`, `editorialTiers`, `feedback`, `discovery`, and `substantiveUpdateKinds`.

- [ ] **Step 1: Write failing policy and schema tests**

Add literal assertions that prove the new contract rather than mirroring implementation:

```js
test("the evidence-first policy allows one strong item and configures GitHub discovery", () => {
  assert.equal(policy.edition.minItems, 1);
  assert.equal(policy.edition.maxItems, 15);
  assert.deepEqual(policy.discovery.githubTrendingWindows, ["daily", "weekly"]);
  assert.equal(policy.feedback.minEffectiveVotes, 10);
});

test("schema version 2 accepts one category and optional action material", () => {
  const one = structuredClone(edition);
  one.items = [{
    ...one.items[0],
    editorialTier: "must-try",
    rankingRationale: "A verified API capability builders can use immediately.",
  }];
  delete one.items[0].caveat;
  delete one.items[0].experiment;
  assert.deepEqual(validateEdition(one), []);
});

test("schema version 2 rejects empty editions, more than fifteen items, and invalid tiers", () => {
  const empty = structuredClone(edition);
  empty.items = [];
  assert.ok(validateEdition(empty).some((error) => error.includes("between 1 and 15")));

  const invalidTier = structuredClone(edition);
  invalidTier.items[0].editorialTier = "8.4";
  assert.ok(validateEdition(invalidTier).some((error) => error.includes("editorialTier")));
});

test("archive validation tolerates a legacy schema version 1 edition", () => {
  const legacy = structuredClone(edition);
  legacy.schemaVersion = 1;
  for (const item of legacy.items) {
    delete item.editorialTier;
    delete item.rankingRationale;
    item.timeToTry = "2–5 min";
    item.signal.impact = 8;
    item.signal.confidence = 8;
    item.signal.novelty = 7;
  }
  assert.deepEqual(validateEdition(legacy, { allowLegacy: true }), []);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```sh
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx --test tests/foundation.test.mjs tests/archive-validation.test.mjs
```

Expected: failures because the policy file, version-2 fields, 1-item allowance, and `allowLegacy` behavior do not exist.

- [ ] **Step 3: Add the policy and implement version-aware validation**

Create this policy shape:

```json
{
  "schemaVersion": 1,
  "edition": { "minItems": 1, "maxItems": 15, "currentSchemaVersion": 2 },
  "editorialTiers": ["must-try", "notable", "watch"],
  "feedback": { "windowDays": 90, "halfLifeDays": 30, "minEffectiveVotes": 10, "maxAdjustment": 0.5 },
  "discovery": {
    "githubTrendingWindows": ["daily", "weekly"],
    "githubRepositoryAcceleration": true,
    "popularityIsEvidence": false
  },
  "substantiveUpdateKinds": ["new-version", "new-capability", "api-access", "reproducible-evaluation", "expanded-utility"]
}
```

Update `validateEdition` so version 2 requires `editorialTier`, `rankingRationale`, and `signal.whyNow`; accepts 1–15 items; accepts an edition containing only one category; treats caveats as optional strings; and accepts absent experiments or 1–3 nonempty steps. Reject version 1 unless `{ allowLegacy: true }` is passed. Remove `government` from the hard political keyword pattern while keeping genuinely political terms.

Update archive validation to call:

```js
const validationErrors = validateEdition(edition, { allowLegacy: true });
```

- [ ] **Step 4: Migrate the sample edition to schema version 2**

For every item in `data/editions/2026-08-19.json`:

- remove `timeToTry`, `signal.impact`, `signal.confidence`, and `signal.novelty`;
- retain `signal.whyNow`;
- add an evidence-backed `editorialTier`;
- add a concise `rankingRationale` tied to the primary source and builder use.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Task 1 command again. Expected: all foundation and archive-validation tests pass.

---

### Task 2: Structured Substantive Updates

**Files:**
- Modify: `lib/curation.js`
- Test: `tests/foundation.test.mjs`

**Interfaces:**
- Consumes: `findDuplicates(candidate, existingItems, editionDate, options?)` and policy `substantiveUpdateKinds`.
- Produces: duplicate bypass only when `previousItemId`, allowed `kind`, and nonempty `reason` match an actual duplicate.

- [ ] **Step 1: Write failing duplicate-exception tests**

```js
test("a substantive update must identify the matched item and an allowed update kind", () => {
  const existing = [{
    id: "prior-signal",
    editionDate: "2026-08-18",
    title: "Acme ships agent traces",
    source: { url: "https://acme.example/traces" },
    entityKey: "acme-traces",
    eventKey: "acme-traces-v1",
  }];
  const candidate = {
    title: "Acme ships agent traces with offline storage",
    source: { url: "https://acme.example/traces" },
    entityKey: "acme-traces",
    eventKey: "acme-traces-v2",
  };

  assert.equal(findDuplicates({ ...candidate, substantiveUpdate: { reason: "New storage." } }, existing, "2026-08-19").length, 1);
  assert.equal(findDuplicates({ ...candidate, substantiveUpdate: { previousItemId: "wrong", kind: "new-capability", reason: "New storage." } }, existing, "2026-08-19").length, 1);
  assert.deepEqual(findDuplicates({ ...candidate, substantiveUpdate: { previousItemId: "prior-signal", kind: "new-capability", reason: "Adds offline trace storage." } }, existing, "2026-08-19"), []);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```sh
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx --test --test-name-pattern="substantive update" tests/foundation.test.mjs
```

Expected: the reason-only and wrong-item cases incorrectly bypass duplicates.

- [ ] **Step 3: Implement the structured exception**

Change the bypass check to require an allowed kind and a `previousItemId` that appears in the actual match set:

```js
function hasValidSubstantiveUpdate(candidate, matches) {
  const update = candidate.substantiveUpdate;
  return isNonEmptyString(update?.reason)
    && policy.substantiveUpdateKinds.includes(update?.kind)
    && matches.some(({ item }) => item.id === update.previousItemId);
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 2 command again. Expected: all substantive-update cases pass.

---

### Task 3: Tiered Editorial Ranking and Supported Feedback Tie-Breaking

**Files:**
- Create: `lib/editorial-ranking.js`
- Modify: `lib/publishing.js`
- Modify: `tests/curator-feedback.test.mjs`
- Modify: `tests/publish-edition.test.mjs`

**Interfaces:**
- Consumes: schema-version-2 items, policy feedback thresholds, protected feedback summary entries.
- Produces: `applyFeedbackTieBreak(edition, feedback)` returning items ordered by tier, then eligible feedback signal, then original order.

- [ ] **Step 1: Replace score-based tests with failing tier behavior tests**

```js
test("feedback below ten effective votes cannot reorder a tier", () => {
  const result = applyFeedbackTieBreak(editionWithTwoNotableItems, {
    preferences: { category: [{ value: "Tools", effectiveVotes: 9.9, adjustment: 0.5 }] },
  });
  assert.deepEqual(result.items.map((item) => item.id), ["first", "second"]);
});

test("eligible feedback reorders only inside the same tier", () => {
  const result = applyFeedbackTieBreak(editionWithMixedTiers, {
    preferences: { category: [{ value: "Tools", effectiveVotes: 10, adjustment: 0.5 }] },
  });
  assert.deepEqual(result.items.map((item) => item.id), ["must-try", "boosted-notable", "other-notable", "watch"]);
  assert.equal(result.items[1].curation.feedbackSignal, 0.5);
  assert.equal("baseScore" in result.items[1].curation, false);
  assert.equal("adjustedScore" in result.items[1].curation, false);
});
```

- [ ] **Step 2: Run feedback and publishing tests and verify RED**

Run:

```sh
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx --test tests/curator-feedback.test.mjs tests/publish-edition.test.mjs
```

Expected: failures because current publishing computes and sorts numerical scores.

- [ ] **Step 3: Implement `applyFeedbackTieBreak`**

Use policy tier order. Accept a preference only when `effectiveVotes >= 10`. Average eligible category, source, and tag adjustments, clamp to ±0.5, and attach only:

```js
curation: {
  feedbackSignal,
  eligiblePreferenceCount: matches.length
}
```

Sort with:

```js
tierOrder(left.item.editorialTier) - tierOrder(right.item.editorialTier)
  || right.item.curation.feedbackSignal - left.item.curation.feedbackSignal
  || left.index - right.index
```

Update `publishEdition` to call `applyFeedbackTieBreak`. Remove the numerical `score` function and every `baseScore` or `adjustedScore` annotation.

- [ ] **Step 4: Run feedback and publishing tests and verify GREEN**

Run the Task 3 command again. Expected: tier ordering, threshold behavior, and dry-run safety pass.

---

### Task 4: Score-Free Public Voting and Feedback Summaries

**Files:**
- Modify: `feedback-worker/schema.sql`
- Modify: `feedback-worker/index.js`
- Modify: `src/feedback-service.js`
- Modify: `src/app-state.js`
- Modify: `src/App.jsx`
- Modify: `tests/feedback-worker.test.mjs`
- Modify: `tests/feedback-schema.test.mjs`
- Modify: `tests/interface-state.test.mjs`
- Modify: `tests/interface-dom.test.jsx`

**Interfaces:**
- Consumes: item registration, vote GET/PUT requests, local fallback vote records.
- Produces: public vote records `{ itemId?, up, down, myVote }`; protected preference entries with `effectiveVotes`.

- [ ] **Step 1: Write failing Worker and client contract tests**

Add assertions such as:

```js
assert.deepEqual(await json(created), {
  itemId: "signal-one",
  up: 1,
  down: 0,
  myVote: "up",
});
assert.equal("score" in (await json(created)), false);

const models = payload.preferences.category.find((entry) => entry.value === "Models");
assert.equal(models.effectiveVotes, 10.25);
assert.equal(models.eligible, true);
```

Add a schema test asserting `items` no longer has a `base_score` column, and client tests asserting local/remote records work without `score`.

- [ ] **Step 2: Run Worker, schema, and interface-state tests and verify RED**

Run:

```sh
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx --test tests/feedback-worker.test.mjs tests/feedback-schema.test.mjs tests/interface-state.test.mjs tests/interface-dom.test.jsx
```

Expected: current records expose and require `score`, and the summary omits effective-vote eligibility.

- [ ] **Step 3: Remove score persistence and public score fields**

Remove `base_score` from the `items` table and related SQL statements. Remove score selection from vote queries and return:

```js
function canonicalRecord(row) {
  const numericVote = row?.my_vote == null ? null : Number(row.my_vote);
  return {
    itemId: row.item_id,
    up: Number(row.up ?? 0),
    down: Number(row.down ?? 0),
    myVote: numericVote === 1 ? "up" : numericVote === -1 ? "down" : null,
  };
}
```

Add `effectiveVotes` and `eligible` to protected preference summaries using weighted `up + down` and policy threshold 10.

- [ ] **Step 4: Simplify the browser feedback client**

Remove `usefulnessScore` from `src/app-state.js`. Remove the import and every `score` field from local seed records, canonical response validation, optimistic fallbacks, and App record defaults. Keep voting behavior and stale-response protection unchanged.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Task 4 command again. Expected: Worker and local voting contracts pass without score data.

---

### Task 5: Optional Try This and Caveat Sections

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/styles.css`
- Test: `tests/interface-dom.test.jsx`

**Interfaces:**
- Consumes: items with optional `experiment` and `caveat`.
- Produces: inspector that omits absent sections and remains usable on desktop and phone.

- [ ] **Step 1: Write failing inspector tests**

```jsx
test("the inspector omits optional action material instead of inventing filler", () => {
  const fixture = structuredClone(edition);
  delete fixture.items[0].experiment;
  delete fixture.items[0].caveat;
  render(<App edition={fixture} feedbackService={canonicalService()} />);

  assert.equal(screen.queryByText("THREE-STEP EXPERIMENT"), null);
  assert.equal(screen.queryByText("CAVEAT"), null);
  assert.ok(screen.getByText("SIGNAL DETAILS"));
});

test("an experiment renders each of its one through three supplied steps", () => {
  const fixture = structuredClone(edition);
  fixture.items[0].experiment.steps = ["Run the maintainer example."];
  render(<App edition={fixture} feedbackService={canonicalService()} />);
  assert.equal(screen.getAllByRole("button", { name: /Copy step/i }).length, 1);
});
```

- [ ] **Step 2: Run the DOM test and verify RED**

Run:

```sh
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx --test --test-name-pattern="optional action|one through three" tests/interface-dom.test.jsx
```

Expected: the inspector dereferences a missing experiment or renders empty mandatory sections.

- [ ] **Step 3: Render optional sections safely**

Use `item.experiment ? "TRY THIS" : "SIGNAL DETAILS"` for the inspector topline. Render the experiment section only when `item.experiment` exists. Render Caveat only when `item.caveat` is nonempty. Rename the visible experiment heading to `TRY THIS` so it remains accurate for one to three steps; keep numbered step and copy behavior.

- [ ] **Step 4: Run the DOM test and verify GREEN**

Run the Task 5 command again. Expected: optional and one-step cases pass without changing existing inspector interactions.

---

### Task 6: Curator Instructions, Publishing Guide, and Live Automation

**Files:**
- Modify: `docs/curator-scheduled-task.md`
- Modify: `docs/publishing.md`
- Modify: `AGENTS.md`
- External update: Codex automation `publish-today-i-found-daily-edition`

**Interfaces:**
- Consumes: `config/curation-policy.json`, approved design spec, existing daily cron automation.
- Produces: evidence-first daily curator prompt that explicitly searches GitHub Trending and preserves schedule/project/notification fields.

- [ ] **Step 1: Rewrite the scheduled curator instruction around the policy**

The instruction must tell the curator to:

- read `config/curation-policy.json` first;
- search official sources, GitHub Trending daily/weekly, and accelerating relevant repositories;
- treat popularity as a lead only;
- publish 1–15 qualifying items or skip the edition when none qualify;
- use editorial tiers and ranking rationales instead of numerical scores;
- use optional caveats and optional 1–3-step experiments;
- use diversity only between equivalent candidates;
- perform semantic archive comparison in addition to deterministic duplicate checks;
- retrieve protected feedback when configured and use it only as an eligible within-tier tie-breaker;
- run dry-run, test, build, registration, commit, and push gates exactly as before.

- [ ] **Step 2: Update publishing documentation and durable project preferences**

Replace references to 10–15 items, category quotas, fixed experiments, and adjusted scores. Document schema version 2, policy-backed validation, feedback eligibility, and optional UI fields. Record the approved evidence-first curation preferences in `AGENTS.md`.

- [ ] **Step 3: Update the existing automation with the automation tool**

View `publish-today-i-found-daily-edition`, preserve its `ACTIVE` status, daily 7:00 schedule, project, model, reasoning effort, local destination, and failure-only notification policy. Replace only its prompt with:

```text
Work in /Users/patrickkells/Documents/Developer/daily-ai-update. Read config/curation-policy.json and follow docs/curator-scheduled-task.md exactly. Curate today's evidence-first today i found edition from verified current primary sources, explicitly checking GitHub Trending daily and weekly plus accelerating relevant repositories as discovery leads. Publish 1–15 genuinely useful builder signals with no filler, use editorial tiers and ranking rationales instead of numerical quality scores, apply optional action material, strict exclusions, the structured 30-day duplicate gate, and eligible within-tier feedback tie-breaking. Run every dry-run, validation, test, build, registration, commit, and push gate; report blockers without exposing secrets.
```

- [ ] **Step 4: View the automation again and verify preserved fields**

Confirm the automation remains active at 7:00 AM America/New_York and references both the policy and curator instruction.

---

### Task 7: Full Regression, Dry Run, Build, and Responsive QA

**Files:**
- Verify only: all changed source, data, documentation, Worker, and test files.

**Interfaces:**
- Consumes: the completed evidence-first implementation.
- Produces: verified local app and publication pipeline with the active automation updated.

- [ ] **Step 1: Run every automated test**

Run:

```sh
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx --test tests/*.test.*
```

Expected: zero failures.

- [ ] **Step 2: Run edition and duplicate validation**

Run:

```sh
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/validate-edition.mjs data/editions/2026-08-19.json
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/validate-archives.mjs
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/check-duplicates.mjs
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/publish-edition.mjs --input data/editions/2026-08-19.json --dry-run
```

Expected: schema version 2, archive, duplicate, and dry-run checks pass without generating numerical scores.

- [ ] **Step 3: Run the production and Sites compatibility build**

Run:

```sh
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js build
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/prepare-sites-build.mjs
/Users/patrickkells/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/sites-worker.test.mjs
```

Expected: `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` exist and Sites tests pass.

- [ ] **Step 4: Verify the inspector in the existing local preview**

Keep the current local server alive. Check desktop, tablet, and phone widths with one fixture containing action material and one fixture without it. Confirm no blank Try This/Caveat sections, no horizontal overflow, working copy buttons, working votes, and unchanged keyboard navigation.

- [ ] **Step 5: Review the final diff and report external blockers**

Confirm protected files remain intact, no secrets are present, the automation is active, and no deployment or Git claims are made when credentials or repository metadata remain unavailable.
