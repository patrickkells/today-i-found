import assert from "node:assert/strict";
import test from "node:test";

import { createFeedbackWorker } from "../feedback-worker/index.js";

const ORIGIN = "https://example.github.io";
const NOW = Date.parse("2026-08-19T12:00:00.000Z");

class FakeStatement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new FakeStatement(this.db, this.sql, args);
  }

  first() {
    return this.db.execute(this.sql, this.args, "first");
  }

  all() {
    return this.db.execute(this.sql, this.args, "all");
  }

  run() {
    return this.db.execute(this.sql, this.args, "run");
  }
}

class FakeD1 {
  constructor() {
    this.editions = new Map();
    this.items = new Map();
    this.votes = new Map();
    this.rateLimits = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  execute(sql, args, mode) {
    const op = sql.match(/\/\*\s*([\w.]+)\s*\*\//)?.[1];
    if (op === "edition.upsert") {
      const [date, title, summary, curatedAt, timezone] = args;
      this.editions.set(date, { date, title, summary, curatedAt, timezone });
      return result();
    }
    if (op === "item.upsert") {
      const [id, editionDate, title, category, source, tagsJson, publicationDate] = args;
      this.items.set(id, { id, editionDate, title, category, source, tagsJson, publicationDate });
      return result();
    }
    if (op === "item.deleteMissing") {
      const [editionDate, ...retainedIds] = args;
      for (const [itemId, item] of this.items) {
        if (item.editionDate !== editionDate || retainedIds.includes(itemId)) continue;
        this.items.delete(itemId);
        for (const [voteKey, vote] of this.votes) {
          if (vote.itemId === itemId) this.votes.delete(voteKey);
        }
      }
      return result();
    }
    if (op === "edition.byDate") {
      return this.editions.get(args[0]) ?? null;
    }
    if (op === "items.votesByEdition") {
      const [visitorHash, editionDate] = args;
      const rows = [...this.items.values()]
        .filter((item) => item.editionDate === editionDate)
        .map((item) => aggregate(this, item, visitorHash));
      return mode === "all" ? { results: rows } : rows[0] ?? null;
    }
    if (op === "item.byId") {
      return this.items.get(args[0]) ?? null;
    }
    if (op === "rate.bump") {
      const [ipHash, bucketStart] = args;
      const key = `${ipHash}:${bucketStart}`;
      const count = (this.rateLimits.get(key) ?? 0) + 1;
      this.rateLimits.set(key, count);
      return { count };
    }
    if (op === "rate.prune") {
      const [cutoff] = args;
      for (const key of this.rateLimits.keys()) {
        const bucketStart = Number(key.slice(key.lastIndexOf(":") + 1));
        if (bucketStart < cutoff) this.rateLimits.delete(key);
      }
      return result();
    }
    if (op === "vote.upsert") {
      const [itemId, visitorHash, value, createdAt, updatedAt] = args;
      const key = `${itemId}:${visitorHash}`;
      const existing = this.votes.get(key);
      this.votes.set(key, {
        itemId,
        visitorHash,
        value,
        createdAt: existing?.createdAt ?? createdAt,
        updatedAt,
      });
      return result();
    }
    if (op === "vote.delete") {
      this.votes.delete(`${args[0]}:${args[1]}`);
      return result();
    }
    if (op === "vote.aggregate") {
      const [visitorHash, itemId] = args;
      const item = this.items.get(itemId);
      return item ? aggregate(this, item, visitorHash) : null;
    }
    if (op === "summary.rows") {
      const [since] = args;
      const rows = [...this.votes.values()]
        .filter((vote) => vote.updatedAt >= since)
        .map((vote) => {
          const item = this.items.get(vote.itemId);
          return {
            value: vote.value,
            updated_at: vote.updatedAt,
            category: item.category,
            source: item.source,
            tags_json: item.tagsJson,
          };
        });
      return { results: rows };
    }
    throw new Error(`Unhandled fake D1 operation: ${op ?? sql}`);
  }
}

function result() {
  return { success: true, meta: { changes: 1 } };
}

function aggregate(db, item, visitorHash) {
  const votes = [...db.votes.values()].filter((vote) => vote.itemId === item.id);
  return {
    item_id: item.id,
    up: votes.filter((vote) => vote.value === 1).length,
    down: votes.filter((vote) => vote.value === -1).length,
    my_vote: votes.find((vote) => vote.visitorHash === visitorHash)?.value ?? null,
  };
}

function makeContext() {
  let now = NOW;
  const env = {
    DB: new FakeD1(),
    CURATOR_TOKEN: "curator-secret",
    HMAC_SECRET: "hmac-secret-with-enough-entropy-32",
    ALLOWED_ORIGIN: ORIGIN,
  };
  const worker = createFeedbackWorker({ now: () => now });
  return {
    env,
    worker,
    setNow(value) {
      now = value;
    },
  };
}

function edition(overrides = {}) {
  return {
    date: "2026-08-19",
    title: "today i found — August 19, 2026",
    summary: "Two useful releases.",
    curatedAt: "2026-08-19T07:42:00-04:00",
    timezone: "America/New_York",
    items: [
      {
        id: "signal-one",
        title: "Signal one",
        category: "Models",
        publicationDate: "2026-08-19",
        tags: ["agents", "api"],
        source: { publisher: "OpenAI" },
      },
      {
        id: "signal-two",
        title: "Signal two",
        category: "Tools",
        publicationDate: "2026-08-18",
        tags: ["evals"],
        source: { publisher: "Mozilla" },
      },
    ],
    ...overrides,
  };
}

function request(path, { method = "GET", origin = ORIGIN, token, ip = "203.0.113.8", body } = {}) {
  const headers = new Headers({ origin, "cf-connecting-ip": ip });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://feedback.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response) {
  return response.json();
}

async function register(context, payload = edition()) {
  return context.worker.fetch(request("/v1/editions", {
    method: "POST",
    token: "curator-secret",
    body: payload,
  }), context.env);
}

test("curator registration is protected, idempotent, and keeps stable item IDs", async () => {
  const context = makeContext();

  const unauthorized = await context.worker.fetch(request("/v1/editions", {
    method: "POST",
    body: edition(),
  }), context.env);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await json(unauthorized), {
    error: { code: "unauthorized", message: "A valid curator token is required." },
  });

  const first = await register(context);
  const second = await register(context, edition({ title: "Updated title" }));
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.deepEqual(await json(second), { date: "2026-08-19", itemCount: 2, created: false });
  assert.equal(context.env.DB.editions.size, 1);
  assert.equal(context.env.DB.items.size, 2);
  assert.equal(context.env.DB.editions.get("2026-08-19").title, "Updated title");
  assert.equal(context.env.DB.items.get("signal-one").publicationDate, "2026-08-19");
});

test("re-registration reconciles membership while preserving retained votes and exact-repeat state", async () => {
  const context = makeContext();
  await register(context);

  await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: 1, visitorId: "retained-voter" },
  }), context.env);
  await context.worker.fetch(request("/v1/items/signal-two/vote", {
    method: "PUT",
    ip: "203.0.113.9",
    body: { value: -1, visitorId: "removed-voter" },
  }), context.env);

  await register(context);
  const exactRepeat = await context.worker.fetch(
    request("/v1/editions/2026-08-19/votes?visitorId=retained-voter"),
    context.env,
  );
  assert.deepEqual((await json(exactRepeat)).items, [
    { itemId: "signal-one", up: 1, down: 0, myVote: "up" },
    { itemId: "signal-two", up: 0, down: 1, myVote: null },
  ]);

  const retainedItem = edition().items[0];
  const changed = await register(context, edition({ items: [retainedItem] }));
  assert.equal(changed.status, 200);

  const reconciled = await context.worker.fetch(
    request("/v1/editions/2026-08-19/votes?visitorId=retained-voter"),
    context.env,
  );
  assert.deepEqual((await json(reconciled)).items, [
    { itemId: "signal-one", up: 1, down: 0, myVote: "up" },
  ]);

  const removedVote = await context.worker.fetch(request("/v1/items/signal-two/vote", {
    method: "PUT",
    body: { value: 1, visitorId: "removed-voter" },
  }), context.env);
  assert.equal(removedVote.status, 404);
  assert.equal((await json(removedVote)).error.code, "item_not_found");
  assert.equal([...context.env.DB.votes.values()].some((vote) => vote.itemId === "signal-two"), false);
});

