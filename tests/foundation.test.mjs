import assert from "node:assert/strict";
import test from "node:test";

import manifest from "../data/manifest.json" with { type: "json" };
import currentEdition from "../data/editions/2026-08-20.json" with { type: "json" };
import edition from "./fixtures/edition.json" with { type: "json" };
import broadEdition from "./fixtures/edition-v3.json" with { type: "json" };
import policy from "../config/curation-policy.json" with { type: "json" };
import feeds from "../config/discovery-feeds.json" with { type: "json" };
import { PRIMARY_CATEGORIES } from "../shared/editorial-contract.js";
import {
  canonicalizeUrl,
  findDuplicates,
  isInDuplicateWindow,
  isProhibitedTopic,
  validateEdition,
} from "../lib/curation.js";

test("canonicalizeUrl removes tracking data and normalizes a primary URL", () => {
  assert.equal(
    canonicalizeUrl("HTTPS://Example.COM:443/launch/?b=2&utm_source=newsletter&a=1#details"),
    "https://example.com/launch?a=1&b=2",
  );
});

test("isProhibitedTopic excludes every prohibited category and common inflections", () => {
  for (const title of [
    "Company raises $200M Series C funding",
    "Election policy shapes AI market",
    "Company announces acquisitions of AI startups",
    "Industry mergers reshape AI tooling",
    "CEO resigns after executive drama",
    "Market speculation about AI stocks intensifies",
  ]) {
    assert.equal(isProhibitedTopic({ title, summary: "Not a builder signal." }).prohibited, true, title);
  }
  assert.equal(isProhibitedTopic({ title: "New eval harness cuts regression setup time", summary: "A builder tool." }).prohibited, false);
  assert.equal(isProhibitedTopic({ title: "Government lab releases a public eval harness", summary: "A builder tool." }).prohibited, false);
});

test("isInDuplicateWindow includes both calendar-day endpoints", () => {
  assert.equal(isInDuplicateWindow("2026-07-20", "2026-08-19"), true);
  assert.equal(isInDuplicateWindow("2026-07-19", "2026-08-19"), false);
});

test("findDuplicates catches canonical URL, entity key, event key, and strong normalized-title matches", () => {
  const existing = [
    {
      publicationDate: "2026-08-01",
      title: "Acme ships a local agent debugger",
      source: { url: "https://acme.example/agent-debugger?utm_source=feed" },
      entityKey: "acme-agent-debugger",
      eventKey: "acme-agent-debugger-v1",
    },
  ];

  for (const candidate of [
    { title: "Different title", source: { url: "https://acme.example/agent-debugger" } },
    { title: "Different title", source: { url: "https://elsewhere.example/a" }, entityKey: "acme-agent-debugger" },
    { title: "Different title", source: { url: "https://elsewhere.example/b" }, eventKey: "acme-agent-debugger-v1" },
    { title: "Acme ships local agent debugger", source: { url: "https://elsewhere.example/c" } },
  ]) {
    assert.equal(findDuplicates(candidate, existing, "2026-08-19").length, 1);
  }
});

test("findDuplicates uses a prior feed inclusion date instead of the original source publication date", () => {
  const existing = [{
    editionDate: "2026-08-18",
    publicationDate: "2024-01-01",
    title: "Acme ships a local agent debugger",
    source: { url: "https://acme.example/agent-debugger" },
    eventKey: "acme-agent-debugger-v1",
  }];
  const candidate = {
    title: "Acme ships a local agent debugger",
    source: { url: "https://acme.example/agent-debugger" },
    eventKey: "acme-agent-debugger-v1",
  };

  assert.equal(findDuplicates(candidate, existing, "2026-08-19").length, 1);
});

test("findDuplicates allows an explicit substantive update to bypass duplicate suppression", () => {
  const existing = [{
    id: "prior-signal",
    publicationDate: "2026-08-01",
    title: "Acme ships a local agent debugger",
    source: { url: "https://acme.example/agent-debugger" },
    eventKey: "acme-agent-debugger-v1",
  }];
  const candidate = {
    title: "Acme ships a local agent debugger with offline traces",
    source: { url: "https://acme.example/agent-debugger" },
    eventKey: "acme-agent-debugger-v2",
    substantiveUpdate: {
      previousItemId: "prior-signal",
      kind: "new-capability",
      reason: "Adds an offline trace store and a new reproducible debugging workflow.",
    },
  };

  assert.deepEqual(findDuplicates(candidate, existing, "2026-08-19"), []);
});

