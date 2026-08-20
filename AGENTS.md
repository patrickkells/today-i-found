# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Keep signal titles and summaries fully readable at every width. Let rows grow with wrapped content instead of truncating it. Do not show or filter by usefulness scores or time-to-try estimates; the user considers those metrics arbitrary and unreliable.

Brand the product as `today i found`, always in lowercase. Show the name by itself with no subtitle or tagline.

Use evidence-first curation. Read `config/curation-policy.json` first. Search verified primary sources, GitHub Trending daily and weekly, and accelerating relevant repositories. Treat popularity only as a discovery lead, never as quality evidence. Publish 1–15 genuinely useful builder signals with no filler, or skip the edition when none qualify. Use editorial tiers and evidence-backed ranking rationales instead of numerical quality scores. Caveats are optional, and experiments are optional with one to three steps. Use diversity only between equivalent candidates. Apply deterministic and semantic 30-day duplicate checks. Use protected feedback only when its policy eligibility threshold is met and only as a within-tier tie-breaker; it must never override a publication gate.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
