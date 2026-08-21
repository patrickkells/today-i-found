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

`ALLOWED_ORIGIN` is a comma-separated list of exact origins. Production permits both `https://patrickkells.github.io` and `https://today-i-found.pages.dev`. Add local preview origins explicitly in `.dev.vars`; wildcard and hostname-suffix matching are not supported.

The Worker stores public vote counts and protected preference summaries. Keep `CURATOR_TOKEN` and the 32-character-or-longer `HMAC_SECRET` in Worker or task secrets, never files or prompts. The D1 schema remains unchanged because structured tag strings carry the new preference dimensions.

## Daily schedule

Use `docs/curator-scheduled-task.md` for the enabled task. Keep it at `07:00` in `America/New_York`, attached to this repository, with protected endpoints and tokens only in task secret configuration.

Every scheduled or watchdog run uses the same atomic, date-scoped gate in `.curation/run-gates`. Scheduled claims write their private identity to a mode-0600 file under ignored `.curation/run-claims`; CLI output contains only public state, and later renewal, assertion, receipt, failure, and finalization commands consume that file. Owners renew the two-hour lease between stages and assert ownership immediately before public writes and commit/push. Failed or expired claims may be retried, and completed dates reject duplicate claims. `node scripts/publication-run-gate.mjs status --date YYYY-MM-DD` reports only operational state.

The local watchdog runs at login and every fifteen minutes through its optional user LaunchAgent. Runtime eligibility begins at 07:15 America/New_York, regardless of the Mac's current timezone, so the first periodic run after wake catches a missed publication. It always checks the date gate rather than trusting a local archive file. While Codex runs, it renews the lease and terminates the child process if ownership is lost. It uses saved ChatGPT authentication with `gpt-5.6-sol`, high reasoning, live search, automatic approval review inside the workspace-write sandbox, ephemeral execution, and ignored user provider configuration while preserving user/project execution-policy rules. It removes API-key environment variables and never falls back to another model or cloud execution.

Successful runs require a validated machine-readable receipt under `.curation/run-receipts`, and the scheduled CLI can settle the gate only through receipt-validating `finalize`. A no-edition receipt is accepted only for a completed ledger with zero eligible candidates. A published receipt requires a valid current archive and manifest plus recorded success for full tests, feedback tests, archive validation, build, Sites tests, configured registration, commit/push, and verified deployment. It records SHA-256 bindings for the local archive and manifest, fetches the exact production GitHub Pages JSON paths, rejects off-origin redirects, and requires the deployed bytes to match. Exit code zero or a local archive file alone never completes the gate.

Finalization intentionally does not hold the gate transition while it performs Git and network validation. It retains the validated receipt result in process memory, then `gate.complete()` reacquires the transition and rechecks the same private claim is active and unexpired before settlement. A receipt-file change in between cannot alter that retained result or bypass ownership; a same-user actor able to rewrite publication evidence could also do so immediately after completion. Holding the transition across external checks would instead block lease heartbeats and stale recovery without creating a meaningful security boundary.

When feedback is enabled for the watchdog, its nonsecret plist switch is `TODAY_I_FOUND_FEEDBACK_ENABLED=1`. The watchdog reads `FEEDBACK_SUMMARY_URL`, `REGISTER_EDITION_URL`, and `CURATOR_TOKEN` from generic-password entries in the macOS login Keychain under service `today-i-found.curator` and matching account names. It fails closed if any entry is absent or invalid. Secret values never enter a plist, prompt, log, gate, receipt, or repository file.

Preview the reversible LaunchAgent changes with `node scripts/install-launch-agents.mjs --dry-run --package-manager-path /absolute/path/to/pnpm --codex-path /absolute/path/to/codex`. Add `--feedback-enabled` only after the three Keychain entries exist. The installer requires executable absolute Node, pnpm, and Codex paths and generates a deterministic launchd PATH containing their directories. The uninstall command accepts the same path options. These scripts deliberately do not configure wake or power behavior. Treat any future macOS wake schedule as a separate, explicitly approved system change.
