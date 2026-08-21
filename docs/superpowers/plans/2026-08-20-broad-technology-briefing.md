# Broad Technology Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `today i found` into a broad, evidence-first, strongly personalized daily technology briefing with complete candidate accounting, full GitHub Trending consideration, context-aware freshness, and up to forty published items.

**Architecture:** Add a shared schema-v3 editorial contract, richer source discovery, a private local candidate ledger, and a deterministic personalization selector in front of the existing publication pipeline. Preserve the current React reading experience and Cloudflare vote service, but use structured tags as preference dimensions and publish compact discovery statistics with each edition.

**Tech Stack:** Node.js 24 ESM, React 19, Vite 6, Node test runner, JSDOM, Cloudflare Worker + D1, static JSON archives, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-20-broad-technology-briefing-design.md`

## Global Constraints

- Brand the product as `today i found`, always in lowercase, with no subtitle or tagline.
- A published schema-v3 edition contains one to forty items; a run with no qualifying candidates publishes no edition.
- Primary categories are exactly: `AI & Automation`, `Software & Developer Tools`, `Web & Platforms`, `Security & Privacy`, `Hardware & Devices`, `Science & Emerging Tech`, `Consumer Technology`, and `Curiosities`.
- Politics, funding announcements, executive drama, market speculation, promotional fluff, copycat repositories, and routine patch releases remain excluded.
- Business and policy stories qualify only for a material technology consequence involving availability, cost, ownership, licensing, privacy, compatibility, or product continuity.
- Releases, news, security developments, and product changes use a seven-calendar-day freshness window; research, benchmarks, and exceptional explainers use fourteen calendar days.
- Older repositories qualify only through current Trending evidence, a material resurgence, or a current documented release, and must never be described as newly released without release evidence.
- Every GitHub Trending all-language daily and weekly repository must be recorded and considered; popularity is never publication evidence.
- Reader preferences act only after verification, exclusions, and duplicate checks; exploration is at most `Math.floor(publishedCount * 0.2)` and is never a quota.
- Keep the thirty-day duplicate window and structured substantive-update exceptions.
- Keep story rows self-contained. Do not restore an inspector, experiments, generic caveats, usefulness scores, time-to-try, or generic “why it matters” copy.
- Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` working for Sites packaging.
- Do not publish the private candidate ledger in `dist/client`, GitHub Pages, or the Sites artifact.
- Headline and summary prompt optimization remains a later phase; this implementation preserves evidence facts and prompt versions for controlled comparison.

---

### Task 1: Shared editorial contract and schema-v3 validation

**Files:**
- Create: `shared/editorial-contract.js`
- Modify: `config/curation-policy.json`
- Modify: `lib/curation.js`
- Modify: `scripts/validate-edition.mjs`
- Modify: `tests/foundation.test.mjs`
- Modify: `tests/fixtures/edition.json`

**Interfaces:**
- Produces: `PRIMARY_CATEGORIES`, `CATEGORY_PRESENTATION`, `STRUCTURED_TAG_PATTERN`, `freshnessLimitFor(item, policy)` from `shared/editorial-contract.js`.
- Produces: `validateEdition(edition, { allowLegacy?: boolean, candidatePool?: boolean }): string[]`.
- Preserves: archive validation for schema versions 1 and 2 when `allowLegacy: true`.
- Consumes later: every publisher, ledger, Worker registration, and React category view uses this vocabulary.

- [ ] **Step 1: Write failing schema-v3 contract tests**

Add tests that assert the exact categories, a maximum of forty public items, a larger candidate pool only with `{ candidatePool: true }`, structured tags, both freshness classes, original-reporting evidence, and current Trending evidence for an older repository:

```js
test("schema version 3 exposes the broad technology contract", () => {
  assert.equal(policy.edition.currentSchemaVersion, 3);
  assert.equal(policy.edition.maxItems, 40);
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
});

test("schema version 3 applies context-aware freshness", () => {
  const release = schemaThreeEdition({ publicationDate: "2026-08-12", freshnessClass: "standard" });
  assert.ok(validateEdition(release).some((error) => error.includes("seven days")));

  const research = schemaThreeEdition({
    publicationDate: "2026-08-12",
    freshnessClass: "extended",
    tags: ["format:research", "topic:robotics"],
  });
  assert.deepEqual(validateEdition(research), []);
});

test("an older repository needs edition-day Trending evidence", () => {
  const trending = schemaThreeEdition({
    publicationDate: "2024-01-01",
    evidence: {
      type: "repository-trending",
      freshnessClass: "current-discovery",
      observedAt: "2026-08-20",
      trendingWindows: ["daily", "weekly"],
      dateBasis: "Observed on both GitHub Trending lists on the edition date.",
      productStatus: "active",
    },
  });
  assert.deepEqual(validateEdition(trending), []);
});
```

- [ ] **Step 2: Run the focused tests and confirm the old contract fails**

Run: `node --import tsx --test tests/foundation.test.mjs`

Expected: failures for schema version 3, the category vocabulary, the forty-item limit, structured tags, extended freshness, and repository-Trending evidence.

- [ ] **Step 3: Add the shared contract and policy values**

