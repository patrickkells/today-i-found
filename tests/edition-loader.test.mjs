import assert from "node:assert/strict";
import test from "node:test";

const loaderModule = await import("../src/edition-loader.js").catch(() => null);

test("archive loader boots the manifest's latest edition under a Pages base path", async () => {
  assert.equal(typeof loaderModule?.loadArchive, "function", "loadArchive must exist");
  const calls = [];
  const manifest = { latestEdition: "2026-08-20", editions: ["2026-08-19", "2026-08-20"] };
  const edition = { date: "2026-08-20", items: [] };
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      async json() { return url.endsWith("manifest.json") ? manifest : edition; },
    };
  };

  const archive = await loaderModule.loadArchive({ baseUrl: "/daily-ai-update/", fetchImpl });

  assert.deepEqual(calls, [
    "/daily-ai-update/data/manifest.json",
    "/daily-ai-update/data/editions/2026-08-20.json",
  ]);
  assert.equal(archive.manifest, manifest);
  assert.equal(archive.edition, edition);
  assert.equal((await archive.loadEdition("2026-08-19")).date, "2026-08-20");
  assert.equal(calls.at(-1), "/daily-ai-update/data/editions/2026-08-19.json");
});
