import assert from "node:assert/strict";
import test from "node:test";

import * as clipboard from "../src/clipboard.js";

function fallbackDocument(copyResult) {
  let removed = false;
  let restored = false;
  const previous = { focus() { restored = true; } };
  const textarea = {
    value: "",
    style: {},
    setAttribute() {},
    select() { documentImpl.activeElement = textarea; },
    remove() { removed = true; },
  };
  const documentImpl = {
    activeElement: previous,
    body: { append() {} },
    createElement() { return textarea; },
    execCommand(command) {
      assert.equal(command, "copy");
      return copyResult;
    },
    result() { return { removed, restored, value: textarea.value }; },
  };
  return documentImpl;
}

test("copyText reports clipboard API success without using the fallback", async () => {
  assert.equal(typeof clipboard.copyText, "function");
  const documentImpl = fallbackDocument(false);

  const copied = await clipboard.copyText("alpha", {
    clipboardImpl: { async writeText(value) { assert.equal(value, "alpha"); } },
    documentImpl,
  });

  assert.equal(copied, true);
  assert.equal(documentImpl.result().removed, false);
});

test("copyText uses a real textarea fallback and reports failure truthfully", async () => {
  assert.equal(typeof clipboard.copyText, "function");
  const successfulDocument = fallbackDocument(true);
  const failedDocument = fallbackDocument(false);
  const blockedClipboard = { async writeText() { throw new Error("blocked"); } };

  assert.equal(await clipboard.copyText("beta", { clipboardImpl: blockedClipboard, documentImpl: successfulDocument }), true);
  assert.deepEqual(successfulDocument.result(), { removed: true, restored: true, value: "beta" });
  assert.equal(await clipboard.copyText("gamma", { clipboardImpl: blockedClipboard, documentImpl: failedDocument }), false);
  assert.deepEqual(failedDocument.result(), { removed: true, restored: true, value: "gamma" });
});
