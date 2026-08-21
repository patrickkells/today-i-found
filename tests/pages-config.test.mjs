import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";
import { readFile } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Vite uses the configured GitHub Pages subpath for emitted assets", async () => {
  const previous = process.env.VITE_BASE_PATH;
  process.env.VITE_BASE_PATH = "/today-i-found/";
  try {
    const config = await resolveConfig({ configFile: path.join(root, "vite.config.mjs") }, "build");
    assert.equal(config.base, "/today-i-found/");
  } finally {
    if (previous === undefined) delete process.env.VITE_BASE_PATH;
    else process.env.VITE_BASE_PATH = previous;
  }
});

test("the Pages build forwards the configured feedback Worker origin to Vite", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/deploy-pages.yml"), "utf8");

  assert.match(workflow, /VITE_FEEDBACK_API_BASE:\s*\$\{\{\s*vars\.FEEDBACK_API_BASE\s*\}\}/);
});

test("the feedback Worker permits both public production origins exactly", async () => {
  const config = await readFile(path.join(root, "feedback-worker/wrangler.toml"), "utf8");
  assert.match(config, /ALLOWED_ORIGIN\s*=\s*"https:\/\/patrickkells\.github\.io,https:\/\/today-i-found\.pages\.dev"/);
});

test("the Pages build installs the checked-in pnpm lockfile reproducibly", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/deploy-pages.yml"), "utf8");

  assert.match(workflow, /pnpm\/action-setup@[0-9a-f]{40}\s+# v4/);
  assert.match(workflow, /cache:\s*pnpm/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(workflow, /npm ci/);
});

test("the Pages workflow pins actions and grants deployment privileges only to the deploy job", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/deploy-pages.yml"), "utf8");

  assert.doesNotMatch(workflow, /^permissions:/m);
  assert.match(workflow, /build:\n[\s\S]*?permissions:\n\s+contents: read/);
  assert.match(workflow, /deploy:\n[\s\S]*?permissions:\n\s+pages: write\n\s+id-token: write/);
  const actions = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/g)];
  assert.ok(actions.length > 0);
  for (const match of actions) {
    assert.match(match[1], /^[0-9a-f]{40}$/, match[0]);
  }
});

test("the curator instruction describes the broad accounted workflow", async () => {
  const text = await readFile(path.join(root, "docs/curator-scheduled-task.md"), "utf8");
  assert.match(text, /one to forty/i);
  assert.match(text, /complete GitHub Trending all-language daily and weekly/i);
  assert.match(text, /candidate-ledger/i);
  assert.match(text, /twenty percent/i);
  assert.match(text, /promptVersion/);
  assert.match(text, /publish no edition/i);
  for (const category of [
    "AI & Automation",
    "Software & Developer Tools",
    "Web & Platforms",
    "Security & Privacy",
    "Hardware & Devices",
    "Science & Emerging Tech",
    "Consumer Technology",
    "Curiosities",
  ]) assert.match(text, new RegExp(category.replaceAll("&", "&")));
});
