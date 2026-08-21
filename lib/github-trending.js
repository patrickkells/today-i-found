const TRENDING_URL = "https://github.com/trending?since=";

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTrendingPage(html, window, editionDate) {
  const articles = [...html.matchAll(/<article\b[^>]*class=["'][^"']*Box-row[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)];
  return articles.flatMap(([, article]) => {
    const link = article.match(/<h2\b[\s\S]*?<a\b[^>]*href=["']\/([^"'?#]+\/[^"'?#/]+)["']/i)?.[1];
    if (!link) return [];
    const repository = link.replace(/^\/+|\/+$/g, "");
    const description = decodeHtml(article.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const language = decodeHtml(article.match(/itemprop=["']programmingLanguage["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    return [{
      discoveryId: `github:${repository.toLowerCase()}`,
      repository,
      title: repository,
      summary: description,
      url: `https://github.com/${repository}`,
      canonicalUrl: `https://github.com/${repository.toLowerCase()}`,
      language: language || null,
      publishedAt: null,
      topics: ["Curiosities"],
      sourceRole: "discovery",
      freshnessClass: "current-discovery",
      trendingWindows: [window],
      observedAt: editionDate,
      origin: { kind: "github-trending", sourceId: `github-trending-${window}`, lane: "github-trending" },
    }];
  });
}

export async function collectTrendingRepositories({
  windows = ["daily", "weekly"],
  editionDate,
  fetchImpl = globalThis.fetch,
} = {}) {
  const failures = [];
  const byRepository = new Map();

  await Promise.all(windows.map(async (window) => {
    try {
      const response = await fetchImpl(`${TRENDING_URL}${encodeURIComponent(window)}`, {
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; today-i-found-discovery/1.0)" },
      });
      if (!response.ok) {
        failures.push({ feedId: `github-trending-${window}`, reason: `HTTP ${response.status}` });
        return;
      }
      const parsed = parseTrendingPage(await response.text(), window, editionDate);
      if (!parsed.length) {
        failures.push({ feedId: `github-trending-${window}`, reason: "No repositories parsed" });
        return;
      }
      for (const discovery of parsed) {
        const key = discovery.repository.toLowerCase();
        const existing = byRepository.get(key);
        byRepository.set(key, existing
          ? { ...existing, trendingWindows: [...new Set([...existing.trendingWindows, window])] }
          : discovery);
      }
    } catch (error) {
      failures.push({ feedId: `github-trending-${window}`, reason: error.message });
    }
  }));

  const windowOrder = new Map(windows.map((window, index) => [window, index]));
  const discoveries = [...byRepository.values()].map((item) => ({
    ...item,
    trendingWindows: [...item.trendingWindows].sort((left, right) => windowOrder.get(left) - windowOrder.get(right)),
  }));
  return { discoveries, failures: failures.sort((left, right) => left.feedId.localeCompare(right.feedId)) };
}
