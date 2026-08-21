import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { validateCandidateLedger, summarizeCandidateLedger } from "./candidate-ledger.js";
import { validateEdition } from "./curation.js";

const RESULTS = new Set(["published", "no-edition"]);
const RECEIPT_KEYS = new Set(["schemaVersion", "date", "claimId", "result", "completedAt", "checks"]);
const PUBLISHED_CHECK_KEYS = new Set([
  "editionValidated",
  "fullTests",
  "feedbackTests",
  "archivesValidated",
  "build",
  "sitesTests",
  "registration",
  "commit",
  "pushed",
  "deployment",
]);
const DEPLOYMENT_KEYS = new Set(["verified", "url", "verifiedAt", "editionSha256", "manifestSha256"]);
const PRODUCTION_BASE_URL = "https://patrickkells.github.io/today-i-found/";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const execFileAsync = promisify(execFile);

function receiptPath(projectRoot, date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Terminal run receipt date is invalid");
  }
  return path.join(projectRoot, ".curation", "run-receipts", `${date}.json`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function productionUrls(date) {
  return {
    edition: new URL(`data/editions/${date}.json`, PRODUCTION_BASE_URL).href,
    manifest: new URL("data/manifest.json", PRODUCTION_BASE_URL).href,
  };
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} could not be read as valid JSON`, { cause: error });
  }
}

function requireReceiptShape(receipt, { date, claimId }) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.date !== date || receipt.claimId !== claimId || !RESULTS.has(receipt.result)) {
    throw new Error("Terminal run receipt identity is invalid");
  }
  if (!Number.isFinite(Date.parse(receipt.completedAt))) throw new Error("Terminal run receipt completedAt is invalid");
  for (const key of Object.keys(receipt)) if (!RECEIPT_KEYS.has(key)) throw new Error(`Terminal run receipt field ${key} is not allowed`);
}

async function validateNoEdition(projectRoot, receipt) {
  if (receipt.checks !== undefined) throw new Error("A no-edition receipt may contain only its terminal identity");
  const ledger = await readJson(path.join(projectRoot, ".curation", "ledgers", `${receipt.date}.json`), "Candidate ledger");
  const errors = validateCandidateLedger(ledger);
  const summary = summarizeCandidateLedger(ledger);
  if (ledger.editionDate !== receipt.date || errors.length || summary.pendingCandidates || summary.eligibleCandidates) {
    throw new Error(`No-edition receipt requires a completed zero-eligible ledger${errors.length ? `: ${errors.join(" ")}` : ""}`);
  }
}

async function defaultGitState(projectRoot, { commit, date }) {
  try {
    const [{ stdout: head }, { stdout: upstream }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }),
      execFileAsync("git", ["rev-parse", "@{upstream}"], { cwd: projectRoot, encoding: "utf8" }),
    ]);
    const normalizedHead = head.trim();
    const normalizedUpstream = upstream.trim();
    const pushed = await execFileAsync("git", ["merge-base", "--is-ancestor", normalizedHead, normalizedUpstream], { cwd: projectRoot })
      .then(() => true, () => false);
    const [{ stdout: editionBytes }, { stdout: manifestBytes }] = await Promise.all([
      execFileAsync("git", ["show", `${commit}:data/editions/${date}.json`], { cwd: projectRoot, encoding: null, maxBuffer: 10 * 1024 * 1024 }),
      execFileAsync("git", ["show", `${commit}:data/manifest.json`], { cwd: projectRoot, encoding: null, maxBuffer: 10 * 1024 * 1024 }),
    ]);
    return { head: normalizedHead, pushed, editionBytes, manifestBytes };
  } catch {
    throw new Error("Published receipt could not verify commit and push state");
  }
}

async function bindPublishedContent(projectRoot, receipt) {
  if (receipt?.result !== "published") return receipt;
  receiptPath(projectRoot, receipt.date);
  const [editionBytes, manifestBytes] = await Promise.all([
    readFile(path.join(projectRoot, "data", "editions", `${receipt.date}.json`)),
    readFile(path.join(projectRoot, "data", "manifest.json")),
  ]);
  return {
    ...receipt,
    checks: {
      ...receipt.checks,
      deployment: {
        ...receipt.checks?.deployment,
        editionSha256: sha256(editionBytes),
        manifestSha256: sha256(manifestBytes),
      },
    },
  };
}

async function fetchProductionBytes(fetchImpl, url, label) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "follow" });
    if (!response.ok) throw new Error("deployment unavailable");
    if (response.url !== url) throw new Error(`${label} redirected away from the production deployment`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(`Published receipt could not verify the production ${label}`, { cause: error });
  }
}

async function validatePublished(projectRoot, receipt, feedbackEnabled, { gitState, fetchImpl }) {
  const editionFile = path.join(projectRoot, "data", "editions", `${receipt.date}.json`);
  const manifestFile = path.join(projectRoot, "data", "manifest.json");
  const edition = await readJson(editionFile, "Published edition");
  const editionErrors = validateEdition(edition);
  if (edition.date !== receipt.date || editionErrors.length) {
    throw new Error(`Published receipt requires a valid dated edition${editionErrors.length ? `: ${editionErrors.join(" ")}` : ""}`);
  }
  const manifest = await readJson(manifestFile, "Publication manifest");
  if (manifest.latestEdition !== receipt.date || !manifest.editions?.includes(receipt.date)) {
    throw new Error("Published receipt requires the edition in the current manifest");
  }
  const checks = receipt.checks;
  for (const key of Object.keys(checks ?? {})) {
    if (!PUBLISHED_CHECK_KEYS.has(key)) throw new Error(`Published receipt field ${key} is not allowed`);
  }
  for (const key of Object.keys(checks?.deployment ?? {})) {
    if (!DEPLOYMENT_KEYS.has(key)) throw new Error(`Published receipt deployment field ${key} is not allowed`);
  }
  for (const name of ["editionValidated", "fullTests", "feedbackTests", "archivesValidated", "build", "sitesTests", "pushed"]) {
    if (checks?.[name] !== true) throw new Error(`Published receipt check ${name} must be true`);
  }
  const expectedRegistration = feedbackEnabled ? "registered" : "not-configured";
  if (checks.registration !== expectedRegistration) {
    throw new Error(`Published receipt registration must be ${expectedRegistration}`);
  }
  if (!/^[0-9a-f]{40,64}$/i.test(checks.commit ?? "")) throw new Error("Published receipt requires a commit hash");
  const expectedUrls = productionUrls(receipt.date);
  if (checks.deployment?.verified !== true
    || !Number.isFinite(Date.parse(checks.deployment.verifiedAt))
    || checks.deployment.url !== expectedUrls.edition) {
    throw new Error("Published receipt requires the exact production deployment URL and verified evidence");
  }
  const [localEditionBytes, localManifestBytes] = await Promise.all([readFile(editionFile), readFile(manifestFile)]);
  if (checks.deployment.editionSha256 !== sha256(localEditionBytes)
    || checks.deployment.manifestSha256 !== sha256(localManifestBytes)) {
    throw new Error("Published receipt content hashes do not match the local edition and manifest");
  }
  const repository = await gitState(projectRoot, { commit: checks.commit, date: receipt.date });
  if (repository.head !== checks.commit || repository.pushed !== true) {
    throw new Error("Published receipt commit and push evidence does not match repository state");
  }
  if (sha256(repository.editionBytes ?? "") !== checks.deployment.editionSha256) {
    throw new Error("Published receipt commit edition does not match the local edition");
  }
  if (sha256(repository.manifestBytes ?? "") !== checks.deployment.manifestSha256) {
    throw new Error("Published receipt commit manifest does not match the local manifest");
  }
  let deployed;
  let deployedManifest;
  try {
    const [deployedEditionBytes, deployedManifestBytes] = await Promise.all([
      fetchProductionBytes(fetchImpl, expectedUrls.edition, "edition"),
      fetchProductionBytes(fetchImpl, expectedUrls.manifest, "manifest"),
    ]);
    if (sha256(deployedEditionBytes) !== checks.deployment.editionSha256
      || sha256(deployedManifestBytes) !== checks.deployment.manifestSha256) {
      throw new Error("Deployed content does not match the local edition and manifest");
    }
    deployed = JSON.parse(deployedEditionBytes.toString("utf8"));
    deployedManifest = JSON.parse(deployedManifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error("Published receipt production deployment does not match the local edition and manifest", { cause: error });
  }
  const deployedErrors = validateEdition(deployed);
  if (deployed.date !== receipt.date || deployedErrors.length
    || deployedManifest.latestEdition !== receipt.date
    || !deployedManifest.editions?.includes(receipt.date)) {
    throw new Error("Published receipt deployment does not contain the valid dated edition");
  }
}

async function validateReceipt({ projectRoot, gate, receipt, date, claimId, feedbackEnabled, gitState, fetchImpl }) {
  requireReceiptShape(receipt, { date, claimId });
  await gate.assertOwned({ date, claimId });
  if (receipt.result === "no-edition") await validateNoEdition(projectRoot, receipt);
  else await validatePublished(projectRoot, receipt, feedbackEnabled, { gitState, fetchImpl });
  return receipt;
}

export async function writeTerminalRunReceipt({
  projectRoot,
  gate,
  receipt,
  feedbackEnabled = false,
  gitState = defaultGitState,
  fetchImpl = globalThis.fetch,
}) {
  const boundReceipt = await bindPublishedContent(projectRoot, receipt);
  await validateReceipt({ projectRoot, gate, receipt: boundReceipt, date: boundReceipt?.date, claimId: boundReceipt?.claimId, feedbackEnabled, gitState, fetchImpl });
  await gate.assertOwned({ date: boundReceipt.date, claimId: boundReceipt.claimId });
  const file = receiptPath(projectRoot, boundReceipt.date);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(boundReceipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
  return boundReceipt;
}

export async function readValidTerminalRunReceipt({
  projectRoot,
  gate,
  date,
  claimId,
  feedbackEnabled = false,
  gitState = defaultGitState,
  fetchImpl = globalThis.fetch,
}) {
  const receipt = await readJson(receiptPath(projectRoot, date), "Terminal run receipt");
  return validateReceipt({ projectRoot, gate, receipt, date, claimId, feedbackEnabled, gitState, fetchImpl });
}