test("GET and PUT implement creation, replacement, removal, and canonical aggregation", async () => {
  const context = makeContext();
  await register(context);

  const empty = await context.worker.fetch(request("/v1/editions/2026-08-19/votes?visitorId=browser-a"), context.env);
  assert.equal(empty.status, 200);
  assert.deepEqual(await json(empty), {
    date: "2026-08-19",
    items: [
      { itemId: "signal-one", up: 0, down: 0, myVote: null },
      { itemId: "signal-two", up: 0, down: 0, myVote: null },
    ],
  });

  const created = await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: "up", visitorId: "browser-a" },
  }), context.env);
  assert.deepEqual(await json(created), { itemId: "signal-one", up: 1, down: 0, myVote: "up" });

  const replaced = await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: -1, visitorId: "browser-a" },
  }), context.env);
  assert.deepEqual(await json(replaced), { itemId: "signal-one", up: 0, down: 1, myVote: "down" });

  const other = await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    ip: "203.0.113.9",
    body: { value: 1, visitorId: "browser-b" },
  }), context.env);
  assert.deepEqual(await json(other), { itemId: "signal-one", up: 1, down: 1, myVote: "up" });

  const removed = await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: null, visitorId: "browser-a" },
  }), context.env);
  assert.deepEqual(await json(removed), { itemId: "signal-one", up: 1, down: 0, myVote: null });

  await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: 1, visitorId: "browser-a" },
  }), context.env);
  const removedWithNumericZero = await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: 0, visitorId: "browser-a" },
  }), context.env);
  assert.deepEqual(await json(removedWithNumericZero), { itemId: "signal-one", up: 1, down: 0, myVote: null });
});

