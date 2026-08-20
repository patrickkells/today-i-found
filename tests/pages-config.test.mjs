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

test("the Pages build installs the checked-in pnpm lockfile reproducibly", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/deploy-pages.yml"), "utf8");

  assert.match(workflow, /pnpm\/action-setup@v4/);
  assert.match(workflow, /cache:\s*pnpm/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(workflow, /npm ci/);
});
