import assert from "node:assert/strict";
import test from "node:test";

const discoveryModule = await import("../lib/rss-discovery.js").catch(() => null);
const sourceAuditModule = await import("../lib/source-audit.js").catch(() => null);

const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Fresh release</title><link>https://acme.example/releases/v2</link><guid>release-v2</guid><pubDate>Wed, 19 Aug 2026 15:00:00 GMT</pubDate><description>&lt;p&gt;Ships a useful builder API.&lt;/p&gt;</description></item>
  <item><title>Stale release</title><link>https://acme.example/releases/v1</link><guid>release-v1</guid><pubDate>Sat, 01 Aug 2026 15:00:00 GMT</pubDate></item>
</channel></rss>`;

const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>Fresh release duplicate</title><link href="https://acme.example/releases/v2"/><id>tag:acme.example,2026:v2</id><updated>2026-08-19T16:00:00Z</updated><summary>The same event from another feed.</summary></entry>
</feed>`;

test("RSS and Atom discovery keeps fresh entries, normalizes their fields, and removes canonical duplicates", async () => {
  assert.ok(discoveryModule, "rss discovery module should exist");
  const feeds = [
    { id: "acme-rss", publisher: "Acme", lane: "product", url: "https://feeds.example/rss" },
    { id: "acme-atom", publisher: "Acme", lane: "releases", url: "https://feeds.example/atom" },
  ];
  const documents = new Map([[feeds[0].url, rss], [feeds[1].url, atom]]);

  const result = await discoveryModule.collectFeedCandidates({
    feeds,
    editionDate: "2026-08-20",
    maxAgeDays: 7,
    fetchImpl: async (url) => new Response(documents.get(url), {
      status: 200,
      headers: { "content-type": "application/xml" },
    }),
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.candidates, [{
    id: "release-v2",
    feedId: "acme-rss",
    lane: "product",
    publisher: "Acme",
    title: "Fresh release",
    summary: "Ships a useful builder API.",
    url: "https://acme.example/releases/v2",
    publishedAt: "2026-08-19T15:00:00.000Z",
  }]);
});

test("feed discovery isolates broken feeds instead of discarding healthy results", async () => {
  assert.ok(discoveryModule, "rss discovery module should exist");
  const result = await discoveryModule.collectFeedCandidates({
    feeds: [
      { id: "healthy", publisher: "Acme", lane: "product", url: "https://feeds.example/healthy" },
      { id: "broken", publisher: "Broken", lane: "product", url: "https://feeds.example/broken" },
    ],
    editionDate: "2026-08-20",
    maxAgeDays: 7,
    fetchImpl: async (url) => url.endsWith("broken")
      ? new Response("unavailable", { status: 503 })
      : new Response(rss, { status: 200 }),
  });

  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.failures, [{ feedId: "broken", reason: "HTTP 503" }]);
});

test("source auditing rejects broken links and redirects to an unrelated publisher", async () => {
  assert.ok(sourceAuditModule, "source audit module should exist");
  const edition = {
    items: [
      { id: "broken", source: { url: "https://acme.example/releases/broken" } },
      { id: "redirected", source: { url: "https://acme.example/releases/moved" } },
      { id: "healthy", source: { url: "https://acme.example/releases/current" } },
    ],
  };

  const errors = await sourceAuditModule.auditEditionSources(edition, {
    fetchImpl: async (url) => {
      if (url.endsWith("broken")) return { ok: false, status: 404, url };
      if (url.endsWith("moved")) return { ok: true, status: 200, url: "https://unrelated.example/article" };
      return { ok: true, status: 200, url };
    },
  });

  assert.deepEqual(errors, [
    "broken source returned HTTP 404.",
    "redirected source redirected to an unrelated host: unrelated.example.",
  ]);
});

test("source auditing uses a browser-compatible request for official pages that reject generic fetch clients", async () => {
  assert.ok(sourceAuditModule, "source audit module should exist");
  const edition = { items: [{ id: "official", source: { url: "https://official.example/release" } }] };

  const errors = await sourceAuditModule.auditEditionSources(edition, {
    fetchImpl: async (url, options) => options.headers["user-agent"]?.startsWith("Mozilla/5.0")
      ? { ok: true, status: 200, url }
      : { ok: false, status: 403, url },
  });

  assert.deepEqual(errors, []);
});
