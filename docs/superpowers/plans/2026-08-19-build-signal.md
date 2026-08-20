# today i found implementation plan

## Global constraints

- Recreate the selected Option 2 mock at `/Users/patrickkells/.codex/generated_images/01a01c53-7c57-7ec0-a416-1f7bc1216e84/exec-66842228-1fec-4507-9fef-f8245267901c.png` as the visual source of truth.
- Use the bundled Product Design web prototype template, React, and Vite; preserve its Sites-ready files while also supporting GitHub Pages.
- Use test-first development for behavior. Every signal has exactly three experiment steps and a verified primary source.
- The feed strictly excludes politics, funding, acquisitions, executive drama, market speculation, and non-builder business news.
- Duplicate suppression lasts 30 days, with only substantive updates allowed through.
- Voting is public and anonymous, with visible counts, one changeable vote per browser, rate limiting, and a gentle feedback influence capped at plus or minus 0.5 on a ten-point score.
- Target 12 daily items, allow 10 to 15, cover at least three categories, and keep a category under 40 percent unless the day clearly warrants an exception.
- The interface must work on desktop, tablet, and mobile and pass browser interaction checks and visual design QA.

## Task 1: Foundation and curation contracts

Bootstrap the Product Design prototype into the repository. Add the edition schema, a realistic 12-item fixture, manifest, validation utilities, exclusion checks, canonical URL normalization, and the 30-day duplicate gate. Write failing tests first, then implement until they pass. Preserve the template runtime and add scripts for test, validate, and duplicate checks.

## Task 2: Responsive Option 2 interface

Implement the desktop three-pane today i found interface with the exact selected visual direction, IBM Plex Mono and Barlow Condensed, Phosphor icons, functional filters, search, selection, date navigation, copy controls, vote controls and counts, keyboard navigation, loading/error/empty states, and accessible focus. Add tablet filter drawer and mobile full-screen inspector. Add focused component/interaction tests where practical.

## Task 3: Feedback service

Add a Cloudflare Worker and D1 schema implementing `GET /v1/editions/:date/votes`, `PUT /v1/items/:id/vote`, protected edition registration, and protected 90-day feedback summaries. Hash browser identifiers, enforce an origin allowlist and per-IP mutation limits, make votes changeable/removable, and compute time-decayed Bayesian feature preferences capped for gentle influence. Write Worker tests first.

## Task 4: Publishing and curator automation assets

Add GitHub Pages deployment, curator instructions and scripts, edition registration and dry-run support, environment examples, and documentation for a 7:00 AM America/New_York Codex scheduled task. Validate generated editions before publication. Do not publish, push, provision Cloudflare resources, or enable the external schedule without explicit authorization.

## Task 5: Verification and design QA

Run the complete automated suite and production build. Start the local app, open it in the in-app browser, verify the primary interactions at desktop/tablet/mobile widths, inspect console errors, compare a 1488 by 1024 implementation capture with the selected Option 2 image, fix all P0/P1/P2 differences, and save `design-qa.md` with `final result: passed`.
