import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectTrendingRepositories } from "../lib/github-trending.js";

const daily = await readFile(new URL("./fixtures/github-trending.html", import.meta.url), "utf8");
const weekly = daily.replace("acme/one", "other/two").replace("acme / one", "other / two");

test("daily and weekly Trending lists account for every unique repository", async () => {
  const result = await collectTrendingRepositories({
    windows: ["daily", "weekly"],
    editionDate: "2026-08-20",
    fetchImpl: async (url) => new Response(url.endsWith("weekly") ? weekly : daily),
  });
  assert.deepEqual(result.discoveries.map((item) => item.repository), ["acme/one", "acme/shared", "other/two"]);
  assert.deepEqual(result.discoveries.find((item) => item.repository === "acme/shared").trendingWindows, ["daily", "weekly"]);
  assert.deepEqual(result.failures, []);
});

test("a failed Trending window is reported without losing the healthy window", async () => {
  const result = await collectTrendingRepositories({
    windows: ["daily", "weekly"],
    editionDate: "2026-08-20",
    fetchImpl: async (url) => url.endsWith("weekly") ? new Response("down", { status: 503 }) : new Response(daily),
  });
  assert.equal(result.discoveries.length, 2);
  assert.deepEqual(result.failures, [{ feedId: "github-trending-weekly", reason: "HTTP 503" }]);
});