test("a substantive update bypasses only its referenced prior item", () => {
  const existing = [
    {
      id: "referenced-prior-signal",
      editionDate: "2026-08-18",
      title: "Acme adds hosted agent traces",
      source: { url: "https://acme.example/traces" },
      entityKey: "acme-hosted-traces",
    },
    {
      id: "other-prior-signal",
      editionDate: "2026-08-17",
      title: "Elsewhere ships a debugging console",
      source: { url: "https://elsewhere.example/debugger" },
      entityKey: "shared-debugging-console",
    },
  ];
  const candidate = {
    title: "Acme adds offline agent trace storage",
    source: { url: "https://acme.example/traces" },
    entityKey: "shared-debugging-console",
    substantiveUpdate: {
      previousItemId: "referenced-prior-signal",
      kind: "new-capability",
      reason: "Adds offline trace storage and a reproducible debugging workflow.",
    },
  };

  assert.deepEqual(findDuplicates(candidate, existing, "2026-08-19"), [
    { item: existing[1], reasons: ["entity-key"] },
  ]);
});

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

test("a substantive update cannot bypass an ID-less duplicate", () => {
  const existing = [{
    editionDate: "2026-08-18",
    title: "Acme ships agent traces",
    source: { url: "https://acme.example/traces" },
  }];
  const candidate = {
    title: "Acme ships agent traces with offline storage",
    source: { url: "https://acme.example/traces" },
    substantiveUpdate: {
      kind: "new-capability",
      reason: "Adds offline trace storage.",
    },
  };

  assert.equal(findDuplicates(candidate, existing, "2026-08-19").length, 1);
});

test("the evidence-first policy allows one strong item and configures GitHub discovery", () => {
  assert.equal(policy.edition.minItems, 1);
  assert.equal(policy.edition.maxItems, 40);
  assert.deepEqual(policy.discovery.githubTrendingWindows, ["daily", "weekly"]);
  assert.equal(policy.feedback.minEffectiveVotes, 10);
});

test("schema version 3 exposes the broad technology contract", () => {
  assert.equal(policy.edition.currentSchemaVersion, 3);
  assert.deepEqual(PRIMARY_CATEGORIES, [
    "AI & Automation",
    "Software & Developer Tools",
    "Web & Platforms",
    "Security & Privacy",
    "Hardware & Devices",
    "Science & Emerging Tech",
    "Consumer Technology",
    "Curiosities",
  ]);
  assert.deepEqual(validateEdition(broadEdition), []);
});

test("the broad source catalog records role, topic, and freshness metadata", () => {
  assert.equal(feeds.schemaVersion, 2);
  for (const feed of feeds.feeds.filter((item) => item.enabled !== false)) {
    assert.ok(["primary", "discovery"].includes(feed.sourceRole), feed.id);
    assert.ok(["standard", "extended"].includes(feed.freshnessClass), feed.id);
    assert.ok(Array.isArray(feed.topics) && feed.topics.length, feed.id);
    assert.ok(feed.topics.every((topic) => PRIMARY_CATEGORIES.includes(topic)), feed.id);
  }
  for (const category of PRIMARY_CATEGORIES) {
    assert.ok(feeds.feeds.filter((feed) => feed.enabled !== false && feed.topics.includes(category)).length >= 2, category);
  }
});

test("schema version 3 applies context-aware freshness", () => {
  const release = structuredClone(broadEdition);
  release.items[0].publicationDate = "2026-08-12";
  assert.ok(validateEdition(release).some((error) => error.includes("seven days")));

  const research = structuredClone(release);
  research.items[0].source.evidence.freshnessClass = "extended";
  research.items[0].source.evidence.type = "research-paper";
  research.items[0].tags = ["format:research", "topic:robotics"];
  assert.deepEqual(validateEdition(research), []);
});

test("an older repository needs edition-day Trending evidence", () => {
  const trending = structuredClone(broadEdition);
  trending.items[0].publicationDate = "2024-01-01";
  trending.items[0].source.evidence = {
    type: "repository-trending",
    freshnessClass: "current-discovery",
    observedAt: "2026-08-20",
    trendingWindows: ["daily", "weekly"],
    dateBasis: "Observed on both GitHub Trending lists on the edition date.",
    productStatus: "active",
  };
  assert.deepEqual(validateEdition(trending), []);
  trending.items[0].source.evidence.observedAt = "2026-08-19";
  assert.ok(validateEdition(trending).some((error) => error.includes("edition date")));
});

