# Broad Technology Briefing Design

## Summary

Evolve `today i found` from an AI-builder briefing into a broad, personalized technology briefing. The publication should help a technically curious reader discover useful tools, meaningful changes, important technology news, and occasional delightful projects without becoming a general-news firehose.

Each published daily edition contains one to forty verified items. A daily run with no qualifying candidates skips publication instead of creating an empty edition. There is no editorial minimum and no category quota. Quality gates apply before personalization, and weak candidates never fill unused space.

## Editorial promise

The default promise is “useful or genuinely interesting to a broadly curious technology builder.” The publication covers practical builder material first, while allowing important consumer technology, hardware, applied science, and unusual technical discoveries.

Primary categories are:

- AI & Automation
- Software & Developer Tools
- Web & Platforms
- Security & Privacy
- Hardware & Devices
- Science & Emerging Tech
- Consumer Technology
- Curiosities

Every published item has one primary category and descriptive tags. Tags capture attributes such as `open-source`, `release`, `research`, `tutorial`, `pricing-change`, `deprecation`, `privacy`, and `breaking-change` without turning story types into competing primary categories.

Eligible material includes:

- meaningful releases and platform changes;
- useful software, utilities, repositories, and hardware;
- technology news with material practical or industry significance;
- actionable security and privacy developments;
- technology-adjacent research in areas such as computing, robotics, energy, materials, biotech tools, and space technology;
- exceptional recent technical guides, benchmarks, and explainers; and
- occasional clever, unusual, or delightful technical projects.

Politics, funding announcements, executive drama, market speculation, promotional fluff, copycat repositories, and routine patch releases are excluded. A company or policy story may qualify only when it materially changes a technology’s availability, cost, ownership, licensing, privacy, compatibility, or future.

## Discovery

The daily collector searches these independent source lanes:

1. The complete GitHub Trending all-language daily and weekly lists, without filtering for AI or another topic before inspection.
2. Newly accelerating repositories and repositories with current material releases.
3. Official changelogs, release feeds, engineering blogs, maintainer repositories, standards bodies, and research artifacts.
4. Developer, open-source, browser, platform, operating-system, hardware, and security publications.
5. Research institutions, journals, and technology-adjacent science publications.
6. A small, reviewed set of reputable general technology reporting sources.
7. Community sources used as discovery leads, not publication evidence.

GitHub Trending is a candidate pool, not an automatic publication list. Every discovered Trending repository is recorded and considered. Trending position, stars, forks, and discussion volume never substitute for technical substance, current status, or verification.

The source catalog is machine-readable. Each source records its lane, topic coverage, trust role, feed URL when available, and whether it is a primary source or a discovery source. Source failures are reported by lane and do not stop unrelated lanes.

## Candidate ledger

Discovery writes a private dated candidate ledger before editorial filtering. Each record contains:

- discovery source and lane;
- discovered URL and canonical URL;
- normalized entity and event identifiers;
- title and publication or release date when available;
- detected category and tags;
- cluster identifier for syndicated or overlapping coverage;
- current processing stage;
- verification evidence;
- eligibility result and rejection reason;
- personalization or exploration selection reason; and
- final publication position when selected.

The ledger is the authoritative denominator for edition reporting. It supports statements such as “28 items selected from 314 candidates” and allows exact answers about excluded GitHub Trending repositories. It is retained as a private publishing artifact rather than shipped in the public client.

Multiple URLs about the same event collapse into one candidate cluster while retaining all useful evidence links. Counts distinguish raw discoveries, clustered candidates, eligible candidates, rejected candidates, and published items.

## Freshness and evidence

Freshness depends on the type of material:

- releases, news, security developments, and product changes generally require dated evidence from the seven calendar days ending on the edition date;
- research, benchmarks, and exceptional technical explainers generally require dated evidence from the fourteen calendar days ending on the edition date; and
- an older repository may qualify when it is currently trending, materially resurging, or has a current documented release, but the story must describe that status accurately rather than present the repository as new.

Before publication, the curator checks the evidence date, current product or project status, claim accuracy, access, and deprecation state. Official primary evidence is preferred. Credible independent original reporting may qualify when it establishes information that no primary source provides. Community summaries and popularity signals cannot serve as sole publication evidence.

If essential evidence cannot be verified, the item fails closed. A source being reachable does not itself establish freshness or current utility.

## Exclusions and duplicates

Hard exclusions run before personalization. They reject prohibited subject matter, stale or unverifiable claims, inactive or unavailable projects presented as current recommendations, routine maintenance without material consequence, wrapper clones, promotional claims without evidence, and stories lacking meaningful technological interest.

