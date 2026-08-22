import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeVisitorTransfer,
  prepareVisitorTransfer,
  VISITOR_STORAGE_KEY,
} from "../src/visitor-transfer.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("a report-site handoff preserves the anonymous voter identity without putting it in the URL", () => {
  const sourceWindow = {
    name: "",
    location: { origin: "https://patrickkells.github.io" },
  };
  const destinationWindow = {
    name: "",
    location: { origin: "https://today-i-found.pages.dev" },
  };
  const storage = memoryStorage();

  assert.equal(prepareVisitorTransfer(sourceWindow, "visitor-123", "https://today-i-found.pages.dev", { now: 1_000 }), true);
  destinationWindow.name = sourceWindow.name;

  assert.equal(consumeVisitorTransfer(destinationWindow, storage, {
    allowedSourceOrigins: ["https://patrickkells.github.io"],
    targetOrigin: "https://today-i-found.pages.dev",
    now: 1_100,
  }), true);
  assert.equal(storage.getItem(VISITOR_STORAGE_KEY), "visitor-123");
  assert.equal(destinationWindow.name, "");
});

test("visitor handoffs fail closed for stale, untrusted, or wrong-destination payloads", () => {
  const storage = memoryStorage();
  const sourceWindow = {
    name: "",
    location: { origin: "https://malicious.example" },
  };
  prepareVisitorTransfer(sourceWindow, "visitor-123", "https://today-i-found.pages.dev", { now: 1_000 });

  const destinationWindow = {
    name: sourceWindow.name,
    location: { origin: "https://today-i-found.pages.dev" },
  };
  assert.equal(consumeVisitorTransfer(destinationWindow, storage, {
    allowedSourceOrigins: ["https://patrickkells.github.io"],
    targetOrigin: "https://today-i-found.pages.dev",
    now: 1_100,
  }), false);
  assert.equal(storage.getItem(VISITOR_STORAGE_KEY), null);
  assert.equal(destinationWindow.name, "");

  const trustedWindow = {
    name: "",
    location: { origin: "https://patrickkells.github.io" },
  };
  prepareVisitorTransfer(trustedWindow, "visitor-456", "https://today-i-found.pages.dev", { now: 2_000 });
  destinationWindow.name = trustedWindow.name;
  assert.equal(consumeVisitorTransfer(destinationWindow, storage, {
    allowedSourceOrigins: ["https://patrickkells.github.io"],
    targetOrigin: "https://today-i-found.pages.dev",
    now: 2_000 + 5 * 60_000 + 1,
  }), false);
  assert.equal(storage.getItem(VISITOR_STORAGE_KEY), null);
});