Create `shared/editorial-contract.js` with browser-safe exports:

```js
export const PRIMARY_CATEGORIES = Object.freeze([
  "AI & Automation",
  "Software & Developer Tools",
  "Web & Platforms",
  "Security & Privacy",
  "Hardware & Devices",
  "Science & Emerging Tech",
  "Consumer Technology",
  "Curiosities",
]);

export const CATEGORY_PRESENTATION = Object.freeze({
  "AI & Automation": { short: "AI", accent: "lime" },
  "Software & Developer Tools": { short: "DEV TOOL", accent: "cyan" },
  "Web & Platforms": { short: "PLATFORM", accent: "orange" },
  "Security & Privacy": { short: "SECURITY", accent: "violet" },
  "Hardware & Devices": { short: "HARDWARE", accent: "cyan" },
  "Science & Emerging Tech": { short: "SCIENCE", accent: "lime" },
  "Consumer Technology": { short: "CONSUMER", accent: "orange" },
  Curiosities: { short: "CURIOUS", accent: "violet" },
});

export const STRUCTURED_TAG_PATTERN = /^(topic|format|entity|license|depth):[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function freshnessLimitFor(item, policy) {
  return policy.freshness.windows[item?.source?.evidence?.freshnessClass] ?? null;
}
```

Update `config/curation-policy.json` to schema version 2 with:

```json
{
  "edition": { "minItems": 1, "maxItems": 40, "maxCandidateItems": 500, "currentSchemaVersion": 3 },
  "categories": ["AI & Automation", "Software & Developer Tools", "Web & Platforms", "Security & Privacy", "Hardware & Devices", "Science & Emerging Tech", "Consumer Technology", "Curiosities"],
  "feedback": { "windowDays": 90, "halfLifeDays": 30, "minEffectiveVotes": 10, "maxAdjustment": 0.5, "explorationRatio": 0.2 },
  "freshness": {
    "windows": { "standard": 7, "extended": 14 },
    "currentDiscoveryTypes": ["repository-trending"],
    "directEvidenceTypes": ["release", "changelog", "announcement", "research-paper", "repository-release", "dated-update", "migration-notice", "original-reporting", "repository-trending"],
    "productStatuses": ["active", "migration"]
  }
}
```

Retain the existing duplicate-window, editorial-tier, feedback-decay, and substantive-update values.

- [ ] **Step 4: Implement schema-v3 validation and explicit historical validation**

Refactor `validateEdition` so schema 3 uses the shared categories, requires one to twelve structured tags, accepts `source.kind` equal to `primary` or `original-reporting`, validates the evidence class, and enforces discovery statistics only for public editions. Use `candidatePool: true` to allow zero to `maxCandidateItems` items and omit public discovery statistics; normal public validation still requires one to forty:

```js
export function validateEdition(edition, { allowLegacy = false, candidatePool = false } = {}) {
  if (edition?.schemaVersion === 1) return allowLegacy ? validateSchemaOne(edition) : [legacyError(1)];
  if (edition?.schemaVersion === 2) return allowLegacy ? validateSchemaTwo(edition) : [legacyError(2)];
  return validateSchemaThree(edition, { candidatePool });
}
```

For `current-discovery`, require `observedAt === edition.date`, at least one configured Trending window, active status, and a title/summary that does not claim a new release unless a current release date is also recorded. For normal evidence, compare calendar dates against `freshnessLimitFor`.

Change `scripts/validate-edition.mjs` to accept `--allow-legacy`; update the package command for the checked-in historical latest edition to pass it.

- [ ] **Step 5: Convert the fixture to schema 3 and run contract tests**

Update `tests/fixtures/edition.json` to the new categories and structured tags. Add valid `discoveryStats` whose `publishedItems` equals `items.length`.

Run: `node --import tsx --test tests/foundation.test.mjs tests/archive-validation.test.mjs`

Expected: all tests pass, including the schema-2 checked-in archive under `allowLegacy`.

- [ ] **Step 6: Commit the editorial contract**

```bash
git add shared/editorial-contract.js config/curation-policy.json lib/curation.js scripts/validate-edition.mjs package.json tests/foundation.test.mjs tests/archive-validation.test.mjs tests/fixtures/edition.json
git commit -m "feat: add broad technology edition contract"
```

---

### Task 2: Rich source catalog and context-aware feed discovery

**Files:**
- Modify: `config/discovery-feeds.json`
- Modify: `lib/rss-discovery.js`
- Modify: `scripts/discover-feeds.mjs`
- Modify: `tests/rss-discovery.test.mjs`
- Modify: `tests/foundation.test.mjs`

**Interfaces:**
- Consumes: `policy.freshness.windows` and the shared category names.
- Produces: `collectFeedDiscoveries({ feeds, editionDate, fetchImpl }): Promise<{ discoveries, failures }>`.
- Each discovery includes `origin`, `topics`, `sourceRole`, `freshnessClass`, canonical URL, published timestamp, and computed age.
- Preserves: `collectFeedCandidates` as a compatibility wrapper returning only candidates inside their configured window until all callers migrate in Task 3.

- [ ] **Step 1: Write failing catalog and discovery tests**

