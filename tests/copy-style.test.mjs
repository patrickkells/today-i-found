import assert from "node:assert/strict";
import test from "node:test";

import policy from "../config/curation-policy.json" with { type: "json" };
import { validateCopyStyle } from "../lib/copy-style.js";
import calibration from "./fixtures/copy-calibration.json" with { type: "json" };

test("copy validation rejects factual names and numbers absent from the evidence", () => {
  const errors = validateCopyStyle({
    title: "Acme releases Trace Viewer",
    summary: "The tool sends 40 trace types to Cloudflare.",
    evidenceFacts: ["Acme released Trace Viewer for local browser debugging."],
  }, policy.copy);

  assert.match(errors.join("\n"), /unsupported factual anchors: 40, Cloudflare/);
});

test("the selected five-story calibration copy clears every deterministic guard", () => {
  for (const item of calibration) {
    const selected = item.variants.find((variant) => variant.label === "selected");
    assert.deepEqual(
      validateCopyStyle({ ...selected, evidenceFacts: item.evidenceFacts }, policy.copy),
      [],
      item.id,
    );
  }
});

test("copy validation enforces the configured headline and summary limits", () => {
  const errors = validateCopyStyle({
    title: "A".repeat(policy.copy.titleMaxCharacters + 1),
    summary: Array(policy.copy.summaryMaxWords + 1).fill("word").join(" "),
    evidenceFacts: [],
  }, policy.copy);

  assert.match(errors.join("\n"), /title exceeds 90 characters/);
  assert.match(errors.join("\n"), /summary exceeds 45 words/);
});

test("copy validation rejects em dashes and curly quotes", () => {
  const errors = validateCopyStyle({
    title: "Acme — releases Trace Viewer",
    summary: "The tool records “browser traces” locally.",
    evidenceFacts: ["Acme releases Trace Viewer. The tool records browser traces locally."],
  }, policy.copy);

  assert.match(errors.join("\n"), /disallowed AI-default punctuation/);
});
