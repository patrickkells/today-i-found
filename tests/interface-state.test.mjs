import assert from "node:assert/strict";
import test from "node:test";

import edition from "./fixtures/edition.json" with { type: "json" };
import broadEdition from "./fixtures/edition-v3.json" with { type: "json" };
import {
  applyVote,
  createInitialState,
  filterSignals,
  getReportSelection,
  getNextSelection,
} from "../src/app-state.js";
import * as feedback from "../src/feedback-service.js";

const { createFeedbackService } = feedback;

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function jsonResponse(payload, ok = true) {
  return { ok, status: ok ? 200 : 503, async json() { return payload; } };
}

test("createInitialState selects the first signal without carrying inspector state", () => {
  const state = createInitialState(edition.items);

  assert.equal(state.selectedId, edition.items[0].id);
  assert.equal(Object.hasOwn(state, "inspectorOpen"), false);
  assert.deepEqual(state.filters, { categories: [] });
});

test("filterSignals uses search and category while ignoring retired metric filters", () => {
  const result = filterSignals(edition.items, {
    query: "responses",
    categories: ["Models"],
    time: "15m+",
    usefulness: "< 5",
  });

  assert.deepEqual(result.map((item) => item.id), [edition.items[0].id]);
});

test("filterSignals searches structured tags and broad categories", () => {
  assert.deepEqual(filterSignals(broadEdition.items, { query: "open-source", categories: [] }).map((item) => item.id), ["acme-browser-release"]);
  assert.deepEqual(filterSignals(broadEdition.items, { query: "", categories: ["Software & Developer Tools"] }).map((item) => item.id), ["acme-browser-release"]);
});

test("getNextSelection supports wrapping j/k and arrow navigation", () => {
  const ids = ["a", "b", "c"];

  assert.equal(getNextSelection(ids, "a", "ArrowDown"), "b");
  assert.equal(getNextSelection(ids, "c", "j"), "a");
  assert.equal(getNextSelection(ids, "a", "k"), "c");
  assert.equal(getNextSelection(ids, "b", "ArrowUp"), "a");
});

test("applyVote adds, changes, and removes one vote per signal", () => {
  const counts = { up: 10, down: 2 };

  const added = applyVote(counts, null, "up");
  assert.deepEqual(added, { counts: { up: 11, down: 2 }, vote: "up" });

  const changed = applyVote(added.counts, added.vote, "down");
  assert.deepEqual(changed, { counts: { up: 10, down: 3 }, vote: "down" });

  const removed = applyVote(changed.counts, changed.vote, "down");
  assert.deepEqual(removed, { counts: { up: 10, down: 2 }, vote: null });
});

test("getReportSelection includes liked and blank edition items while excluding every downvote", () => {
  const items = edition.items.slice(0, 4);
  const records = {
    [items[0].id]: { up: 8, down: 0, myVote: "up" },
    [items[1].id]: { up: 4, down: 1, myVote: null },
    [items[2].id]: { up: 2, down: 3, myVote: "down" },
  };

  assert.deepEqual(getReportSelection(items, records), {
    itemIds: [items[0].id, items[1].id, items[3].id],
    liked: 1,
    unvoted: 2,
    excluded: 1,
  });
});

test("getReportSelection disables reports only when every edition item is downvoted", () => {
  const items = edition.items.slice(0, 2);
  const records = Object.fromEntries(items.map((item) => [item.id, { up: 0, down: 1, myVote: "down" }]));

  assert.deepEqual(getReportSelection(items, records), {
    itemIds: [],
    liked: 0,
    unvoted: 0,
    excluded: 2,
  });
});

