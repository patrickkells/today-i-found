function normalizeBase(baseUrl) {
  const value = typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : "/";
  return value.endsWith("/") ? value : `${value}/`;
}

export function createEditionLoader({ baseUrl = "/", fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Edition loading requires fetch");
  const base = normalizeBase(baseUrl);

  const loadJson = async (path) => {
    const response = await fetchImpl(`${base}${path}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Edition request failed: ${response.status}`);
    return response.json();
  };

  return {
    loadManifest: () => loadJson("data/manifest.json"),
    loadEdition: (date) => loadJson(`data/editions/${encodeURIComponent(date)}.json`),
  };
}

export async function loadArchive(options = {}) {
  const loader = createEditionLoader(options);
  const manifest = await loader.loadManifest();
  if (!manifest?.latestEdition || !Array.isArray(manifest.editions) || !manifest.editions.includes(manifest.latestEdition)) {
    throw new Error("Edition manifest is invalid");
  }
  const edition = await loader.loadEdition(manifest.latestEdition);
  return { manifest, edition, loadEdition: loader.loadEdition };
}
