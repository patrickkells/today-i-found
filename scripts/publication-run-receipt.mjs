#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPrivateClaimFile } from "../lib/publication-claim-file.js";
import { PublicationRunGate } from "../lib/publication-run-gate.js";
import { writeTerminalRunReceipt } from "../lib/publication-run-receipt.js";

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

if (process.argv[2] !== "record") throw new Error("Usage: publication-run-receipt.mjs record --date YYYY-MM-DD --claim-file FILE --result published|no-edition [evidence]");
const projectRoot = path.resolve(option("--project-root", defaultProjectRoot));
const date = required("--date");
const claimId = process.env.TODAY_I_FOUND_CLAIM_ID
  || await readPrivateClaimFile(path.resolve(required("--claim-file")), date);
const result = required("--result");
const gate = new PublicationRunGate({
  rootDirectory: path.resolve(option("--root", path.join(projectRoot, ".curation", "run-gates"))),
});
const receipt = {
  schemaVersion: 1,
  date,
  claimId,
  result,
  completedAt: new Date().toISOString(),
};
if (result === "published") {
  receipt.checks = {
    editionValidated: process.argv.includes("--edition-validated"),
    fullTests: process.argv.includes("--full-tests"),
    feedbackTests: process.argv.includes("--feedback-tests"),
    archivesValidated: process.argv.includes("--archives-validated"),
    build: process.argv.includes("--build-passed"),
    sitesTests: process.argv.includes("--sites-tests"),
    registration: required("--registration"),
    commit: required("--commit"),
    pushed: process.argv.includes("--pushed"),
    deployment: {
      verified: process.argv.includes("--deployment-verified"),
      url: required("--deployment-url"),
      verifiedAt: required("--deployment-verified-at"),
    },
  };
}
await writeTerminalRunReceipt({
  projectRoot,
  gate,
  receipt,
  feedbackEnabled: process.argv.includes("--feedback-enabled"),
});
console.log(JSON.stringify({ recorded: true, date, result }));