test("offline feedback reports local state from this browser's actual selections", async () => {
  const firstItem = edition.items[0];
  const secondItem = edition.items[1];
  const service = createFeedbackService({
    storage: memoryStorage({
      "today-i-found:visitor-id": "visitor-test",
      "today-i-found:votes:visitor-test": JSON.stringify({ [secondItem.id]: "down" }),
    }),
    cryptoImpl: { randomUUID: () => "visitor-test" },
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });

  const result = await service.getVotes(edition.date, edition.items.slice(0, 2));

  assert.equal(result.source, "local");
  assert.ok(result.records, "fallback result must expose canonical records");
  assert.deepEqual(result.records[firstItem.id], {
    up: 0,
    down: 0,
    myVote: null,
  });
  assert.deepEqual(result.records[secondItem.id], {
    up: 0,
    down: 1,
    myVote: "down",
  });
});

test("feedback service persists one anonymous visitor and sends the canonical GET and PUT contracts", async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "PUT") {
      return jsonResponse({ itemId: edition.items[0].id, up: 20, down: 3, myVote: "up" });
    }
    return jsonResponse({
      items: [{ itemId: edition.items[0].id, up: 19, down: 3, myVote: null }],
    });
  };
  const first = createFeedbackService({
    storage,
    fetchImpl,
    cryptoImpl: { randomUUID: () => "visitor-fixed" },
  });
  const second = createFeedbackService({
    storage,
    fetchImpl,
    cryptoImpl: { randomUUID: () => "visitor-should-not-replace" },
  });

  const loaded = await first.getVotes(edition.date, edition.items.slice(0, 1));
  assert.ok(loaded.records, "remote result must expose canonical records");
  const updated = await second.setVote(edition.items[0].id, "up", loaded.records[edition.items[0].id]);

  assert.equal(storage.getItem("today-i-found:visitor-id"), "visitor-fixed");
  assert.equal(calls[0].url, "/v1/editions/2026-08-19/votes?visitorId=visitor-fixed");
  assert.deepEqual(JSON.parse(calls[1].options.body), { value: "up", visitorId: "visitor-fixed" });
  assert.deepEqual(loaded.records[edition.items[0].id], { up: 19, down: 3, myVote: null });
  assert.deepEqual(updated.record, { up: 20, down: 3, myVote: "up" });
});

test("a successful remote load migrates legacy browser selections through the outbox", async () => {
  const item = edition.items[0];
  const storage = memoryStorage({
    "today-i-found:visitor-id": "visitor-legacy",
    "today-i-found:votes:visitor-legacy": JSON.stringify({ [item.id]: "up" }),
  });
  const service = createFeedbackService({
    storage,
    now: () => 1_726_000_000_000,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === "PUT") return jsonResponse({ itemId: item.id, up: 1, down: 0, myVote: "up" });
      return jsonResponse({ items: [{ itemId: item.id, up: 0, down: 0, myVote: null }] });
    },
  });

  const result = await service.getVotes(edition.date, [item]);

  assert.equal(result.source, "synced");
  assert.deepEqual(result.records[item.id], { up: 1, down: 0, myVote: "up" });
  assert.equal(storage.getItem("today-i-found:votes:visitor-legacy"), null);
  assert.deepEqual(JSON.parse(storage.getItem("today-i-found:vote-outbox:visitor-legacy")), {});
});

test("a queued browser selection wins over conflicting legacy and remote votes", async () => {
  const item = edition.items[0];
  const storage = memoryStorage({
    "today-i-found:visitor-id": "visitor-conflict",
    "today-i-found:votes:visitor-conflict": JSON.stringify({ [item.id]: "up" }),
    "today-i-found:vote-outbox:visitor-conflict": JSON.stringify({
      [item.id]: { value: "down", updatedAt: 1_725_999_999_000 },
    }),
  });
  const service = createFeedbackService({
    storage,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === "PUT") return jsonResponse({ itemId: item.id, up: 4, down: 2, myVote: "down" });
      return jsonResponse({ items: [{ itemId: item.id, up: 5, down: 1, myVote: "up" }] });
    },
  });

  const result = await service.getVotes(edition.date, [item]);

  assert.equal(result.source, "synced");
  assert.deepEqual(result.records[item.id], { up: 4, down: 2, myVote: "down" });
  assert.equal(storage.getItem("today-i-found:votes:visitor-conflict"), null);
});

