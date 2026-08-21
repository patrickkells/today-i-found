import assert from "node:assert/strict";
import test from "node:test";

import edition from "./fixtures/edition.json" with { type: "json" };
import broadEdition from "./fixtures/edition-v3.json" with { type: "json" };
import {
  applyVote,
  createInitialState,
  filterSignals,
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

test("feedback fallback reports only votes actually stored in this browser", async () => {
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

  assert.equal(result.source, "fallback");
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

test("feedback service serializes rapid mutations for the same item", async () => {
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

  assert.deepEqual(JSON.parse(storage.getItem("today-i-found:votes:visitor-serial")), { [itemId]: "down" });
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
  assert.equal(feedback.reconcileFeedbackSource("remote", "fallback", 0, 1), "remote");
  assert.equal(feedback.reconcileFeedbackSource("fallback", "remote", 1, 2), "fallback");
  assert.equal(feedback.reconcileFeedbackSource("fallback", "remote", 2, 2), "remote");
});