Add assertions that every enabled feed has `topics`, `sourceRole`, and `freshnessClass`; that every primary category has at least two enabled feed sources; and that feed discovery retains stale-but-parseable entries for the ledger:

```js
test("feed discovery retains entries for ledger-level freshness decisions", async () => {
  const result = await collectFeedDiscoveries({
    feeds: [{
      id: "security-feed",
      publisher: "Security Lab",
      lane: "security",
      topics: ["Security & Privacy"],
      sourceRole: "primary",
      freshnessClass: "standard",
      url: "https://example.test/feed.xml",
    }],
    editionDate: "2026-08-20",
    fetchImpl: async () => new Response(rssWithDate("2026-07-01")),
  });
  assert.equal(result.discoveries.length, 1);
  assert.equal(result.discoveries[0].ageDays, 50);
  assert.equal(result.discoveries[0].sourceRole, "primary");
});
```

- [ ] **Step 2: Run feed tests and confirm the richer contract fails**

Run: `node --import tsx --test tests/rss-discovery.test.mjs tests/foundation.test.mjs`

Expected: failures for missing source metadata and missing `collectFeedDiscoveries`.

- [ ] **Step 3: Expand the machine-readable catalog**

Bump `config/discovery-feeds.json` to schema version 2. Preserve the existing feeds and add these initial broad-technology sources with explicit roles and topics:

```text
Chrome for Developers — https://developer.chrome.com/static/blog/feed.xml
web.dev — https://web.dev/feed.xml
Mozilla Hacks — https://hacks.mozilla.org/feed/
Apple Developer News — https://developer.apple.com/news/rss/news.rss
AWS What's New — https://aws.amazon.com/about-aws/whats-new/recent/feed/
Microsoft Developer Blogs — https://devblogs.microsoft.com/feed/
Google Developers Blog — https://developers.googleblog.com/feeds/posts/default
Rust Blog — https://blog.rust-lang.org/feed.xml
Python Insider — https://feeds.feedburner.com/PythonInsider
Node.js Blog — https://nodejs.org/en/feed/blog.xml
Kubernetes Blog — https://kubernetes.io/feed.xml
Docker Blog — https://www.docker.com/blog/feed/
Cloudflare Blog — https://blog.cloudflare.com/rss/
Google Project Zero — https://googleprojectzero.blogspot.com/feeds/posts/default
GitHub Security Lab — https://github.blog/security/vulnerability-research/feed/
Raspberry Pi News — https://www.raspberrypi.com/news/feed/
Hackaday — https://hackaday.com/blog/feed/
IEEE Spectrum — https://spectrum.ieee.org/feeds/feed.rss
MIT News Technology — https://news.mit.edu/rss/topic/technology
MIT Technology Review — https://www.technologyreview.com/feed/
Ars Technica — https://feeds.arstechnica.com/arstechnica/index
404 Media — https://www.404media.co/rss/
The Register — https://www.theregister.com/headlines.atom
Wired — https://www.wired.com/feed/rss
The Verge — https://www.theverge.com/rss/index.xml
Hacker News — https://news.ycombinator.com/rss
Lobsters — https://lobste.rs/rss
arXiv Software Engineering — https://rss.arxiv.org/rss/cs.SE
arXiv Cryptography and Security — https://rss.arxiv.org/rss/cs.CR
arXiv Robotics — https://rss.arxiv.org/rss/cs.RO
```

Mark official changelogs, maintainer blogs, advisories, and research feeds as `primary`. Mark publications and communities as `discovery`. Use `extended` only for research and substantial-explainer lanes; use `standard` elsewhere. Disable any endpoint that fails the live verification in Task 8 and record its replacement or failure in the source report instead of silently deleting the lane.

- [ ] **Step 4: Implement discovery metadata and compatibility filtering**

Rename the unfiltered collector internally and attach deterministic metadata:

```js
export async function collectFeedDiscoveries({ feeds, editionDate, fetchImpl = globalThis.fetch }) {
  // Parse every dated entry in each enabled feed, canonicalize its URL,
  // retain one record per feed+canonical URL, and return per-feed failures.
}

export async function collectFeedCandidates(options) {
  const result = await collectFeedDiscoveries(options);
  const windows = options.freshnessWindows ?? { standard: options.maxAgeDays, extended: options.maxAgeDays };
  return {
    candidates: result.discoveries.filter((item) => item.ageDays >= 0 && item.ageDays <= windows[item.freshnessClass]),
    failures: result.failures,
  };
}
```

Update `scripts/discover-feeds.mjs` to output `rawDiscoveryCount`, `freshCandidateCount`, per-topic counts, and failures without treating one failed feed as a global failure.

- [ ] **Step 5: Run feed and catalog tests**

Run: `node --import tsx --test tests/rss-discovery.test.mjs tests/foundation.test.mjs`

Expected: all tests pass with deterministic feed metadata and no network access in tests.

- [ ] **Step 6: Commit the expanded catalog**

```bash
git add config/discovery-feeds.json lib/rss-discovery.js scripts/discover-feeds.mjs tests/rss-discovery.test.mjs tests/foundation.test.mjs
git commit -m "feat: broaden technology source discovery"
```

---