test("a rate-limited outbox mutation remains local until a later remote retry acknowledges it", async () => {
  const item = edition.items[0];
  const storage = memoryStorage({
    "today-i-found:visitor-id": "visitor-retry",
  });
  let attempts = 0;
  const service = createFeedbackService({
    storage,
    fetchImpl: async (_url, options = {}) => {
      if (options.method !== "PUT") return jsonResponse({ items: [{ itemId: item.id, up: 0, down: 0, myVote: null }] });
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 429, async json() { return { error: { code: "rate_limited" } }; } };
      return jsonResponse({ itemId: item.id, up: 1, down: 0, myVote: "up" });
    },
  });

  const limited = await service.setVote(item.id, "up", { up: 1, down: 0, myVote: "up" });

  assert.equal(limited.source, "syncing");
  assert.deepEqual(limited.record, { up: 1, down: 0, myVote: "up" });
  assert.equal(JSON.parse(storage.getItem("today-i-found:vote-outbox:visitor-retry"))[item.id].value, "up");

  const retried = await service.getVotes(edition.date, [item]);

  assert.equal(retried.source, "synced");
  assert.deepEqual(retried.records[item.id], { up: 1, down: 0, myVote: "up" });
  assert.deepEqual(JSON.parse(storage.getItem("today-i-found:vote-outbox:visitor-retry")), {});
});

