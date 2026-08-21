import assert from "node:assert/strict";
import test from "node:test";

import { createReportCompanionClient, REPORT_DEVICE_TOKEN_KEY, REPORT_OWNED_JOB_KEY } from "../src/report-companion-client.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("health targets the loopback companion with a local-network request and no device token", async () => {
  const calls = [];
  const client = createReportCompanionClient({
    storage: memoryStorage({ [REPORT_DEVICE_TOKEN_KEY]: "private-device-token" }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ status: "ok", version: "1", paired: true, busy: false });
    },
  });

  assert.deepEqual(await client.health(), { status: "ok", version: "1", paired: true, busy: false });
  assert.equal(calls[0].url, "http://127.0.0.1:43121/v1/health");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.targetAddressSpace, "loopback");
  assert.equal(Object.hasOwn(calls[0].options.headers, "authorization"), false);
});

test("client rejects every non-exact loopback base before reading storage or calling fetch", () => {
  for (const baseUrl of [
    "https://reports.example.com",
    "http://localhost:43121",
    "http://127.1:43121",
    "http://2130706433:43121",
    "http://127.0.0.1",
    "http://127.0.0.1:43121/path",
    "http://127.0.0.1:43121/?query=1",
    "http://user:secret@127.0.0.1:43121",
    "http://127.0.0.1:43121/#fragment",
  ]) {
    let storageReads = 0;
    let fetches = 0;
    assert.throws(() => createReportCompanionClient({
      baseUrl,
      storage: { getItem() { storageReads += 1; return "private-token"; } },
      fetchImpl: async () => { fetches += 1; },
    }), /loopback/i, baseUrl);
    assert.equal(storageReads, 0, baseUrl);
    assert.equal(fetches, 0, baseUrl);
  }
});

test("one-time pairing persists the returned device token without returning it to UI state", async () => {
  const storage = memoryStorage();
  const client = createReportCompanionClient({
    storage,
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { pairingCode: "482931" });
      return jsonResponse({ deviceToken: "durable-private-token" });
    },
  });

  assert.deepEqual(await client.pair("482931"), { paired: true });
  assert.equal(storage.getItem(REPORT_DEVICE_TOKEN_KEY), "durable-private-token");
});

test("owned report identity persists across client instances and clears only the matching job", () => {
  const storage = memoryStorage();
  const first = createReportCompanionClient({ storage, fetchImpl: async () => { throw new Error("unused"); } });
  first.setOwnedJob({ jobId: "123e4567-e89b-12d3-a456-426614174000", editionDate: "2026-08-21", status: "active" });

  const second = createReportCompanionClient({ storage, fetchImpl: async () => { throw new Error("unused"); } });
  assert.deepEqual(second.getOwnedJob(), {
    jobId: "123e4567-e89b-12d3-a456-426614174000",
    editionDate: "2026-08-21",
    status: "active",
  });
  assert.equal(second.clearOwnedJob("different-job"), false);
  assert.ok(storage.getItem(REPORT_OWNED_JOB_KEY));
  assert.equal(second.clearOwnedJob("123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(second.getOwnedJob(), null);
});

test("malformed owned report storage is discarded instead of being resumed", () => {
  const storage = memoryStorage({ [REPORT_OWNED_JOB_KEY]: JSON.stringify({ jobId: "../bad", editionDate: "yesterday" }) });
  const client = createReportCompanionClient({ storage, fetchImpl: async () => { throw new Error("unused"); } });

  assert.equal(client.getOwnedJob(), null);
  assert.equal(storage.getItem(REPORT_OWNED_JOB_KEY), null);
});

test("owned report reads and removals fail closed when browser storage is unavailable", () => {
  const storage = {
    getItem() { throw new Error("storage blocked"); },
    setItem() { throw new Error("storage blocked"); },
    removeItem() { throw new Error("storage blocked"); },
  };
  const client = createReportCompanionClient({ storage, fetchImpl: async () => { throw new Error("unused"); } });

  assert.equal(client.getOwnedJob(), null);
  assert.equal(client.clearOwnedJob("123e4567-e89b-12d3-a456-426614174000"), false);
});

test("authenticated report requests send only edition identity and preserve date scoping", async () => {
  const calls = [];
  const storage = memoryStorage({ [REPORT_DEVICE_TOKEN_KEY]: "private-device-token" });
  const client = createReportCompanionClient({
    baseUrl: "http://127.0.0.1:49999/",
    storage,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ jobId: "job-1", status: "running", progress: { phase: "queued", completed: 0, total: 1 } }, { status: 202 });
    },
  });

  const result = await client.startReport({ date: "2026-08-21", itemIds: ["a", "b"] });

  assert.equal(result.jobId, "job-1");
  assert.equal(calls[0].url, "http://127.0.0.1:49999/v1/reports");
  assert.equal(calls[0].options.headers.authorization, "Bearer private-device-token");
  assert.deepEqual(JSON.parse(calls[0].options.body), { date: "2026-08-21", itemIds: ["a", "b"] });
});

test("authentication failures clear the stale browser token and expose an auth error", async () => {
  const storage = memoryStorage({ [REPORT_DEVICE_TOKEN_KEY]: "expired-token" });
  const client = createReportCompanionClient({
    storage,
    fetchImpl: async () => jsonResponse({ error: "Device token is invalid" }, { status: 401 }),
  });

  await assert.rejects(
    () => client.getReport("job-1"),
    (error) => error.code === "auth" && error.status === 401,
  );
  assert.equal(storage.getItem(REPORT_DEVICE_TOKEN_KEY), null);
});

test("offline requests surface an offline error without leaking the stored token", async () => {
  const storage = memoryStorage({ [REPORT_DEVICE_TOKEN_KEY]: "never-show-this" });
  const client = createReportCompanionClient({
    storage,
    fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
  });

  await assert.rejects(
    () => client.startReport({ date: "2026-08-21", itemIds: ["a"] }),
    (error) => error.code === "offline" && !error.message.includes("never-show-this"),
  );
});

test("cancel and artifact downloads use authenticated job-scoped paths", async () => {
  const calls = [];
  const storage = memoryStorage({ [REPORT_DEVICE_TOKEN_KEY]: "private-device-token" });
  const client = createReportCompanionClient({
    storage,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "DELETE") return jsonResponse({ cancelled: true }, { status: 202 });
      return new Response("# narration\n", {
        status: 200,
        headers: {
          "content-type": "text/markdown",
          "content-disposition": 'attachment; filename="today-i-found-report.md"',
        },
      });
    },
  });

  assert.deepEqual(await client.cancel("job-1"), { cancelled: true });
  const download = await client.download("job-1", "markdown");

  assert.equal(calls[0].url, "http://127.0.0.1:43121/v1/reports/job-1");
  assert.equal(calls[0].options.method, "DELETE");
  assert.equal(calls[1].url, "http://127.0.0.1:43121/v1/reports/job-1/download/markdown");
  assert.equal(calls[1].options.headers.authorization, "Bearer private-device-token");
  assert.equal(download.filename, "today-i-found-report.md");
  assert.equal(await download.blob.text(), "# narration\n");
});