### Task 3: Full GitHub Trending discovery and private candidate ledger

**Files:**
- Create: `lib/github-trending.js`
- Create: `lib/candidate-ledger.js`
- Create: `scripts/discover-candidates.mjs`
- Create: `tests/github-trending.test.mjs`
- Create: `tests/candidate-ledger.test.mjs`
- Create: `tests/fixtures/github-trending.html`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Produces: `collectTrendingRepositories({ windows, editionDate, fetchImpl }): Promise<{ discoveries, failures }>`.
- Produces: `createCandidateLedger({ editionDate, discoveries, failures })`, `setCandidateDecision(ledger, discoveryId, decision)`, `summarizeCandidateLedger(ledger)`, and `validateCandidateLedger(ledger, candidateEdition?)`.
- Produces: `publicDiscoveryStats(ledger, { publishedItems, explorationItems })`, returning the six public integer counts required by schema 3.
- Produces: `.curation/ledgers/YYYY-MM-DD.json`, which is local, retained, and ignored by Git.
- Consumes later: publishing reads a completed ledger and derives public discovery statistics.

- [ ] **Step 1: Write failing Trending parser tests**

Use a small saved HTML fixture containing overlapping daily and weekly repositories. Assert canonical repository identities and merged windows:

```js
test("daily and weekly Trending lists account for every unique repository", async () => {
  const result = await collectTrendingRepositories({
    windows: ["daily", "weekly"],
    editionDate: "2026-08-20",
    fetchImpl: trendingFixtureFetch,
  });
  assert.deepEqual(result.discoveries.map((item) => item.repository), [
    "acme/one",
    "acme/shared",
    "other/two",
  ]);
  assert.deepEqual(result.discoveries.find((item) => item.repository === "acme/shared").trendingWindows, ["daily", "weekly"]);
});
```

- [ ] **Step 2: Write failing ledger accounting tests**

Cover exact URL clustering, pending-decision rejection, enumerated rejection reasons, Trending accounting, candidate-edition reconciliation, and summary totals:

```js
test("a completed ledger reconciles every eligible item and Trending rejection", () => {
  let ledger = createCandidateLedger({ editionDate: "2026-08-20", discoveries, failures: [] });
  ledger = setCandidateDecision(ledger, "feed:a", { status: "eligible", itemId: "item-a", rationale: "Current release." });
  ledger = setCandidateDecision(ledger, "github:acme/old", { status: "rejected", reason: "inactive", rationale: "No activity in twelve months." });
  assert.deepEqual(validateCandidateLedger(ledger, { items: [{ id: "item-a" }] }), []);
  assert.deepEqual(summarizeCandidateLedger(ledger), {
    rawCandidates: 2,
    clusteredCandidates: 2,
    eligibleCandidates: 1,
    rejectedCandidates: 1,
    trendingReviewed: 1,
    feedFailures: 0,
  });
});
```

- [ ] **Step 3: Run the focused tests and confirm both modules are absent**

Run: `node --test tests/github-trending.test.mjs tests/candidate-ledger.test.mjs`

Expected: module-not-found failures.

- [ ] **Step 4: Implement complete all-language Trending collection**

Fetch exactly:

```js
const TRENDING_URL = "https://github.com/trending?since=";
```

Parse every `article.Box-row` repository link, normalize `owner/name`, retain description and displayed language when present, merge the daily and weekly windows, and return a failure for a window whose page cannot be fetched or parsed. Assign discovery IDs as `github:<owner>/<name>`.

- [ ] **Step 5: Implement the ledger and rejection vocabulary**

Use schema version 1 with immutable discovery records and explicit decisions. Exact canonical URLs cluster automatically. The curator may assign a shared `clusterId` to semantically overlapping coverage before making one cluster-level decision; validation requires all members to resolve through that cluster and counts the cluster once. Accept only these rejection codes:

```js
export const REJECTION_REASONS = Object.freeze([
  "stale",
  "duplicate",
  "prohibited-topic",
  "business-no-practical-consequence",
  "routine-change",
  "inactive",
  "unavailable",
  "unverifiable",
  "low-substance",
  "copycat",
  "superseded",
  "clustered",
  "not-selected",
]);
```

Every `eligible` decision requires an `itemId` and rationale. Every `rejected` decision requires a reason and evidence-backed rationale. `validateCandidateLedger` rejects pending clusters, unaccounted Trending repositories, duplicate item IDs, candidate items without eligible ledger records, and eligible ledger records absent from the candidate edition.

- [ ] **Step 6: Add the combined discovery script and private path**

Add `.curation/` to `.gitignore`. `scripts/discover-candidates.mjs` must collect RSS and Trending concurrently, create the initial ledger, and write `.curation/ledgers/<date>.json` with `pending` decisions. It prints deterministic raw, clustered, Trending, topic, and failure totals.

Add:

```json
"discover:candidates": "node scripts/discover-candidates.mjs"
```

to `package.json`.

- [ ] **Step 7: Run ledger and Trending tests**

Run: `node --test tests/github-trending.test.mjs tests/candidate-ledger.test.mjs`

Expected: all tests pass, with no live network access.

- [ ] **Step 8: Commit discovery accounting**