test("a queued retry cannot send ahead of a newer vote for the same item", async () => {
  const item = edition.items[0];
  const storage = memoryStorage({
    "today-i-found:visitor-id": "visitor-race",
    "today-i-found:vote-outbox:visitor-race": JSON.stringify({
      [item.id]: { value: "up", updatedAt: 1_726_000_000_000 },
    }),
  });
  const pending = [];
  const service = createFeedbackService({
    storage,
    now: () => 1_726_000_000_001,
    fetchImpl: async (_url, options = {}) => {
      if (options.method !== "PUT") return jsonResponse({ items: [{ itemId: item.id, up: 0, down: 0, myVote: null }] });
      const value = JSON.parse(options.body).value;
      return new Promise((resolve) => pending.push({ value, resolve }));
    },
  });

  const retry = service.getVotes(edition.date, [item]);
  await new Promise((resolve) => setImmediate(resolve));
  const newer = service.setVote(item.id, "down", { up: 0, down: 1, myVote: "down" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(pending.map((request) => request.value), ["up"]);

  pending[0].resolve(jsonResponse({ itemId: item.id, up: 1, down: 0, myVote: "up" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pending.map((request) => request.value), ["up", "down"]);
  pending[1].resolve(jsonResponse({ itemId: item.id, up: 0, down: 1, myVote: "down" }));

  await Promise.all([retry, newer]);
});

test("feedback service targets a configured public Worker origin", async () => {
  const calls = [];
  const service = createFeedbackService({
    apiBase: "https://votes.today-i-found.example/",
    storage: memoryStorage(),
    cryptoImpl: { randomUUID: () => "visitor-worker" },
    fetchImpl: async (url) => {
      calls.push(url);
      return jsonResponse({ items: [] });
    },
  });

  await service.getVotes(edition.date, []);

  assert.equal(calls[0], "https://votes.today-i-found.example/v1/editions/2026-08-19/votes?visitorId=visitor-worker");
});

test("feedback service serializes rapid mutations and clears their acknowledged outbox entry", async () => {
  const pending = [];
  const storage = memoryStorage();
  const service = createFeedbackService({
    storage,
    cryptoImpl: { randomUUID: () => "visitor-serial" },
    fetchImpl: async () => new Promise((resolve) => pending.push(resolve)),
  });
  const itemId = edition.items[0].id;
  const upRecord = { up: 7, down: 0, myVote: "up" };
  const downRecord = { up: 6, down: 1, myVote: "down" };

  const first = service.setVote(itemId, "up", upRecord);
  const second = service.setVote(itemId, "down", downRecord);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 1, "the second mutation must wait for the first response");

  pending[0](jsonResponse({ record: upRecord }));
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1](jsonResponse({ record: downRecord }));
  await second;

  assert.deepEqual(JSON.parse(storage.getItem("today-i-found:vote-outbox:visitor-serial")), {});
});

test("feedback service persists an optimistic mutation until the Worker acknowledges it", async () => {
  const storage = memoryStorage({ "today-i-found:visitor-id": "visitor-outbox" });
  let acknowledge;
  const service = createFeedbackService({
    storage,
    now: () => 1_726_000_000_000,
    fetchImpl: async () => new Promise((resolve) => { acknowledge = resolve; }),
  });
  const itemId = edition.items[0].id;

  const mutation = service.setVote(itemId, "up", { up: 1, down: 0, myVote: "up" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(storage.getItem("today-i-found:vote-outbox:visitor-outbox")), {
    [itemId]: { value: "up", updatedAt: 1_726_000_000_000 },
  });

  acknowledge(jsonResponse({ itemId, up: 1, down: 0, myVote: "up" }));
  await mutation;

  assert.deepEqual(JSON.parse(storage.getItem("today-i-found:vote-outbox:visitor-outbox")), {});
});

test("feedback service never sends a vote that could not be durably queued", async () => {
  let requests = 0;
  const storage = {
    getItem(key) {
      return key === "today-i-found:visitor-id" ? "visitor-blocked-storage" : null;
    },
    setItem() {
      throw new Error("storage unavailable");
    },
  };
  const service = createFeedbackService({
    storage,
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse({ itemId: edition.items[0].id, up: 1, down: 0, myVote: "up" });
    },
  });

  const mutation = service.setVote(edition.items[0].id, "up", { up: 1, down: 0, myVote: "up" });

  assert.equal(mutation.initialPersistence, "failed");
  assert.deepEqual(await mutation, {
    record: { up: 1, down: 0, myVote: "up" },
    source: "local",
    persistence: "failed",
  });
  assert.equal(requests, 0);
});

test("late initial vote loads preserve records mutated after the request started", () => {
  assert.equal(typeof feedback.reconcileLoadedRecords, "function");
  const current = {
    a: { up: 11, down: 2, myVote: "up" },
    b: { up: 3, down: 1, myVote: null },
  };
  const loaded = {
    a: { up: 10, down: 2, myVote: null },
    b: { up: 8, down: 2, myVote: "down" },
  };

  assert.deepEqual(
    feedback.reconcileLoadedRecords(current, loaded, { a: 0, b: 0 }, { a: 1, b: 0 }),
    {
      a: current.a,
      b: loaded.b,
    },
  );
});

test("out-of-order vote mutations cannot replace the newest canonical record", () => {
  assert.equal(typeof feedback.reconcileMutationRecord, "function");
  const current = { up: 20, down: 4, myVote: "down" };
  const stale = { up: 21, down: 3, myVote: "up" };

  assert.deepEqual(feedback.reconcileMutationRecord(current, stale, 1, 2), current);
  assert.deepEqual(feedback.reconcileMutationRecord(current, stale, 2, 2), stale);
});

test("feedback source reconciliation ignores stale initial loads and mutations", () => {
  assert.equal(typeof feedback.reconcileFeedbackSource, "function");
  assert.equal(feedback.reconcileFeedbackSource("synced", "local", 0, 1), "synced");
  assert.equal(feedback.reconcileFeedbackSource("local", "syncing", 1, 2), "local");
  assert.equal(feedback.reconcileFeedbackSource("local", "synced", 2, 2), "synced");
});
