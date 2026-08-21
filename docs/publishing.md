# Publishing today i found

## GitHub Pages

The checked-in workflow at `.github/workflows/deploy-pages.yml` validates archives, builds the Vite client, runs the Node and feedback suites, and uploads only `dist/client`. The build copies `data/manifest.json` and `data/editions/*.json`; it must never copy `.curation`.

Set the repository Actions variable `FEEDBACK_API_BASE` to the public feedback Worker origin without a trailing slash. When it is absent or unreachable, voting falls back locally without blocking editions.

## Private curation workspace

Daily discovery and evidence live outside the public artifact:

```text
.curation/ledgers/YYYY-MM-DD.json
.curation/candidates/YYYY-MM-DD.json
```

`.curation/` is ignored by Git. The ledger records every discovery, cluster, decision, rejection reason, copy evidence, and final selection. It is the source for exact candidate totals and exclusion answers.

Create the day's ledger:

```sh
npm run discover:candidates -- --edition-date YYYY-MM-DD
```

Complete every ledger decision before publishing. Candidate editions use schema version 3, zero to 500 eligible items, the eight broad categories, structured tags, and context-aware evidence. The public publisher emits one to forty items. A completed zero-eligible ledger produces no edition and does not update the manifest.

## Evidence and copy

Use a seven-day window for releases, news, security developments, and product changes. Use fourteen days for research, benchmarks, and exceptional explainers. An older repository needs current Trending or resurgence evidence and copy that says it is being rediscovered rather than newly released.

Prefer primary evidence. Credible original reporting may establish facts unavailable from a primary source. Community and popularity signals cannot be the sole evidence.

Each eligible ledger record retains:

```json
{
  "copy": {
    "promptVersion": "broad-tech-copy-v2",
    "evidenceFacts": ["Exact source-supported fact."],
    "title": "Published title",
    "summary": "Published factual summary."
  }
}
```

Generate this copy with `config/copy-prompt.md`. The publisher rejects obsolete prompt versions, unsupported factual anchors, generic AI phrasing, decorative headline verbs, excessive length, and summaries that repeat their titles.

## Dry run and publication

Run a static dry run:

```sh
node scripts/publish-edition.mjs \
  --input .curation/candidates/YYYY-MM-DD.json \
  --ledger .curation/ledgers/YYYY-MM-DD.json \
  --dry-run
```

With protected feedback:

```sh
node scripts/publish-edition.mjs \
  --input .curation/candidates/YYYY-MM-DD.json \
  --ledger .curation/ledgers/YYYY-MM-DD.json \
  --feedback-url "$FEEDBACK_SUMMARY_URL" \
  --register-url "$REGISTER_EDITION_URL" \
  --dry-run
```

The dry run validates the candidate pool and ledger, audits sources, checks the previous thirty days for deterministic duplicates, applies eligible preference-first selection, enforces the twenty-percent exploration ceiling, validates the one-to-forty-item public edition, and writes nothing.

Remove `--dry-run` only after review. Registration happens before public archive writes. Missing optional Worker configuration does not block a valid static-only publication. A configured feedback or registration failure does block publication.

Feedback uses a ninety-day window, thirty-day half-life, Bayesian smoothing, and a minimum of ten effective votes per category, publisher, or structured tag. It never bypasses evidence, freshness, exclusions, or duplicate checks. Cold-start runs preserve curator order and do not manufacture exploration picks.

## Cloudflare Worker and D1

The Worker stores public vote counts and protected preference summaries. Keep `CURATOR_TOKEN` and the 32-character-or-longer `HMAC_SECRET` in Worker or task secrets, never files or prompts. The D1 schema remains unchanged because structured tag strings carry the new preference dimensions.

## Daily schedule

Use `docs/curator-scheduled-task.md` for the enabled task. Keep it at `07:00` in `America/New_York`, attached to this repository, with protected endpoints and tokens only in task secret configuration.