```bash
git add .gitignore package.json lib/github-trending.js lib/candidate-ledger.js scripts/discover-candidates.mjs tests/github-trending.test.mjs tests/candidate-ledger.test.mjs tests/fixtures/github-trending.html
git commit -m "feat: account for trending and discovery candidates"
```

---

### Task 4: Preference-first selection with controlled exploration

**Files:**
- Modify: `lib/editorial-ranking.js`
- Modify: `feedback-worker/index.js`
- Modify: `tests/curator-feedback.test.mjs`
- Modify: `tests/feedback-worker.test.mjs`

**Interfaces:**
- Replaces: `applyFeedbackTieBreak` as the publishing entry point.
- Produces: `selectPersonalizedItems(items, feedback, { maxItems, explorationRatio }): { items, stats }`.
- `stats` is `{ eligiblePreferenceGroups, personalizedItems, editorialItems, explorationItems }`.
- Structured tags supply preference dimensions such as `topic:robotics`, `format:release`, `entity:react`, `license:open-source`, and `depth:technical` without a D1 schema migration.

- [ ] **Step 1: Replace tie-break tests with preference-first selection tests**

Cover cold start, insufficient evidence, eligible category/source/tag feedback, more than forty candidates, the eight-item exploration maximum at forty, the floor rule for smaller outputs, deterministic ordering, and no mutation:

```js
test("eligible preferences select thirty-two matches and eight exploration items from fifty", () => {
  const items = makeItems(50);
  const result = selectPersonalizedItems(items, feedbackFavoring("topic:security"), {
    maxItems: 40,
    explorationRatio: 0.2,
  });
  assert.equal(result.items.length, 40);
  assert.equal(result.stats.explorationItems, 8);
  assert.equal(result.items.filter((item) => item.curation.selectionMode === "exploration").length, 8);
  assert.ok(result.items.slice(0, 32).every((item) => item.curation.preferenceSignal >= 0));
});

test("cold start uses editorial order and does not manufacture exploration", () => {
  const items = makeItems(45);
  const result = selectPersonalizedItems(items, {}, { maxItems: 40, explorationRatio: 0.2 });
  assert.deepEqual(result.items.map((item) => item.id), items.slice(0, 40).map((item) => item.id));
  assert.equal(result.stats.explorationItems, 0);
});
```

- [ ] **Step 2: Run selector tests and confirm current tier-first behavior fails**

Run: `node --test tests/curator-feedback.test.mjs`

Expected: failures because feedback currently reorders only within an editorial tier and never selects from a pool larger than the public limit.

- [ ] **Step 3: Implement the deterministic selector**

Build eligible preference maps from feedback groups meeting `policy.feedback.minEffectiveVotes`. Compute each item’s internal preference signal as the mean of eligible matches across category, publisher, and structured tags, clamped to the policy range. Do not expose a usefulness score.

When no eligible preference groups exist, return the first `maxItems` in curator order with `selectionMode: "editorial"`. When the pool exceeds `maxItems` and eligible preferences exist:

```js
const explorationLimit = Math.floor(maxItems * explorationRatio);
const personalizedLimit = maxItems - explorationLimit;
```

Select `personalizedLimit` by preference signal, then editorial tier, then input order. Select exploration from the best remaining candidates in original editorial order. Interleave one exploration item after every four personalized items while preserving the order inside both groups. Mark only those inserted items as `exploration`.

- [ ] **Step 4: Validate structured preference tags in the Worker**

Keep the D1 schema and public vote API unchanged. Update protected edition registration to allow one to forty items and the eight schema-v3 categories. Continue aggregating each structured string in `tags_json` as an independent preference group. Reject malformed schema-v3 tags before registration.

- [ ] **Step 5: Run selector and Worker tests**

Run: `node --test tests/curator-feedback.test.mjs tests/feedback-worker.test.mjs tests/feedback-schema.test.mjs`

Expected: all tests pass; public vote responses remain unchanged and protected summaries include structured tag preferences.

- [ ] **Step 6: Commit personalized selection**

```bash
git add lib/editorial-ranking.js feedback-worker/index.js tests/curator-feedback.test.mjs tests/feedback-worker.test.mjs
git commit -m "feat: personalize briefing selection"
```

---

### Task 5: Ledger-aware publication and public discovery statistics

**Files:**
- Modify: `lib/publishing.js`
- Modify: `lib/candidate-ledger.js`
- Modify: `scripts/publish-edition.mjs`
- Modify: `tests/publish-edition.test.mjs`
- Modify: `tests/candidate-ledger.test.mjs`

**Interfaces:**
- `publishEdition` gains `ledgerFile?: string` and returns either `{ edition, dryRun, ledgerPreview }` or `{ edition: null, dryRun, skipped: true, reason: "no-qualifying-candidates" }`.
- `publicationErrors` gains `{ candidatePool?: boolean }` and passes that option to schema validation while retaining duplicate checks across the full candidate pool.
- Candidate input uses schema 3 and `validateEdition(candidate, { candidatePool: true })`.
- Public output uses `selectPersonalizedItems`, includes `discoveryStats`, and passes normal `validateEdition`.
- A successful non-dry-run updates only the local ledger’s selection fields after registration and public writes succeed.

