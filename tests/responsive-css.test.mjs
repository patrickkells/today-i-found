import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const cases = [
  { width: 1488, table: 823, minimum: 802 },
  { width: 1467, table: 802, minimum: 802 },
  { width: 1466, table: 1046, minimum: 708 },
  { width: 1366, table: 946, minimum: 708 },
  { width: 1128, table: 708, minimum: 708 },
  { width: 1127, table: 747, minimum: 600 },
  { width: 980, table: 600, minimum: 600 },
  { width: 979, table: 619, minimum: 361 },
  { width: 921, table: 561, minimum: 361 },
  { width: 746, table: 386, minimum: 361 },
  { width: 721, table: 361, minimum: 361 },
];

test("every desktop and tablet breakpoint boundary has enough width for synchronized row tracks", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 1466px\)/);
  assert.match(css, /@media \(max-width: 1127px\)/);
  assert.match(css, /@media \(max-width: 979px\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(max-width: 979px\)[\s\S]*grid-template-columns:\s*28px minmax\(144px, 1fr\) 70px;/);

  for (const { width, table, minimum } of cases) {
    assert.ok(table >= minimum, `${width}px leaves ${table}px for a ${minimum}px synchronized table`);
  }
});

test("the phone footer keeps the local-feedback badge visible", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const phoneRules = css.match(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(phoneRules, /\.footer-status > span:not\(:first-child\):not\(\.local-badge\)/);
  assert.doesNotMatch(phoneRules, /\.footer-status span:nth-child\(n \+ 2\)/);
});

test("phone header actions restore their labels after tablet icon compaction", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const phoneRules = css.match(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(phoneRules, /\.header-action\s*\{[\s\S]*?width:\s*auto;[\s\S]*?padding:\s*0 10px;[\s\S]*?overflow:\s*visible;[\s\S]*?color:\s*var\(--muted\);[\s\S]*?gap:\s*7px;/);
});

test("signal copy wraps without truncation so rows can grow with their content", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const dom = new JSDOM(`<!doctype html><style>${css}</style><article class="signal-row"><span class="signal-rank">01</span><div class="signal-copy"><a class="signal-title">A deliberately long signal title</a><span class="signal-summary">A deliberately long summary</span><a class="signal-source-inline">Publisher · VERIFIED AUG 20 ↗</a></div><span class="signal-category">MODEL</span><div class="vote-controls"></div></article>`);
  const title = dom.window.getComputedStyle(dom.window.document.querySelector(".signal-title"));
  const summary = dom.window.getComputedStyle(dom.window.document.querySelector(".signal-summary"));
  const source = dom.window.getComputedStyle(dom.window.document.querySelector(".signal-source-inline"));

  assert.notEqual(title.whiteSpace, "nowrap");
  assert.notEqual(title.textOverflow, "ellipsis");
  assert.notEqual(summary.getPropertyValue("-webkit-line-clamp"), "2");
  assert.notEqual(summary.overflow, "hidden");
  assert.equal(source.flexWrap, "wrap");
});

test("broad topic tags and transparency copy wrap instead of overflowing", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.signal-tags\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  assert.match(css, /\.edition-transparency\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
});
