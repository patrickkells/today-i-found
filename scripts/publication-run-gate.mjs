#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPrivateClaimFile, writePrivateClaimFile } from "../lib/publication-claim-file.js";
import { PublicationRunGate } from "../lib/publication-run-gate.js";
import { readValidTerminalRunReceipt } from "../lib/publication-run-receipt.js";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function required(name) {
  const value = option(name);
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

const command = process.argv[2];
const date = required("--date");
const projectRoot = path.resolve(option("--project-root", defaultProjectRoot));
const gate = new PublicationRunGate({
  rootDirectory: path.resolve(option("--root", path.join(projectRoot, ".curation", "run-gates"))),
  staleAfterMs: Number(option("--stale-after-ms", 2 * 60 * 60 * 1_000)),
});

async function claimId() {
  if (process.env.TODAY_I_FOUND_CLAIM_ID) return process.env.TODAY_I_FOUND_CLAIM_ID;
  return readPrivateClaimFile(path.resolve(required("--claim-file")), date);
}

let result;
if (command === "claim") {
  result = await gate.claim({ date, owner: required("--owner") });
  if (result.claimed) {
    try {
      await writePrivateClaimFile(path.resolve(required("--claim-file")), result);
    } catch (error) {
      await gate.fail({ date, claimId: result.claimId, reason: "curation-failed" });
      throw error;
    }
  }
  if (!result.claimed) process.exitCode = 2;
} else if (command === "status") {
  result = await gate.status({ date });
} else if (command === "renew") {
  result = await gate.renew({ date, claimId: await claimId() });
} else if (command === "assert-owned") {
  result = await gate.assertOwned({ date, claimId: await claimId() });
} else if (command === "finalize") {
  const privateClaimId = await claimId();
  const receipt = await readValidTerminalRunReceipt({
    projectRoot,
    gate,
    date,
    claimId: privateClaimId,
    feedbackEnabled: process.argv.includes("--feedback-enabled"),
  });
  result = await gate.complete({ date, claimId: privateClaimId, result: receipt.result });
} else if (command === "fail") {
  result = await gate.fail({ date, claimId: await claimId(), reason: required("--reason") });
} else {
  throw new Error("Usage: publication-run-gate.mjs <claim|renew|assert-owned|status|finalize|fail> --date YYYY-MM-DD [options]");
}

const { claimId: _claimId, ...publicResult } = result;
console.log(JSON.stringify(publicResult));