The existing thirty-day duplicate window remains. Duplicate detection compares canonical URLs, entity and event identifiers, normalized titles, and candidate meaning across the archive. A repeat is allowed only for a substantive new version, capability, access or pricing change, reproducible evaluation, current resurgence, or materially expanded utility. The ledger records the earlier item and the update reason.

## Selection and personalization

All hard gates run before reader preferences have any effect. If forty or fewer candidates qualify, all may publish. If more than forty qualify, selection favors the reader’s learned interests while preserving controlled exploration:

- up to eighty percent of selected positions may favor candidates predicted to match established interests; and
- no more than twenty percent of the final published count may be used for excellent candidates outside the established pattern.

The twenty-percent exploration share is a ceiling, not a quota. Its integer limit is the floor of twenty percent of the final published count. Exploration never lowers the quality threshold and never requires filling forty positions.

Votes build time-decayed preferences across topic, subtopic, tags, story type, source, named technologies, named projects, open-source versus commercial material, and depth. Recent votes matter more than old votes. One vote has limited broad effect; repeated evidence strengthens a preference. A downvote on one item does not blacklist its entire primary category.

Once sufficient voting evidence exists, predicted reader interest is the main differentiator among candidates that pass the hard gates. Until then, direct technical significance, novelty, evidence quality, and recency determine selection and order. No numerical usefulness score is shown to readers. Internal selection records the factors and evidence instead of presenting arbitrary decimal precision.

## Public edition and reading experience

The compact ranked stream remains the primary interface. Each story row contains:

- a generated title;
- a concise factual summary;
- its primary category and useful tags;
- inline publisher, publication date, verification status, and source link; and
- public upvote and downvote controls with counts.

The application does not restore a story inspector, generated experiments, generic “why it matters” copy, generic caveats, usefulness scores, or time-to-try estimates. Decision-relevant access, pricing, migration, compatibility, privacy, or availability limits belong directly in the factual summary.

The filter rail uses the new primary categories and live counts. Search covers titles, summaries, publishers, categories, and tags. Dated archives and date navigation remain.

Each edition displays a compact transparency note with discovered, clustered, published, Trending-reviewed, and exploration counts. The private candidate ledger is not exposed publicly.

If voting is unavailable, reading, search, filters, sources, and archives continue working. Voting controls show an unavailable state without blocking the edition.

## Headline and summary generation

Headline and summary prompt calibration is a deliberate follow-up phase after the expanded source catalog produces a representative candidate corpus. This design does not freeze untested generation wording.

The pipeline must preserve the source evidence, extracted facts, category, tags, material limitations, and prompt version used for every generated title and summary. That enables later prompt comparison against the same real candidates without rediscovering sources or changing the underlying facts.

The later calibration should optimize for factual accuracy, information density, specificity, currency, and faithful distinction between “new,” “newly released,” “updated,” and “newly discovered.” It should reject hype, invented implications, vague significance claims, and redundant wording between title and summary.

## Publishing flow

The scheduled publication flow is:

1. Collect candidates from every configured lane.
2. Normalize URLs, entities, events, categories, and tags.
3. Cluster overlapping coverage and write the initial candidate ledger.
4. Verify freshness, current status, claims, and the strongest available evidence.
5. Apply exclusions and the thirty-day duplicate gate, recording every result.
6. Apply established preference signals to eligible candidates and reserve no more than twenty percent of selected positions for exploration.
7. Generate and validate public story copy from preserved evidence.
8. Publish at most forty items, archive the public edition, and retain the candidate ledger outside the public site artifact. If none qualify, retain the ledger and publish no edition.
9. Report discovered, clustered, eligible, rejected, published, Trending-reviewed, exploration, failure, and deployment totals.

## Validation and testing

Automated tests cover:

- skipped publication when zero candidates qualify and the forty-item edition ceiling;
- complete consideration and accounting of GitHub Trending discoveries;
- exact agreement between candidate-ledger and edition totals;
- the primary category and tag vocabulary;
- seven-day and fourteen-day freshness boundaries;
- accurate treatment of older but currently trending repositories;
- deprecated, unavailable, inactive, or unverifiable products and projects;
- exact, near, entity-level, and event-level duplicate detection;
- substantive-update and current-resurgence exceptions;
- prohibited topics and practical-consequence exceptions;
- preference evidence thresholds, time decay, and narrow versus broad vote effects;
- the twenty-percent exploration ceiling without an exploration quota;
- feed and evidence-source failures;
- voting-service failure fallback;
- source, date, verification, category, tag, search, filter, and archive behavior; and
- production build and deployment paths.

## Success criteria

The result feels broad and surprising without feeling indiscriminate. The reader can scan up to forty current technology items, understand what each item actually is, open a trustworthy source, and shape future editions through voting. The publishing report can always state how many candidates were considered and why any specific Trending repository or source item was excluded.