- [ ] **Step 1: Write failing publication integration tests**

Add tests for a fifty-item eligible candidate input, exact ledger reconciliation, feedback-first selection, eight exploration selections, derived discovery statistics, dry-run immutability, no-edition behavior when the ledger has zero eligible candidates, and ledger write ordering after registration:

```js
test("publication derives a forty-item personalized edition from a completed ledger", async () => {
  const result = await publishEdition({
    input: candidatePoolFile,
    ledgerFile,
    feedbackFile,
    dryRun: true,
    auditSources: false,
  });
  assert.equal(result.edition.items.length, 40);
  assert.equal(result.edition.discoveryStats.rawCandidates, 60);
  assert.equal(result.edition.discoveryStats.publishedItems, 40);
  assert.equal(result.edition.discoveryStats.explorationItems, 8);
  assert.equal(await readFile(ledgerFile, "utf8"), ledgerBefore);
});

test("a completed zero-eligible ledger skips publication without touching the manifest", async () => {
  const result = await publishEdition({ input: emptyPoolFile, ledgerFile, manifestFile, dryRun: false });
  assert.deepEqual(result, { edition: null, dryRun: false, skipped: true, reason: "no-qualifying-candidates" });
  assert.equal(await readFile(manifestFile, "utf8"), manifestBefore);
});
```

- [ ] **Step 2: Run publishing tests and confirm ledger support is absent**

Run: `node --import tsx --test tests/publish-edition.test.mjs tests/candidate-ledger.test.mjs`

Expected: failures for unknown ledger input, the fifteen-item limit, and missing public statistics.

- [ ] **Step 3: Integrate validation, selection, statistics, and skip behavior**

Update the publication order to:

```js
const candidate = await readJson(input);
const ledger = ledgerFile ? await readJson(ledgerFile) : null;
assertNoErrors(validateEdition(candidate, { candidatePool: true }));
assertNoErrors(validateCandidateLedger(ledger, candidate));
if (!(candidate.items ?? []).length) return skippedResult();
assertNoErrors(publicationErrors(candidate, history, { candidatePool: true }));
const selection = selectPersonalizedItems(candidate.items, feedback, policy.feedback);
const edition = {
  ...candidate,
  items: selection.items,
  discoveryStats: publicDiscoveryStats(ledger, {
    publishedItems: selection.items.length,
    explorationItems: selection.stats.explorationItems,
  }),
};
assertNoErrors(publicationErrors(edition, history));
```

Audit sources for every candidate that could publish before selection so personalization cannot bypass verification. Preserve the existing rule that dry runs never register, write public files, update manifests, or mutate ledgers.

- [ ] **Step 4: Add the required ledger CLI option and report totals**

Add `--ledger` to `scripts/publish-edition.mjs`. Require it for schema-v3 publication. Print discovered, clustered, eligible, rejected, published, Trending-reviewed, exploration, and feed-failure totals for both dry runs and publication. Print “No edition published” for the zero-eligible result and exit successfully.

- [ ] **Step 5: Run focused publication tests**

Run: `node --import tsx --test tests/publish-edition.test.mjs tests/candidate-ledger.test.mjs tests/archive-validation.test.mjs`

Expected: all tests pass, and historical archives remain valid.

- [ ] **Step 6: Commit ledger-aware publication**

```bash
git add lib/publishing.js lib/candidate-ledger.js scripts/publish-edition.mjs tests/publish-edition.test.mjs tests/candidate-ledger.test.mjs
git commit -m "feat: publish from accounted candidate ledgers"
```

---

### Task 6: Broad category filters, tags, and edition transparency in React

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/app-state.js`
- Modify: `src/styles.css`
- Modify: `tests/interface-state.test.mjs`
- Modify: `tests/interface-dom.test.jsx`
- Modify: `tests/responsive-css.test.mjs`

**Interfaces:**
- Consumes: `PRIMARY_CATEGORIES` and `CATEGORY_PRESENTATION` from `shared/editorial-contract.js`.
- Produces: `displayTag(tag): string` for namespaced tag labels.
- `filterSignals` searches title, summary, publisher, category, and tags.
- `EditionTransparency({ stats })` renders only when a schema-v3 edition supplies valid discovery statistics.

- [ ] **Step 1: Write failing state and DOM tests**

Assert all eight categories can filter, structured tags are searchable, rows show human-readable tags, legacy schema-2 items still render, and the transparency line uses exact counts:

```jsx
test("the edition reports candidate and exploration accounting", () => {
  render(<App edition={broadEdition} feedbackService={canonicalService()} />);
  assert.ok(screen.getByText("28 selected from 314 candidates"));
  assert.ok(screen.getByText("9 GitHub Trending reviewed"));
  assert.ok(screen.getByText("6 exploration picks"));
});

