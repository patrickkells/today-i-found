# Local report companion

The report companion is a private service for the paired Mac. It binds only to `127.0.0.1:43121`. The public site can read its health status, but report jobs require a durable browser device token.

Start it with `npm run report:companion`. On first start it prints a six-digit, one-time pairing code. The code expires after ten minutes. Five failed attempts lock pairing for fifteen minutes. Restart the companion to print a fresh code when an earlier code expires. Pairing stores only a SHA-256 token hash in `~/Library/Application Support/today-i-found/pairing.json`, with owner-only permissions. The browser stores the returned device token locally. A second pairing attempt is rejected.

Reports are written as versioned Markdown and JSON pairs under `~/Documents/today-i-found-reports`. Each version is published as one atomic directory so a partial or colliding write cannot expose an orphan file. Temporary retrieved source text lives under the Git-ignored `.report-jobs` directory and is removed when a job settles.

## HTTP contract

- `GET /v1/health` — public status, version, paired state, and busy state.
- `POST /v1/pair` — accepts only `{ "pairingCode": "000000" }` and works once.
- `POST /v1/reports` — authenticated; accepts only an edition `date` and published `itemIds`.
- `GET /v1/reports/:jobId` — authenticated status and progress.
- `DELETE /v1/reports/:jobId` — authenticated cancellation.
- `GET /v1/reports/:jobId/download/markdown` — authenticated Markdown download.
- `GET /v1/reports/:jobId/download/json` — authenticated JSON download.

Set `TODAY_I_FOUND_PRODUCTION_ORIGIN` to the app's dedicated, exact HTTPS origin before using reports from production. The LaunchAgent installer requires this as `--production-origin https://today-i-found.pages.dev` and writes it only to the report companion service. Paths, queries, fragments, HTTP origins, and the shared `https://patrickkells.github.io` origin are rejected. The GitHub Pages origin may read health only; it cannot pair, authenticate, start jobs, inspect jobs, cancel jobs, or download reports. Explicit localhost development origins remain available. This prevents scripts from sibling GitHub Pages projects from sharing the report token boundary. The service responds to Private Network Access preflights. Source fetching pins a public Domain Name System result, validates every redirect, accepts HTTPS only, and caps time and size.

Before every Codex run, the companion checks `codex login status` and fails closed unless the saved authentication mode is ChatGPT. Every invocation is pinned to `gpt-5.6-sol`, high reasoning, read-only and ephemeral execution. User configuration, project rules, API-key environment variables, shell tools, web search, and prompt-directed subagents are excluded. Cancellation terminates the isolated process group and escalates to a bounded forced stop when needed. Once artifact publication begins, cancellation is refused and the atomic Markdown/JSON pair finishes committing.

The installed non-interactive `codex exec` interface has no stable control for exact subagent count, batch assignment, per-subagent schema validation, or individual cancellation. Reports with more than four stories therefore use isolated five-story Codex worker processes, with at most three concurrent workers, followed by one validated editorial pass. This preserves bounded context, fault isolation, deterministic validation, and cancellation. These workers are not described as subagents in report metadata and do not reduce subscription usage; parallel model work can consume more tokens. Automated tests use injected fake source and Codex adapters and never invoke a live model.

## User LaunchAgent

`node scripts/install-launch-agents.mjs --dry-run --package-manager-path /absolute/path/to/pnpm --codex-path /absolute/path/to/codex` prints the two user-level LaunchAgents and every action without writing or loading them. The installer fails closed unless Node, pnpm, and Codex are absolute executable paths. Add `--feedback-enabled` only when the watchdog's three required credentials already exist in the macOS Keychain. Running without `--dry-run` installs or reloads both agents under `~/Library/LaunchAgents`. `node scripts/uninstall-launch-agents.mjs --dry-run` previews the reverse operation; remove `--dry-run` to unload and delete only those two plist files.

The scripts do not change macOS wake or power settings. Any `pmset` change is a separate system-level action and requires explicit approval when it is performed.