test("vote routes reject malformed values, missing identifiers, unknown items, and dates", async () => {
  const context = makeContext();
  await register(context);

  const invalid = await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: 2, visitorId: "browser-a" },
  }), context.env);
  assert.equal(invalid.status, 400);
  assert.equal((await json(invalid)).error.code, "invalid_vote");

  const missingVisitor = await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: 1 },
  }), context.env);
  assert.equal(missingVisitor.status, 400);
  assert.equal((await json(missingVisitor)).error.code, "invalid_visitor");

  const unknownItem = await context.worker.fetch(request("/v1/items/missing/vote", {
    method: "PUT",
    body: { value: 1, visitorId: "browser-a" },
  }), context.env);
  assert.equal(unknownItem.status, 404);
  assert.equal((await json(unknownItem)).error.code, "item_not_found");

  const unknownDate = await context.worker.fetch(request("/v1/editions/2026-08-18/votes?visitorId=browser-a"), context.env);
  assert.equal(unknownDate.status, 404);
  assert.equal((await json(unknownDate)).error.code, "edition_not_found");
});

test("CORS permits the configured Pages origin and local development only", async () => {
  const context = makeContext();
  await register(context);

  const preflight = await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "OPTIONS",
    origin: "http://localhost:5173",
  }), context.env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.match(preflight.headers.get("access-control-allow-methods"), /PUT/);

  const allowed = await context.worker.fetch(request("/v1/editions/2026-08-19/votes?visitorId=browser-a"), context.env);
  assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(allowed.headers.get("vary"), "Origin");

  const denied = await context.worker.fetch(request("/v1/editions/2026-08-19/votes?visitorId=browser-a", {
    origin: "https://evil.example",
  }), context.env);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal((await json(denied)).error.code, "origin_not_allowed");
});

test("the D1-backed IP limit permits 60 vote mutations per hour", async () => {
  const context = makeContext();
  await register(context);

  for (let index = 0; index < 60; index += 1) {
    const response = await context.worker.fetch(request("/v1/items/signal-one/vote", {
      method: "PUT",
      body: { value: index % 2 ? 1 : -1, visitorId: "browser-a" },
    }), context.env);
    assert.equal(response.status, 200, `mutation ${index + 1} should be allowed`);
  }

  const limited = await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: 0, visitorId: "browser-a" },
  }), context.env);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "3600");
  assert.equal((await json(limited)).error.code, "rate_limited");
});