test("schema version 3 accepts a zero-item candidate pool but not a zero-item public edition", () => {
  const empty = structuredClone(broadEdition);
  empty.items = [];
  delete empty.discoveryStats;
  assert.deepEqual(validateEdition(empty, { candidatePool: true }), []);
  assert.ok(validateEdition(empty).some((error) => error.includes("between 1 and 40")));
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

  const tooMany = structuredClone(edition);
  tooMany.items = Array.from({ length: 16 }, (_, index) => ({ ...tooMany.items[index % tooMany.items.length], id: `item-${index}` }));
  assert.ok(validateEdition(tooMany).some((error) => error.includes("between 1 and 15")));

  const invalidTier = structuredClone(edition);
  invalidTier.items[0].editorialTier = "8.4";
  assert.ok(validateEdition(invalidTier).some((error) => error.includes("editorialTier")));
});

test("schema version 2 rejects retired time-to-try and score fields", () => {
  const retired = structuredClone(edition);
  retired.items[0].timeToTry = "2–5 min";
  retired.items[0].signal.impact = 8;
  retired.items[0].signal.confidence = 8;
  retired.items[0].signal.novelty = 7;

  const errors = validateEdition(retired);
  assert.ok(errors.some((error) => error.includes("timeToTry")));
  assert.ok(errors.some((error) => error.includes("signal.impact")));
  assert.ok(errors.some((error) => error.includes("signal.confidence")));
  assert.ok(errors.some((error) => error.includes("signal.novelty")));
});

test("schema version 1 is rejected unless legacy validation is enabled", () => {
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
  assert.ok(validateEdition(legacy).some((error) => error.includes("schema version 1")));
  assert.deepEqual(validateEdition(legacy, { allowLegacy: true }), []);
});

test("legacy validation reports null items without throwing", () => {
  const legacy = structuredClone(edition);
  legacy.schemaVersion = 1;
  legacy.items = null;

  assert.doesNotThrow(() => validateEdition(legacy, { allowLegacy: true }));
  assert.ok(validateEdition(legacy, { allowLegacy: true }).some((error) => error.includes("between 10 and 15")));
});

test("the manifest points to the researched current edition and the test fixture satisfies its legacy contracts", () => {
  assert.equal(manifest.latestEdition, "2026-08-20");
  assert.deepEqual(manifest.editions, ["2026-08-20"]);
  assert.equal(edition.items.length, 12);
  assert.deepEqual(validateEdition(edition), []);
});

test("the current edition omits generated action material while retaining concrete access limits", () => {
  assert.ok(currentEdition.items.every((item) => !Object.hasOwn(item, "experiment") && !Object.hasOwn(item, "caveat")));
  assert.match(currentEdition.items.find((item) => item.id === "vercel-fish-audio-ai-gateway").summary, /September 18/i);
  assert.match(currentEdition.items.find((item) => item.id === "vercel-agent-slack-public-beta").summary, /Pro and Enterprise/i);
});

test("the schema version 2 edition fixture is monotonically ordered by editorial tier", () => {
  const tierOrder = new Map(policy.editorialTiers.map((tier, index) => [tier, index]));

  for (let index = 1; index < edition.items.length; index += 1) {
    const previous = edition.items[index - 1];
    const current = edition.items[index];
    assert.ok(
      tierOrder.get(previous.editorialTier) <= tierOrder.get(current.editorialTier),
      `${current.id} (${current.editorialTier}) follows ${previous.id} (${previous.editorialTier})`,
    );
  }
});

test("validateEdition enforces verified primary sources and one to three nonempty experiment steps", () => {
  const invalid = structuredClone(edition);
  invalid.items[0].experiment.steps = ["", "Second step", "Third step", "Fourth step"];
  invalid.items[0].source.verification.status = "unverified";

  const errors = validateEdition(invalid);
  assert.ok(errors.some((error) => error.includes("one to three non-empty experiment steps")));
  assert.ok(errors.some((error) => error.includes("verified primary source")));
});

test("validateEdition permits one category without an override reason", () => {
  const concentrated = structuredClone(edition);
  for (const item of concentrated.items) item.category = "Models";
  assert.deepEqual(validateEdition(concentrated), []);
});