test("structured tags are readable and searchable", async () => {
  render(<App edition={broadEdition} feedbackService={canonicalService()} />);
  assert.ok(screen.getByText("OPEN SOURCE"));
  assert.equal(filterSignals(broadEdition.items, { categories: [], query: "robotics" }).length, 1);
});
```

- [ ] **Step 2: Run UI tests and confirm current categories and search fail**

Run: `node --import tsx --test tests/interface-state.test.mjs tests/interface-dom.test.jsx tests/responsive-css.test.mjs`

Expected: failures because the app hardcodes five AI-era categories, does not render tags, and has no discovery-statistics view.

- [ ] **Step 3: Replace category constants with the shared contract**

Import `PRIMARY_CATEGORIES` and `CATEGORY_PRESENTATION`. Keep a legacy presentation fallback for `Models`, `Tools`, `Workflows`, `Demos`, and `Utilities` so the current archived edition remains readable. Build filter entries only from categories present in the active edition.

- [ ] **Step 4: Render compact tags and transparent edition totals**

Add `displayTag`:

```js
export function displayTag(tag = "") {
  const value = tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
  return value.replaceAll("-", " ").toUpperCase();
}
```

Render up to four nonredundant tag pills below each summary. Add a compact `edition-transparency` row above the story list using `rawCandidates`, `publishedItems`, `trendingReviewed`, and `explorationItems`. Do not render the row for historical editions without stats.

- [ ] **Step 5: Extend search and responsive styles**

Include `item.tags` in `filterSignals`. Add wrapping tag styles and ensure the category and vote columns remain aligned while story rows grow. At phone width, let category and tags wrap below the source without truncation. Preserve all current focus outlines and keyboard navigation.

- [ ] **Step 6: Run the complete UI suite**

Run: `node --import tsx --test tests/interface-state.test.mjs tests/interface-dom.test.jsx tests/responsive-css.test.mjs`

Expected: all tests pass for broad and legacy editions at desktop, tablet, and phone contracts.

- [ ] **Step 7: Commit the reading experience update**

```bash
git add src/App.jsx src/app-state.js src/styles.css tests/interface-state.test.mjs tests/interface-dom.test.jsx tests/responsive-css.test.mjs
git commit -m "feat: show broad topics and discovery context"
```

---

### Task 7: Scheduled curator workflow, evidence corpus, and operating documentation

**Files:**
- Modify: `docs/curator-scheduled-task.md`
- Modify: `docs/publishing.md`
- Create: `docs/source-catalog.md`
- Modify: `scripts/discover-candidates.mjs`
- Modify: `tests/pages-config.test.mjs`
- Modify: `AGENTS.md`

**Interfaces:**
- Daily task runs `npm run discover:candidates -- --edition-date YYYY-MM-DD` before curation.
- The task completes `.curation/ledgers/YYYY-MM-DD.json`, writes `.curation/candidates/YYYY-MM-DD.json`, and publishes with `--ledger`.
- Each eligible ledger record preserves `copy.promptVersion`, `copy.evidenceFacts`, `copy.title`, and `copy.summary` for later prompt calibration.

- [ ] **Step 1: Write failing workflow-document tests**

Assert the scheduled instruction names all eight categories, forty items, complete all-language Trending daily and weekly discovery, seven/fourteen-day freshness, candidate-ledger accounting, preference-first selection, twenty-percent exploration ceiling, the copy-evidence fields, and skip-publication behavior.

```js
test("the curator instruction describes the broad accounted workflow", async () => {
  const text = await readFile("docs/curator-scheduled-task.md", "utf8");
  assert.match(text, /one to forty/i);
  assert.match(text, /complete GitHub Trending all-language daily and weekly/i);
  assert.match(text, /candidate ledger/i);
  assert.match(text, /twenty percent/i);
  assert.match(text, /promptVersion/);
  assert.match(text, /publish no edition/i);
});
```

- [ ] **Step 2: Run workflow tests and confirm the old AI-only instructions fail**

Run: `node --test tests/pages-config.test.mjs`

Expected: failures for old categories, old maximum, old source lanes, and missing ledger/copy evidence.

- [ ] **Step 3: Rewrite the scheduled curator instruction**

Make the task execute this exact order:

```text
1. Read config/curation-policy.json and docs/source-catalog.md.
2. Run discovery for the edition date and preserve every feed and Trending candidate.
3. Cluster duplicate coverage and inspect every GitHub Trending repository.
4. Complete every ledger decision with evidence and an enumerated rejection reason.
5. Verify all eligible candidates against primary evidence or credible original reporting.
6. Compare candidate meaning with the previous thirty days.
7. Retrieve protected feedback when available; continue in cold-start mode when unavailable.
8. Preserve exact evidence facts and promptVersion for generated story copy.
9. Dry-run with the completed ledger, run tests and build, then publish and register only if every gate passes.
10. Commit and push only public edition, manifest, policy, source, and application changes; never commit .curation.
11. Report every discovery, decision, selection, test, registration, commit, push, and deployment total.
```

The instruction explicitly says not to optimize title and summary prompts yet. It uses a stable baseline label `broad-tech-baseline-v1` only to make the later comparison reproducible.

- [ ] **Step 4: Document the source roles and daily commands**

`docs/source-catalog.md` lists every configured source by lane, primary/discovery role, topic coverage, and freshness class. `docs/publishing.md` documents the private `.curation` paths, zero-item skip, candidate-pool validation, public 40-item validation, personalization, exploration, and exact dry-run command:

```bash
node scripts/publish-edition.mjs \
  --input .curation/candidates/YYYY-MM-DD.json \
  --ledger .curation/ledgers/YYYY-MM-DD.json \
  --feedback-url "$FEEDBACK_SUMMARY_URL" \
  --register-url "$EDITION_REGISTER_URL" \
  --dry-run
