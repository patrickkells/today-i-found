# Evidence-First today i found Curation Design

## Goal

Replace quota-driven, numerically scored curation with a quality-first system that can publish one genuinely useful item, treats diversity as a preference rather than a gate, searches GitHub Trending explicitly, and uses reader feedback only as a sufficiently supported tie-breaker.

## Principles

- Never add filler to reach a target count.
- Prefer auditable evidence and categorical judgments over precise-looking numerical quality scores.
- Treat community popularity as a discovery lead, never as proof of builder value.
- Hard quality, source, exclusion, and duplicate gates always outrank feedback and diversity.
- Preserve deterministic publication behavior once the curator has supplied an ordered candidate edition.

## Discovery

The daily curator must search all of these source lanes:

1. Official release notes, product changelogs, documentation, maintainer repositories, and primary research papers.
2. GitHub Trending for daily and weekly movement, including the all-language view and relevant AI-builder language views when available.
3. Recently created or sharply accelerating repositories relevant to models, agents, evaluation, inference, developer tools, multimodal systems, and automation.
4. Community sources only for leads.

GitHub stars, forks, discussion volume, and trending placement are discovery signals only. Before selection, the curator must inspect the maintainer repository, release, documentation, commit history, or linked primary artifact and confirm a concrete builder use. Wrapper clones, inactive repositories, unverifiable claims, and popularity without practical utility are rejected.

## Hard Selection Gates

An edition may contain 1–15 items. One excellent item is a valid edition. If there are no qualifying items, the curator reports that no edition was published rather than manufacturing content.

Every published item must:

- have direct utility for building, integrating, evaluating, debugging, deploying, or operating an AI system;
- describe a real new release, capability, access change, reproducible artifact, or materially improved workflow;
- link to a verified primary source with verification method and date;
- pass the prohibited-topic gate;
- pass the 30-day duplicate gate;
- include a concise `signal.whyNow` explanation and a human-readable `rankingRationale`;
- use one editorial tier: `must-try`, `notable`, or `watch`.

Politics, funding, acquisitions, executive drama, market speculation, and non-builder business news remain prohibited. Keyword checks are a publication backstop, while the curator applies the broader builder-utility judgment. The word `government` alone is not prohibited; political subject matter is.

## Optional Action Material

`caveat` is optional. Include it only when a concrete limitation, safety concern, compatibility constraint, privacy issue, or evaluation caveat helps the builder make a better decision.

`experiment` is optional. When present:

- `goal` must be nonempty;
- `steps` must contain 1–3 specific steps;
- the interface shows the Try This section.

When absent, the item remains publishable and the interface omits the Try This section instead of generating filler steps.

## Diversity

There is no minimum number of categories and no category percentage ceiling. Diversity is a soft editorial tie-breaker only. When two candidates have equivalent builder value and evidence, prefer the one that adds a new category, source, or technique. Never displace a stronger item to achieve balance.

## Duplicate Policy

The existing 30-day inclusive checks remain: canonical URL, entity key, event key, and normalized-title similarity. A substantive-update exception must include:

- `previousItemId`;
- `kind`, one of `new-version`, `new-capability`, `api-access`, `reproducible-evaluation`, or `expanded-utility`;
- a nonempty `reason` describing the material change.

The curator must also compare candidate meaning against the recent archive and reject paraphrased repeats that the deterministic checks miss. The exception does not bypass source verification, exclusions, or builder utility.

## Editorial Ranking

Remove `impact`, `confidence`, `novelty`, `baseScore`, and `adjustedScore` from the active curation contract. The curator orders items using an evidence-backed categorical rubric:

- `must-try`: a newly usable change with immediate builder payoff and a credible path to testing or adoption;
- `notable`: a substantial tool, technique, document, or research artifact likely to improve near-term building work;
- `watch`: credible emerging utility that is narrower, less mature, or less immediately actionable.

Tiers sort in that order. Within a tier, the curator compares candidates by: direct builder utility, magnitude of what newly became possible, evidence quality, recency, and the question “Which would a builder most regret missing today?” The curator records the result in `rankingRationale`. Candidate order is stable when no eligible feedback applies.

## Feedback Tie-Breaking

Public votes continue to create time-decayed preferences by category, source, and tag over a 90-day window with a 30-day half-life and Bayesian smoothing.

A preference group becomes eligible only when its weighted upvotes plus weighted downvotes are at least 10. For each item, average only eligible matching category, source, and tag preference adjustments. Cap the resulting signal at `-0.5` to `+0.5`.

Feedback may reorder items only within the same editorial tier. It cannot move an item between tiers, add or remove an item, or override any hard gate. Equal feedback signals retain the curator's original order. Public vote responses contain vote counts and the current browser's vote, not a quality score.

## Data and Interface Changes

- Keep `signal.whyNow`; remove the required numerical signal fields from new editions.
- Remove `timeToTry` from the new-edition contract; it is not displayed or used for curation.
- Add required `editorialTier` and `rankingRationale` fields.
- Make `caveat` and `experiment` optional under the rules above.
- Render Caveat and Try This sections only when their data exists.
- Remove score fields from public feedback records and active publishing annotations.
- Existing archived editions may retain legacy numerical fields; loaders and validators tolerate them, but new publication does not generate or use them.

## Publication and Automation

The publishing pipeline validates the hard gates before and after feedback tie-breaking, checks recent archives for duplicates, and writes the dated edition only after a successful dry run. The active 7:00 AM America/New_York Codex automation keeps its schedule and project, but its prompt is updated to follow this evidence-first policy and to search GitHub Trending explicitly. This follows the existing repeatable, verified automation pattern described in [official OpenAI workflow guidance](https://learn.chatgpt.com/use-cases).

## Verification

Tests must cover:

- valid editions containing one item;
- rejection of empty and over-15-item editions;
- acceptance of one category and category concentrations above 40%;
- optional caveats and absent experiments;
- experiments containing 1–3 nonempty steps;
- removal of numerical ranking requirements;
- editorial-tier ordering and stable ties;
- feedback ignored below 10 effective votes;
- feedback reordering only within a tier;
- public vote records without score fields;
- structured substantive-update exceptions;
- GitHub Trending and quality-first rules in the scheduled curator instruction;
- full dry-run, archive, Worker, UI, and production-build regression coverage.
