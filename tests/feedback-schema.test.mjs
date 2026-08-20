import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const schema = readFileSync(new URL("../feedback-worker/schema.sql", import.meta.url), "utf8");

test("rate-limit retention uses an index instead of scanning every counter", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(schema);
    const plan = database
      .prepare("EXPLAIN QUERY PLAN DELETE FROM rate_limits WHERE bucket_start < ?")
      .all(123)
      .map((step) => step.detail)
      .join("\n");

    assert.match(plan, /SEARCH rate_limits USING INDEX .*bucket_start/i);
    assert.doesNotMatch(plan, /SCAN rate_limits/i);
  } finally {
    database.close();
  }
});

test("items persist public metadata without a retired base score", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(schema);
    const columns = database.prepare("PRAGMA table_info(items)").all().map((column) => column.name);

    assert.equal(columns.includes("base_score"), false);
  } finally {
    database.close();
  }
});
