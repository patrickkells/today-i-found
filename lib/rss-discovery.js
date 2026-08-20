import { canonicalizeUrl } from "./curation.js";

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function blocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((match) => match[1]);
}

function elementText(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return decodeXml(match[1]);
  }
  return "";
}

function linkFrom(block) {
  const atomLink = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i);
  return atomLink?.[1] ?? elementText(block, ["link"]);
}

function parseEntries(xml, feed) {
  const entries = blocks(xml, "item").length ? blocks(xml, "item") : blocks(xml, "entry");
  return entries.flatMap((block) => {
    const title = elementText(block, ["title"]);
    const url = linkFrom(block);
    const published = elementText(block, ["pubDate", "published", "updated", "dc:date"]);
    const timestamp = Date.parse(published);
    if (!title || !url || !Number.isFinite(timestamp)) return [];
    return [{
      id: elementText(block, ["guid", "id"]) || url,
      feedId: feed.id,
      lane: feed.lane,
      publisher: feed.publisher,
      title,
      summary: elementText(block, ["description", "summary", "content"]),
      url,
      publishedAt: new Date(timestamp).toISOString(),
    }];
  });
}

function ageInDays(publishedAt, editionDate) {
  const eventDay = Date.parse(`${publishedAt.slice(0, 10)}T00:00:00Z`);
  const editionDay = Date.parse(`${editionDate}T00:00:00Z`);
  return (editionDay - eventDay) / 86_400_000;
}

export async function collectFeedCandidates({ feeds, editionDate, maxAgeDays, fetchImpl = globalThis.fetch }) {
  const candidates = [];
  const failures = [];
  const seenUrls = new Set();

  for (const feed of feeds.filter((item) => item.enabled !== false)) {
    try {
      const response = await fetchImpl(feed.url, { headers: { accept: "application/rss+xml,application/atom+xml,application/xml,text/xml" } });
      if (!response.ok) {
        failures.push({ feedId: feed.id, reason: `HTTP ${response.status}` });
        continue;
      }
      const xml = await response.text();
      for (const candidate of parseEntries(xml, feed)) {
        const age = ageInDays(candidate.publishedAt, editionDate);
        if (age < 0 || age > maxAgeDays) continue;
        let canonicalUrl;
        try {
          canonicalUrl = canonicalizeUrl(candidate.url);
        } catch {
          continue;
        }
        if (seenUrls.has(canonicalUrl)) continue;
        seenUrls.add(canonicalUrl);
        candidates.push(candidate);
      }
    } catch (error) {
      failures.push({ feedId: feed.id, reason: error.message });
    }
  }

  return { candidates, failures };
}
