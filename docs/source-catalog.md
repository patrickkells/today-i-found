# Source catalog

`config/discovery-feeds.json` is the machine-readable source registry. Every enabled entry declares a lane, one or more broad topics, a role, and a freshness class.

## Roles

- `primary`: maintainer releases, official changelogs, engineering blogs, standards, advisories, or original research artifacts that may serve as publication evidence.
- `discovery`: reporting, aggregators, and communities that surface leads. Their claims require primary confirmation unless the source provides credible original reporting unavailable elsewhere.

## Freshness classes

- `standard`: seven days for releases, news, security developments, and product changes.
- `extended`: fourteen days for research, benchmarks, and exceptional technical explainers.
- `current-discovery`: edition-day GitHub Trending evidence for an older repository; this class comes from Trending collection rather than RSS configuration.

## Lanes

- AI products and open source: OpenAI, Hugging Face, maintainer release feeds, and AI standards.
- Developer tools and languages: GitHub Changelog, Microsoft Developer Blogs, Google Developers, Rust, Python, and Node.js.
- Web and infrastructure: Chrome for Developers, web.dev, Mozilla Hacks, AWS, Cloudflare, Kubernetes, Docker, and Vercel.
- Security and privacy: Google Project Zero, GitHub Security Lab, Cloudflare engineering, arXiv cryptography and security, 404 Media, Ars Technica, and Lobsters.
- Hardware and consumer technology: Apple Developer, Raspberry Pi, Hackaday, IEEE Spectrum, Ars Technica, Wired, and The Verge.
- Science and emerging technology: arXiv AI, machine learning, software engineering, security, and robotics; MIT News; IEEE Spectrum; and MIT Technology Review.
- Curiosities and community discovery: Hackaday, Hacker News, Lobsters, Raspberry Pi, and the complete GitHub Trending all-language daily and weekly lists.

The daily discovery report lists failures by source. A failed feed stays visible in the report. Disable it only with a recorded reason and verification date, and replace it with a functioning source in the same topic and role before considering that lane healthy.

Feed collection retains entries from the previous thirty days in the private ledger so the seven- and fourteen-day publication gates remain auditable without importing years of archive history.
