import policy from "../config/curation-policy.json" with { type: "json" };

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
]);

const PROHIBITED_PATTERNS = [
  /\b(acquisitions?|acquires?|acquired|mergers?|buyouts?)\b/i,
  /\b(raises?|raised|raising|funding|series [a-e]|valuation)\b/i,
  /\b(election|politic(?:s|al)?|senate|congress|president)\b/i,
  /\b(ceo|executive|founder) (?:drama|scandal|resigns?|resigned|fired)\b/i,
  /\b(market speculation|stock(?:s)?|share price|market cap|investor sentiment|price target|earnings)\b/i,
];

const TITLE_STOP_WORDS = new Set(["a", "an", "and", "for", "in", "of", "the", "to", "with"]);

export function canonicalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  url.search = [...url.searchParams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`)
    .join("&");

  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function isProhibitedTopic({ title = "", summary = "", tags = [] }) {
  const haystack = [title, summary, ...tags].join(" ");
  const matched = PROHIBITED_PATTERNS.find((pattern) => pattern.test(haystack));
  return { prohibited: Boolean(matched), reason: matched?.source ?? null };
}

function calendarDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) throw new Error(`Expected YYYY-MM-DD date, received ${value}`);
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`Expected a valid calendar date, received ${value}`);
  }
  return timestamp;
}

export function isInDuplicateWindow(existingDate, editionDate, windowDays = 30) {
  const difference = (calendarDay(editionDate) - calendarDay(existingDate)) / 86_400_000;
  return difference >= 0 && difference <= windowDays;
}

function normalizedTitleTokens(value = "") {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word && !TITLE_STOP_WORDS.has(word)),
  );
}

function titleSimilarity(left, right) {
  const leftTokens = normalizedTitleTokens(left);
  const rightTokens = normalizedTitleTokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / union.size;
}

function hasValidSubstantiveUpdate(candidate, matches) {
  const update = candidate.substantiveUpdate;
  return isNonEmptyString(update?.reason)
    && policy.substantiveUpdateKinds.includes(update?.kind)
    && isNonEmptyString(update?.previousItemId)
    && matches.some(({ item }) => item.id === update.previousItemId);
}

export function findDuplicates(candidate, existingItems, editionDate, options = {}) {
  const threshold = options.titleSimilarityThreshold ?? 0.8;
  const candidateUrl = candidate.source?.url ? canonicalizeUrl(candidate.source.url) : null;
  const matches = [];

  for (const existing of existingItems) {
    if (!isInDuplicateWindow(existing.editionDate ?? existing.publicationDate, editionDate, options.windowDays ?? 30)) continue;
    const reasons = [];
    const existingUrl = existing.source?.url ? canonicalizeUrl(existing.source.url) : null;
    if (candidateUrl && existingUrl && candidateUrl === existingUrl) reasons.push("canonical-url");
    if (candidate.entityKey && candidate.entityKey === existing.entityKey) reasons.push("entity-key");
    if (candidate.eventKey && candidate.eventKey === existing.eventKey) reasons.push("event-key");
    if (titleSimilarity(candidate.title, existing.title) >= threshold) reasons.push("title-similarity");
    if (reasons.length) matches.push({ item: existing, reasons });
  }

  if (!hasValidSubstantiveUpdate(candidate, matches)) return matches;
  return matches.filter(({ item }) => item.id !== candidate.substantiveUpdate.previousItemId);
}

const REQUIRED_ITEM_FIELDS = [
  "id",
  "title",
  "summary",
  "category",
  "publicationDate",
  "entityKey",
  "eventKey",
  "signal",
];

const REQUIRED_SIGNAL_FIELDS = ["whyNow"];
const ALLOWED_CATEGORIES = new Set(["Models", "Tools", "Workflows", "Demos", "Utilities"]);
const ALLOWED_TIME_TO_TRY = new Set(["≤ 2 min", "2–5 min", "5–15 min", "15m+"]);
const EDITORIAL_TIERS = new Set(policy.editorialTiers);
const FULL_ISO_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isFullIsoTimestamp(value) {
  const match = typeof value === "string" ? value.match(FULL_ISO_TIMESTAMP) : null;
  return Boolean(match && isValidCalendarDate(match[1]) && Number.isFinite(Date.parse(value)));
}

export function validateEdition(edition, { allowLegacy = false } = {}) {
  if (edition?.schemaVersion === 1) {
    return allowLegacy
      ? validateLegacyEdition(edition)
      : ["Edition schema version 1 requires allowLegacy: true."];
  }

  const errors = [];
  const items = edition?.items;
  if (!isNonEmptyString(edition?.date)) errors.push("edition.date is required.");
  else if (!isValidCalendarDate(edition.date)) errors.push("edition.date must be a valid calendar date.");
  if (!isNonEmptyString(edition?.title)) errors.push("edition.title is required.");
  if (!isNonEmptyString(edition?.timezone)) errors.push("edition.timezone is required.");
  if (!isFullIsoTimestamp(edition?.curatedAt)) {
    errors.push("edition.curatedAt must be a full ISO timestamp with a timezone.");
  }
  if (!isNonEmptyString(edition?.summary)) errors.push("edition.summary is required.");
  if (edition?.schemaVersion !== policy.edition.currentSchemaVersion) {
    errors.push(`edition.schemaVersion must be ${policy.edition.currentSchemaVersion}.`);
  }
  if (!Array.isArray(items) || items.length < policy.edition.minItems || items.length > policy.edition.maxItems) {
    errors.push(`Edition must contain between ${policy.edition.minItems} and ${policy.edition.maxItems} items.`);
  }

  const itemIds = new Set();
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const label = `Item ${index + 1}`;
    for (const field of REQUIRED_ITEM_FIELDS) {
      if (!item?.[field]) errors.push(`${label} is missing ${field}.`);
    }
    if (!isNonEmptyString(item?.id)) {
      errors.push(`${label} item id must be a non-empty string.`);
    } else {
      if (itemIds.has(item.id)) errors.push(`${label} must have a unique item id.`);
      itemIds.add(item.id);
    }
    if (!ALLOWED_CATEGORIES.has(item?.category)) errors.push(`${label} has an invalid category.`);
    if (!EDITORIAL_TIERS.has(item?.editorialTier)) errors.push(`${label} has an invalid editorialTier.`);
    if (!isNonEmptyString(item?.rankingRationale)) errors.push(`${label} is missing rankingRationale.`);
    if (hasOwnProperty(item, "timeToTry")) errors.push(`${label} must not include retired timeToTry.`);
    for (const field of ["impact", "confidence", "novelty"]) {
      if (hasOwnProperty(item?.signal, field)) errors.push(`${label} must not include retired signal.${field}.`);
    }
    if (item?.publicationDate && !isValidCalendarDate(item.publicationDate)) {
      errors.push(`${label} publicationDate must be a valid calendar date.`);
    }
    for (const field of REQUIRED_SIGNAL_FIELDS) {
      if (!isNonEmptyString(item?.signal?.[field])) {
        errors.push(`${label} is missing signal.${field}.`);
      }
    }
    if (item?.caveat !== undefined && !isNonEmptyString(item.caveat)) errors.push(`${label} caveat must be a non-empty string.`);
    validatePrimarySource(item, label, errors);
    if (item?.experiment !== undefined && !isNonEmptyString(item.experiment?.goal)) {
      errors.push(`${label} is missing experiment.goal.`);
    }
    if (item?.experiment !== undefined && (
      !Array.isArray(item.experiment?.steps)
      || item.experiment.steps.length < 1
      || item.experiment.steps.length > 3
      || item.experiment.steps.some((step) => !isNonEmptyString(step))
    )) {
      errors.push(`${label} experiment must have one to three non-empty experiment steps.`);
    }
    if (isProhibitedTopic(item ?? {}).prohibited) errors.push(`${label} covers a prohibited topic.`);
  }
  return errors;
}

function validatePrimarySource(item, label, errors) {
  if (!item?.source?.url || item.source.kind !== "primary" || item.source.verification?.status !== "verified") {
    errors.push(`${label} needs a verified primary source.`);
    return;
  }
  if (!isNonEmptyString(item.source.publisher)) errors.push(`${label} is missing source.publisher.`);
  if (!isNonEmptyString(item.source.title)) errors.push(`${label} is missing source.title.`);
  if (!isNonEmptyString(item.source.verification.method)) errors.push(`${label} is missing source.verification.method.`);
  if (!isNonEmptyString(item.source.verification.verifiedAt)) errors.push(`${label} is missing source.verification.verifiedAt.`);
  if (item.source.verification.verifiedAt && !isValidCalendarDate(item.source.verification.verifiedAt)) {
    errors.push(`${label} source.verification.verifiedAt must be a valid calendar date.`);
  }
  try {
    canonicalizeUrl(item.source.url);
  } catch {
    errors.push(`${label} has an invalid source URL.`);
  }
}

function validateLegacyEdition(edition) {
  const errors = [];
  const items = edition?.items;
  if (!isNonEmptyString(edition?.date)) errors.push("edition.date is required.");
  else if (!isValidCalendarDate(edition.date)) errors.push("edition.date must be a valid calendar date.");
  if (!isNonEmptyString(edition?.title)) errors.push("edition.title is required.");
  if (!isNonEmptyString(edition?.timezone)) errors.push("edition.timezone is required.");
  if (!isFullIsoTimestamp(edition?.curatedAt)) errors.push("edition.curatedAt must be a full ISO timestamp with a timezone.");
  if (!isNonEmptyString(edition?.summary)) errors.push("edition.summary is required.");
  if (!Array.isArray(items) || items.length < 10 || items.length > 15) errors.push("Edition must contain between 10 and 15 items.");

  const categories = new Map();
  const itemIds = new Set();
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const label = `Item ${index + 1}`;
    for (const field of REQUIRED_ITEM_FIELDS) {
      if (!item?.[field]) errors.push(`${label} is missing ${field}.`);
    }
    if (!isNonEmptyString(item?.id)) {
      errors.push(`${label} item id must be a non-empty string.`);
    } else {
      if (itemIds.has(item.id)) errors.push(`${label} must have a unique item id.`);
      itemIds.add(item.id);
    }
    if (!ALLOWED_CATEGORIES.has(item?.category)) errors.push(`${label} has an invalid category.`);
    if (!ALLOWED_TIME_TO_TRY.has(item?.timeToTry)) errors.push(`${label} has an invalid timeToTry.`);
    if (item?.publicationDate && !isValidCalendarDate(item.publicationDate)) errors.push(`${label} publicationDate must be a valid calendar date.`);
    for (const field of ["impact", "confidence", "novelty", "whyNow"]) {
      if (item?.signal?.[field] === undefined || item.signal[field] === null || item.signal[field] === "") errors.push(`${label} is missing signal.${field}.`);
    }
    for (const field of ["impact", "confidence", "novelty"]) {
      const value = item?.signal?.[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10) errors.push(`${label} signal.${field} must be a number from 0 to 10.`);
    }
    if (!isNonEmptyString(item?.caveat)) errors.push(`${label} is missing caveat.`);
    validatePrimarySource(item, label, errors);
    if (!isNonEmptyString(item?.experiment?.goal)) errors.push(`${label} is missing experiment.goal.`);
    if (!Array.isArray(item?.experiment?.steps) || item.experiment.steps.length !== 3 || item.experiment.steps.some((step) => !isNonEmptyString(step))) errors.push(`${label} must have exactly three experiment steps.`);
    if (isProhibitedTopic(item ?? {}).prohibited) errors.push(`${label} covers a prohibited topic.`);
    categories.set(item?.category, (categories.get(item?.category) ?? 0) + 1);
  }

  if (categories.size < 3) errors.push("Edition must cover at least three categories.");
  const maximum = (Array.isArray(items) ? items.length : 0) * 0.4;
  for (const [category, count] of categories) {
    if (count > maximum && !isNonEmptyString(edition.categoryOverrideReason)) errors.push(`Category ${category} exceeds the 40% limit without an override reason.`);
  }
  return errors;
}

function isValidCalendarDate(value) {
  try {
    calendarDay(value);
    return true;
  } catch {
    return false;
  }
}

function hasOwnProperty(value, property) {
  return value !== null && typeof value === "object" && Object.hasOwn(value, property);
}