test("validateEdition reports a non-array item collection instead of throwing", () => {
  assert.deepEqual(validateEdition({ items: {} }), [
    "edition.date is required.",
    "edition.title is required.",
    "edition.timezone is required.",
    "edition.curatedAt must be a full ISO timestamp with a timezone.",
    "edition.summary is required.",
    "edition.schemaVersion must be 3.",
    "Edition must contain between 1 and 40 items.",
    "edition.discoveryStats.rawCandidates must be a non-negative integer.",
    "edition.discoveryStats.clusteredCandidates must be a non-negative integer.",
    "edition.discoveryStats.eligibleCandidates must be a non-negative integer.",
    "edition.discoveryStats.publishedItems must be a non-negative integer.",
    "edition.discoveryStats.trendingReviewed must be a non-negative integer.",
    "edition.discoveryStats.explorationItems must be a non-negative integer.",
  ]);
});

test("validateEdition requires top-level archive identity fields", () => {
  for (const field of ["date", "title", "timezone", "curatedAt", "summary"]) {
    const invalid = structuredClone(edition);
    delete invalid[field];
    assert.ok(validateEdition(invalid).some((error) => error.includes(`edition.${field}`)), field);
  }
});

test("validateEdition requires signal.whyNow", () => {
  const incompleteSignal = structuredClone(edition);
  delete incompleteSignal.items[0].signal.whyNow;

  assert.ok(validateEdition(incompleteSignal).some((error) => error.includes("signal.whyNow")));
});

test("validateEdition rejects a whitespace-only signal.whyNow", () => {
  const invalid = structuredClone(edition);
  invalid.items[0].signal.whyNow = "   ";

  assert.ok(validateEdition(invalid).some((error) => error.includes("signal.whyNow")));
});

test("validateEdition requires a nonempty experiment goal when an experiment is present", () => {
  for (const goal of [undefined, "   "]) {
    const invalid = structuredClone(edition);
    invalid.items[0].experiment.goal = goal;

    assert.ok(validateEdition(invalid).some((error) => error.includes("experiment.goal")));
  }
});

test("validateEdition rejects a whitespace-only optional caveat", () => {
  const invalid = structuredClone(edition);
  invalid.items[0].caveat = "   ";

  assert.ok(validateEdition(invalid).some((error) => error.includes("caveat")));
});

test("validateEdition requires complete primary-source verification metadata", () => {
  const incompleteVerification = structuredClone(edition);
  delete incompleteVerification.items[0].source.verification.verifiedAt;

  assert.ok(validateEdition(incompleteVerification).some((error) => error.includes("verification.verifiedAt")));
});

test("validateEdition rejects stale and future-dated events instead of trusting a formatted publication date", () => {
  const stale = structuredClone(edition);
  stale.date = "2026-08-20";
  stale.curatedAt = "2026-08-20T07:00:00-04:00";
  stale.items = [stale.items[0]];
  stale.items[0].publicationDate = "2026-08-12";
  stale.items[0].source.verification.verifiedAt = "2026-08-20";
  stale.items[0].source.evidence = {
    type: "release",
    dateBasis: "The official release page is dated August 12, 2026.",
    productStatus: "active",
  };

  const future = structuredClone(stale);
  future.items[0].publicationDate = "2026-08-21";

  assert.ok(validateEdition(stale).some((error) => error.includes("seven days")));
  assert.ok(validateEdition(future).some((error) => error.includes("after the edition date")));
});

test("validateEdition requires direct dated event evidence rather than generic documentation", () => {
  const documentationOnly = structuredClone(edition);
  documentationOnly.date = "2026-08-20";
  documentationOnly.curatedAt = "2026-08-20T07:00:00-04:00";
  documentationOnly.items = [documentationOnly.items[0]];
  documentationOnly.items[0].publicationDate = "2026-08-19";
  documentationOnly.items[0].source.verification.verifiedAt = "2026-08-20";
  documentationOnly.items[0].source.evidence = {
    type: "documentation",
    dateBasis: "The generic documentation page was available when checked.",
    productStatus: "active",
  };

  assert.ok(validateEdition(documentationOnly).some((error) => error.includes("direct dated event evidence")));
});

