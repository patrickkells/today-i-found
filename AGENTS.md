# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Keep signal titles and summaries fully readable at every width. Let rows grow with wrapped content instead of truncating it. Do not show or filter by usefulness scores or time-to-try estimates; the user considers those metrics arbitrary and unreliable.

Brand the product as `today i found`, always in lowercase. Show the name by itself with no subtitle or tagline.

Use evidence-first curation. Read `config/curation-policy.json` first. The publication covers broad technology rather than AI alone: AI and automation, software and developer tools, web and platforms, security and privacy, hardware and devices, science and emerging technology, consumer technology, and curiosities. Search verified sources, the complete GitHub Trending all-language daily and weekly lists, and accelerating relevant repositories. Treat popularity only as a discovery lead, never as quality evidence. Publish one to forty genuinely useful or interesting technology signals with no filler, or skip publication when none qualify. Preserve a private candidate ledger with exact discovery totals and rejection reasons. Use reader votes to personalize selection after hard publication gates, while reserving no more than twenty percent of selected positions for high-quality exploration. Do not display numerical usefulness scores. Apply deterministic and semantic 30-day duplicate checks.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

For daily curation, prefer accuracy over item count. RSS, GitHub Trending, and community signals are discovery leads only. Prefer dated primary evidence, while allowing credible independent original reporting when it establishes information unavailable from a primary source. Use a seven-day window for releases, news, security developments, and product changes; use fourteen days for exceptional research, benchmarks, and technical explainers. An older repository may qualify because it is currently trending or materially resurging, but never describe it as newly released without current release evidence. Fail closed rather than publishing an unverifiable or misleading item.

Keep the briefing list self-contained and compact. Do not use a persistent story inspector, generated experiments, generic "why it matters" copy, or generic caveats. Put the publisher, verification date, and primary-source link directly in each story row. State only decision-relevant limitations as factual story copy.

Generate new story copy with `config/copy-prompt.md`. Headlines name the actor or product and a concrete change without decorative verbs. Summaries add the mechanism, capability, practical consequence, or a decision-relevant limit without repeating the headline. Keep every factual anchor inside the verified evidence and apply the compact Unslop rules without adding opinions or manufactured personality.

Preserve source evidence and prompt versions so future prompt comparisons use identical facts. Recalibrate only against a larger representative corpus, changing one prompt rule at a time and rerunning the same copy evaluations. Optimize copy for accuracy, information density, specificity, currency, and precise distinctions between new releases, updates, and newly discovered older projects.

Keep daily candidate ledgers and candidate pools under the Git-ignored `.curation/` directory; never copy or commit them. Complete every ledger decision before publication. For each eligible candidate, preserve `copy.promptVersion` as `broad-tech-copy-v2`, the exact `copy.evidenceFacts`, and the matching generated title and summary.
