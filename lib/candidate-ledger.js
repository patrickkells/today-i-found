import { canonicalizeUrl } from "./curation.js";
import policy from "../config/curation-policy.json" with { type: "json" };

export const REJECTION_REASONS = Object.freeze([
  "stale",
  "duplicate",
  "prohibited-topic",
  "business-no-practical-consequence",
  "routine-change",
  "inactive",
  "unavailable",
  "unverifiable",
  "low-substance",
  "copycat",
  "superseded",
  "clustered",
  "not-selected",
]);

function stableClusterId(discovery) {
  try { return `url:${canonicalizeUrl(discovery.canonicalUrl ?? discovery.url)}`; }
  catch { return `discovery:${discovery.discoveryId}`; }
}

export function createCandidateLedger({ editionDate, discoveries = [], failures = [] }) {
  const primaryByCluster = new Map();
  const candidates = discoveries.map((discovery) => {
    const clusterId = discovery.clusterId ?? stableClusterId(discovery);
    const primary = primaryByCluster.get(clusterId);
    if (!primary) primaryByCluster.set(clusterId, discovery.discoveryId);
    const freshnessLimit = policy.freshness.windows[discovery.freshnessClass];
    const stale = Number.isFinite(discovery.ageDays) && Number.isInteger(freshnessLimit) && discovery.ageDays > freshnessLimit;
    return {
      ...structuredClone(discovery),
      clusterId,
      decision: primary
        ? { status: "rejected", reason: "clustered", rationale: `Clustered with ${primary}.` }
        : stale
          ? { status: "rejected", reason: "stale", rationale: `Published ${discovery.ageDays} days before the edition; the ${discovery.freshnessClass} window is ${freshnessLimit} days.` }
          : { status: "pending" },
    };
  });
  return {
    schemaVersion: 1,
    editionDate,
    createdAt: new Date().toISOString(),
    failures: structuredClone(failures),
    candidates,
  };
}

export function setCandidateDecision(ledger, discoveryId, decision) {
  return {
    ...ledger,
    candidates: (ledger.candidates ?? []).map((candidate) => candidate.discoveryId === discoveryId
      ? { ...candidate, decision: structuredClone(decision) }
      : candidate),
  };
}

export function summarizeCandidateLedger(ledger) {
  const candidates = ledger?.candidates ?? [];
  const eligible = candidates.filter((candidate) => candidate.decision?.status === "eligible");
  return {
    rawCandidates: candidates.length,
    clusteredCandidates: new Set(candidates.map((candidate) => candidate.clusterId)).size,
    eligibleCandidates: new Set(eligible.map((candidate) => candidate.decision.itemId)).size,
    rejectedCandidates: candidates.filter((candidate) => candidate.decision?.status === "rejected" && candidate.decision.reason !== "clustered").length,
    pendingCandidates: candidates.filter((candidate) => candidate.decision?.status === "pending").length,
    trendingReviewed: candidates.filter((candidate) => candidate.origin?.kind === "github-trending").length,
    feedFailures: (ledger?.failures ?? []).length,
  };
}

export function publicDiscoveryStats(ledger, { publishedItems, explorationItems }) {
  const summary = summarizeCandidateLedger(ledger);
  return {
    rawCandidates: summary.rawCandidates,
    clusteredCandidates: summary.clusteredCandidates,
    eligibleCandidates: summary.eligibleCandidates,
    publishedItems,
    trendingReviewed: summary.trendingReviewed,
    explorationItems,
  };
}

export function validateCandidateLedger(ledger, candidateEdition) {
  const errors = [];
  if (ledger?.schemaVersion !== 1) errors.push("Candidate ledger schemaVersion must be 1.");
  if (typeof ledger?.editionDate !== "string") errors.push("Candidate ledger editionDate is required.");
  if (!Array.isArray(ledger?.candidates)) return [...errors, "Candidate ledger candidates must be an array."];
  const ids = new Set();
  const eligibleItemIds = new Set();
  for (const candidate of ledger.candidates) {
    if (!candidate?.discoveryId || ids.has(candidate.discoveryId)) errors.push("Candidate discovery IDs must be non-empty and unique.");
    ids.add(candidate?.discoveryId);
    if (!candidate?.clusterId) errors.push(`${candidate?.discoveryId ?? "candidate"} is missing clusterId.`);
    const decision = candidate?.decision;
    if (!decision || decision.status === "pending") errors.push(`${candidate.discoveryId} still has a pending decision.`);
    else if (decision.status === "eligible") {
      if (!decision.itemId || !decision.rationale?.trim()) errors.push(`${candidate.discoveryId} eligible decision needs itemId and rationale.`);
      else if (eligibleItemIds.has(decision.itemId)) errors.push(`Eligible item ID ${decision.itemId} is duplicated in the ledger.`);
      else eligibleItemIds.add(decision.itemId);
      const copy = candidate.copy;
      if (!copy?.promptVersion?.trim()
        || !Array.isArray(copy.evidenceFacts)
        || !copy.evidenceFacts.length
        || copy.evidenceFacts.some((fact) => typeof fact !== "string" || !fact.trim())
        || !copy.title?.trim()
        || !copy.summary?.trim()) {
        errors.push(`${candidate.discoveryId} eligible decision needs copy.promptVersion, evidenceFacts, title, and summary.`);
      }
    } else if (decision.status === "rejected") {
      if (!REJECTION_REASONS.includes(decision.reason) || !decision.rationale?.trim()) {
        errors.push(`${candidate.discoveryId} rejected decision needs an allowed reason and rationale.`);
      }
    } else errors.push(`${candidate.discoveryId} has an invalid decision status.`);
  }

  if (candidateEdition) {
    if (candidateEdition.date !== ledger.editionDate) errors.push("Candidate edition date must match the ledger editionDate.");
    const editionItemIds = new Set((candidateEdition.items ?? []).map((item) => item.id));
    const editionItems = new Map((candidateEdition.items ?? []).map((item) => [item.id, item]));
    for (const itemId of eligibleItemIds) if (!editionItemIds.has(itemId)) errors.push(`Eligible ledger item ${itemId} is absent from the candidate edition.`);
    for (const itemId of editionItemIds) if (!eligibleItemIds.has(itemId)) errors.push(`Candidate edition item ${itemId} lacks an eligible ledger decision.`);
    for (const candidate of ledger.candidates) {
      if (candidate.decision?.status !== "eligible") continue;
      const item = editionItems.get(candidate.decision.itemId);
      if (item && (candidate.copy?.title !== item.title || candidate.copy?.summary !== item.summary)) {
        errors.push(`Candidate copy for ${candidate.decision.itemId} must match the candidate edition title and summary.`);
      }
    }
  }
  return errors;
}