test("validateEdition permits a deprecation only as an explicitly labeled current migration notice", () => {
  const misleading = structuredClone(edition);
  misleading.date = "2026-08-20";
  misleading.curatedAt = "2026-08-20T07:00:00-04:00";
  misleading.items = [misleading.items[0]];
  misleading.items[0].publicationDate = "2026-08-20";
  misleading.items[0].source.verification.verifiedAt = "2026-08-20";
  misleading.items[0].source.evidence = {
    type: "release",
    dateBasis: "The official notice is dated August 20, 2026.",
    productStatus: "migration",
  };

  const migration = structuredClone(misleading);
  migration.items[0].title = "Acme deprecates Evals v1; migrate to Datasets";
  migration.items[0].summary = "The old API is shutting down, so builders should migrate current evaluation suites.";
  migration.items[0].source.evidence.type = "migration-notice";

  assert.ok(validateEdition(misleading).some((error) => error.includes("migration notice")));
  assert.deepEqual(validateEdition(migration), []);
});

test("validateEdition rejects an impossible edition date", () => {
  const invalidDate = structuredClone(edition);
  invalidDate.date = "2026-02-30";

  assert.ok(validateEdition(invalidDate).some((error) => error.includes("edition.date")));
});

test("validateEdition rejects an impossible item publication date", () => {
  const invalidDate = structuredClone(edition);
  invalidDate.items[0].publicationDate = "2026-13-01";

  assert.ok(validateEdition(invalidDate).some((error) => error.includes("publicationDate")));
});

test("validateEdition rejects an impossible source verification date", () => {
  const invalidDate = structuredClone(edition);
  invalidDate.items[0].source.verification.verifiedAt = "2026-04-31";

  assert.ok(validateEdition(invalidDate).some((error) => error.includes("verification.verifiedAt")));
});

test("the edition contract requires actual curation time and the visual category taxonomy", () => {
  const allowedCategories = new Set(["Models", "Tools", "Workflows", "Demos", "Utilities"]);

  assert.ok(Number.isFinite(Date.parse(edition.curatedAt)));
  assert.deepEqual(new Set(edition.items.map((item) => item.category)), allowedCategories);

  const invalid = structuredClone(edition);
  delete invalid.curatedAt;
  invalid.items[1].category = "Agents";

  const errors = validateEdition(invalid);
  assert.ok(errors.some((error) => error.includes("curatedAt")));
  assert.ok(errors.some((error) => error.includes("category")));
});

test("curatedAt requires a full ISO timestamp with an explicit timezone", () => {
  for (const curatedAt of [
    "2026-08-19",
    "2026-08-19T07:42:00",
    "August 19, 2026 07:42 EDT",
    "2026-02-30T07:42:00-04:00",
  ]) {
    const invalid = structuredClone(edition);
    invalid.curatedAt = curatedAt;
    assert.ok(validateEdition(invalid).some((error) => error.includes("curatedAt")), curatedAt);
  }

  for (const curatedAt of ["2026-08-19T07:42:00-04:00", "2026-08-19T11:42:00Z"]) {
    const valid = structuredClone(edition);
    valid.curatedAt = curatedAt;
    assert.deepEqual(validateEdition(valid), []);
  }
});

test("validateEdition rejects duplicate item IDs", () => {
  const invalid = structuredClone(edition);
  invalid.items[1].id = invalid.items[0].id;

  assert.ok(validateEdition(invalid).some((error) => error.includes("unique item id")));
});

test("validateEdition requires every item ID to be a non-empty string", () => {
  for (const id of [1, {}, "  "]) {
    const invalid = structuredClone(edition);
    invalid.items[0].id = id;
    assert.ok(validateEdition(invalid).some((error) => error.includes("item id")));
  }
});

test("validateEdition requires source text but permits omitted caveats and experiments", () => {
  for (const mutate of [
    (item) => { delete item.source.publisher; },
    (item) => { delete item.source.title; },
  ]) {
    const invalid = structuredClone(edition);
    mutate(invalid.items[0]);
    assert.ok(validateEdition(invalid).length > 0);
  }
});

test("validateEdition reports non-string optional action material instead of throwing", () => {
  for (const mutate of [
    (item) => { item.experiment = { steps: ["First step", 1] }; },
    (item) => { item.caveat = 1; },
  ]) {
    const invalid = structuredClone(edition);
    mutate(invalid.items[0]);
    assert.doesNotThrow(() => validateEdition(invalid));
    assert.ok(validateEdition(invalid).length > 0);
  }
});