```

- [ ] **Step 5: Update durable project guidance and the active scheduled task**

Keep `AGENTS.md` aligned with the approved spec and add the exact private-ledger and prompt-version rules. Use the Codex automation update capability to replace the active `publish-build-signal-daily-edition` prompt with the contents and commands from `docs/curator-scheduled-task.md`, keeping its `07:00` `America/New_York` schedule, repository, and notification settings unchanged.

- [ ] **Step 6: Run workflow tests**

Run: `node --test tests/pages-config.test.mjs`

Expected: all documentation and workflow contract tests pass.

- [ ] **Step 7: Commit operating documentation**

```bash
git add AGENTS.md docs/curator-scheduled-task.md docs/publishing.md docs/source-catalog.md scripts/discover-candidates.mjs tests/pages-config.test.mjs
git commit -m "docs: define broad daily curation workflow"
```

---

### Task 8: Full verification, live discovery dry run, and deployment

**Files:**
- Modify only if a verification failure proves it necessary: files already named in Tasks 1–7.
- Do not modify: `data/editions/2026-08-20.json` merely to make new-schema tests easier; it remains a historical schema-2 archive.

**Interfaces:**
- Verifies: Node tests, feedback tests, Sites packaging, archive compatibility, live source coverage, complete Trending accounting, browser behavior, GitHub Pages deployment, and active daily automation.
- Produces: no new public edition unless a fully completed and verified current-date ledger exists.

- [ ] **Step 1: Run static and unit verification**

Run:

```bash
npm test
npm run test:feedback
npm run validate:archives
npm run build
npm run test:sites
```

Expected: every test passes; build leaves `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`; `.curation` is absent from `dist/client`.

- [ ] **Step 2: Run live source discovery for the current New York date**

Run:

```bash
npm run discover:candidates -- --edition-date 2026-08-20
```

Expected: the script writes `.curation/ledgers/2026-08-20.json`, reports nonzero feed and GitHub Trending discovery totals, accounts for both daily and weekly Trending windows, and reports failures per feed without losing successful lanes.

- [ ] **Step 3: Validate source-lane health**

Inspect the live report. Each primary category must retain at least two functioning configured sources. For a failed source, confirm the endpoint failure directly, disable it with a `disabledReason` and `checkedAt`, and add a working source in the same topic and role before rerunning discovery. Do not count a redirected HTML landing page as a valid feed.

- [ ] **Step 4: Verify privacy and accounting**

Confirm `.curation/ledgers/2026-08-20.json` contains every Trending repository and each record begins pending. Confirm `git status --short --ignored` marks `.curation/` ignored. Confirm neither `find dist/client -path '*curation*'` nor `find dist/client -iname '*ledger*'` returns a path.

- [ ] **Step 5: Test the built site in the in-app browser**

Run the local preview and inspect the latest historical edition plus a schema-v3 test fixture at 1488×1024, 1024×768, 768×1024, and 390×844. Verify category counts, tag wrapping, exact transparency totals, inline source links, voting fallback, search by tag, keyboard `j`/`k`, filter drawer, and no text truncation or horizontal overflow.

- [ ] **Step 6: Run final regression verification**

Run:

```bash
npm test
npm run test:feedback
npm run validate:archives
npm run build
npm run test:sites
git diff --check
git status --short
```

Expected: all commands pass and only intentional tracked changes remain.

- [ ] **Step 7: Commit any evidence-based verification fixes**

If Step 6 required a fix, stage the complete implementation file set; unchanged paths are ignored by Git:

```bash
git add shared/editorial-contract.js config/curation-policy.json config/discovery-feeds.json lib/curation.js lib/rss-discovery.js lib/github-trending.js lib/candidate-ledger.js lib/editorial-ranking.js lib/publishing.js scripts/validate-edition.mjs scripts/discover-feeds.mjs scripts/discover-candidates.mjs scripts/publish-edition.mjs src/App.jsx src/app-state.js src/styles.css feedback-worker/index.js tests docs AGENTS.md package.json .gitignore
git commit -m "fix: complete broad briefing verification"
```

If no fix was required, do not create an empty commit.

- [ ] **Step 8: Publish the application changes**

Push the completed commits to the GitHub Pages source branch used by `.github/workflows/deploy-pages.yml`. If work occurred on a feature branch, fast-forward or merge it into `main` without rewriting history, then push `main`.

- [ ] **Step 9: Verify production and automation**

Confirm the GitHub Pages workflow succeeds and open `https://patrickkells.github.io/today-i-found/`. Verify the public site loads the archived edition, source links, filters, votes, and responsive layout. Confirm the daily automation remains enabled at 7:00 AM America/New_York and its prompt contains the candidate-ledger workflow. Report the deployed commit, workflow result, live URL, source-lane totals, Trending totals, and any disabled feeds.