test("concurrent mutations share one atomic fixed-hour counter and return the bucket-boundary delay", async () => {
  const context = makeContext();
  await register(context);
  context.setNow(NOW + 15 * 60_000);

  const responses = await Promise.all(Array.from({ length: 61 }, (_, index) => (
    context.worker.fetch(request("/v1/items/signal-one/vote", {
      method: "PUT",
      body: { value: index % 2 ? 1 : -1, visitorId: `concurrent-${index}` },
    }), context.env)
  )));
  const statuses = responses.map((response) => response.status);
  assert.equal(statuses.filter((status) => status === 200).length, 60);
  assert.equal(statuses.filter((status) => status === 429).length, 1);
  assert.equal(responses.find((response) => response.status === 429).headers.get("retry-after"), "2700");
});

test("vote mutations prune fixed-window counters older than 48 hours", async () => {
  const context = makeContext();
  await register(context);
  const expiredKey = `expired:${NOW - 49 * 3_600_000}`;
  const retainedKey = `retained:${NOW - 47 * 3_600_000}`;
  context.env.DB.rateLimits.set(expiredKey, 1);
  context.env.DB.rateLimits.set(retainedKey, 1);

  const response = await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: 1, visitorId: "browser-a" },
  }), context.env);
  assert.equal(response.status, 200);
  assert.equal(context.env.DB.rateLimits.has(expiredKey), false);
  assert.equal(context.env.DB.rateLimits.has(retainedKey), true);
});

test("requests reject HMAC secrets shorter than 32 characters", async () => {
  const context = makeContext();
  context.env.HMAC_SECRET = "short-hmac-secret";

  const response = await register(context);
  assert.equal(response.status, 500);
  assert.deepEqual(await json(response), {
    error: {
      code: "service_misconfigured",
      message: "The feedback service is not configured securely.",
    },
  });
  assert.equal(context.env.DB.editions.size, 0);
});

test("D1 stores HMAC hashes and never raw visitor IDs or IPs", async () => {
  const context = makeContext();
  await register(context);
  await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    ip: "198.51.100.44",
    body: { value: "down", visitorId: "private-browser-id" },
  }), context.env);

  const storedVote = [...context.env.DB.votes.values()][0];
  const storedRateKey = [...context.env.DB.rateLimits.keys()][0];
  assert.match(storedVote.visitorHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(storedVote), /private-browser-id/);
  assert.doesNotMatch(storedRateKey, /198\.51\.100\.44/);
});

test("summary authorization, time decay, Bayesian smoothing, and adjustment cap are enforced", async () => {
  const context = makeContext();
  await register(context);

  const unauthorized = await context.worker.fetch(request("/v1/feedback/summary?days=90"), context.env);
  assert.equal(unauthorized.status, 401);

  context.setNow(NOW - 60 * 86_400_000);
  await context.worker.fetch(request("/v1/items/signal-one/vote", {
    method: "PUT",
    body: { value: -1, visitorId: "old-voter" },
  }), context.env);

  context.setNow(NOW);
  for (let index = 0; index < 10; index += 1) {
    await context.worker.fetch(request("/v1/items/signal-one/vote", {
      method: "PUT",
      ip: `198.51.100.${index + 1}`,
      body: { value: 1, visitorId: `recent-voter-${index}` },
    }), context.env);
  }
  await context.worker.fetch(request("/v1/items/signal-two/vote", {
    method: "PUT",
    ip: "198.51.100.30",
    body: { value: 1, visitorId: "single-voter" },
  }), context.env);

  const response = await context.worker.fetch(request("/v1/feedback/summary?days=90", {
    token: "curator-secret",
  }), context.env);
  assert.equal(response.status, 200);
  const payload = await json(response);
  assert.equal(payload.days, 90);
  assert.equal(payload.model.decayHalfLifeDays, 30);

  const models = payload.preferences.category.find((entry) => entry.value === "Models");
  const tools = payload.preferences.category.find((entry) => entry.value === "Tools");
  assert.equal(models.up, 10);
  assert.equal(models.down, 0.25);
  assert.equal(models.effectiveVotes, 10.25);
  assert.equal(models.eligible, true);
  assert.equal(models.adjustment, 0.5);
  assert.equal(tools.effectiveVotes, 1);
  assert.equal(tools.eligible, false);
  assert.equal(tools.preference, 0.6);
  assert.equal(tools.adjustment, 0.2);
  assert.ok(payload.preferences.source.some((entry) => entry.value === "OpenAI"));
  assert.ok(payload.preferences.tag.some((entry) => entry.value === "agents"));
});
