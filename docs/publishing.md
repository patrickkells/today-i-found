# Publishing today i found

## GitHub Pages

Set the repository Actions variable `FEEDBACK_API_BASE` to the public HTTPS origin of the deployed feedback Worker, without a trailing slash. The Pages build exposes it to the client as `VITE_FEEDBACK_API_BASE`; when it is absent or unreachable, voting falls back to browser-local state.

The checked-in workflow at `.github/workflows/deploy-pages.yml` installs from `package-lock.json`, validates the edition and duplicate gate, builds the Vite client, runs the test suites, and uploads only `dist/client` to GitHub Pages. The build copies `data/manifest.json` and every `data/editions/<date>.json` archive into that static directory.

Enable Pages for this repository with **GitHub Actions** as the source. Do not run a separate branch-push deploy: the workflow already supplies the Pages artifact and deployment token. For a project site, the workflow emits assets under `/<repository-name>/`. For a user or organization root site, set `VITE_BASE_PATH: /` in the build job instead.

## Curator dry run

Read `config/curation-policy.json` before creating a candidate. New candidates use edition schema version 2 and contain 1–15 qualifying items. Each item needs direct dated primary evidence published within the seven-day freshness window, `publicationDate`, structured source evidence, edition-day verification, `signal.whyNow`, `editorialTier`, and `rankingRationale`. The policy-backed validator also enforces prohibited-topic and structured substantive-update rules. It does not require category quotas or numerical quality scores. Migration and deprecation items are valid only when they cite a dated migration notice and explicitly describe the transition.

Run `npm run discover:feeds` before research to collect leads from the official RSS and Atom registry. Feed entries are discovery inputs only. Open the linked primary source, verify the claim and date, and record the direct evidence in the edition. Generic documentation cannot establish novelty.

Use a candidate edition JSON that follows the current `data/editions` contract:

```sh
node scripts/publish-edition.mjs --input /path/to/candidate.json --dry-run
```

The command validates all hard selection gates, audits every source URL, and runs deterministic 30-day duplicate checks against archived editions. The curator must separately compare candidate meaning with the recent archive so paraphrased repeats do not pass merely because their URL, keys, or normalized title differ. A dry run neither writes files nor registers an edition.

New editions do not generate `caveat` or `experiment` fields. Put only concrete, decision-relevant access, pricing, migration, compatibility, or availability limits directly into the factual summary. The interface keeps each story self-contained and links its verified primary source inline. Legacy archives may retain `caveat`, `experiment`, `impact`, `confidence`, `novelty`, `baseScore`, `adjustedScore`, or `timeToTry`; the current interface does not render them.

For a local candidate review with the Worker summary saved to disk:

```sh
node scripts/publish-edition.mjs --input /path/to/candidate.json --feedback /path/to/feedback-summary.json --dry-run
```

Feedback preferences use the policy's 90-day window, 30-day half-life, and minimum of 10 effective votes. The script averages only eligible matching category, publisher, and tag adjustments, caps the resulting `feedbackSignal` at `-0.5` to `+0.5`, and records `eligiblePreferenceCount`. Feedback can reorder items only within the same editorial tier. It cannot change tiers, selection, or any hard gate, and equal signals preserve the curator's original order. These `curation` annotations are retained in the published dated JSON archive.

After review, publish the static archive without touching a remote service:

```sh
node scripts/publish-edition.mjs --input /path/to/candidate.json
```

This writes `data/editions/<date>.json` and updates `data/manifest.json`. It does not commit, push, deploy, or create a schedule.

To retrieve protected feedback and register a validated edition with the feedback Worker before writing the static archive, put `CURATOR_TOKEN` in the scheduled task's secret store and pass the configured protected endpoints explicitly:

```sh
node scripts/publish-edition.mjs \
  --input /path/to/candidate.json \
  --feedback-url "$FEEDBACK_SUMMARY_URL" \
  --register-url "$REGISTER_EDITION_URL"
```

If validation, source auditing, duplicate checks, configured feedback retrieval, or Worker registration fails, the command exits non-zero and does not write the archive. Missing optional Worker configuration does not block a valid static-only publication. The script never commits, pushes, or deploys anything itself.

## Cloudflare Worker and D1

`feedback-worker/wrangler.toml` and `feedback-worker/.dev.vars.example` are intentionally unprovisioned examples. Before enabling remote feedback, create a D1 database, apply `feedback-worker/schema.sql`, set the real database ID and Pages origin, and configure `CURATOR_TOKEN` and a 32+-character `HMAC_SECRET` as Worker secrets. Keep those values out of Git, examples, and Codex prompts.

The static client works without this setup: it uses its local feedback fallback when the Worker is unavailable.

## Daily schedule

Use `docs/curator-scheduled-task.md` as the reusable instruction for the active Codex scheduled task. Keep it at `07:00` in `America/New_York`, attached to this repository, with protected Worker credentials only in the task's secret configuration.
