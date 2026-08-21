const DECORATIVE_HEADLINE_VERBS = /\b(?:lands|enters|unveils|drops|arrives)\b/i;

const AI_DEFAULT_PATTERNS = [
  /\b(?:evolving|fast-paced) landscape\b/i,
  /\b(?:groundbreaking|game-changing|pivotal|seamless|transformative)\b/i,
  /\bunlock(?:s|ed|ing)?\b/i,
  /\b(?:stands|serves) as\b/i,
  /\b(?:delve|showcase|underscore|leverage)(?:s|d|ing)?\b/i,
  /\bnot (?:just|only)\b[^.!?]*\bbut (?:also )?\b/i,
  /\b(?:it is important to note|here's the thing|let's dive|let's unpack)\b/i,
];

const NON_FACTUAL_CAPITALIZED_WORDS = new Set(["A", "An", "The", "This", "It"]);

function wordCount(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function normalized(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:added|adds|adding)\b/g, "add")
    .replace(/\b(?:released|releases|releasing)\b/g, "release")
    .trim();
}

function unsupportedFactualAnchors(copy) {
  const output = `${copy?.title ?? ""} ${copy?.summary ?? ""}`;
  const evidence = (copy?.evidenceFacts ?? []).join(" ").toLowerCase();
  const anchors = output.match(/\b(?:\d[\w.,:/-]*|[A-Z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*)\b/g) ?? [];
  return [...new Set(anchors)].filter((anchor) => {
    if (NON_FACTUAL_CAPITALIZED_WORDS.has(anchor)) return false;
    return !evidence.includes(anchor.toLowerCase());
  });
}

export function validateCopyStyle(copy, limits) {
  const errors = [];
  const title = copy?.title ?? "";
  const summary = copy?.summary ?? "";
  if (title.length > limits.titleMaxCharacters) errors.push(`title exceeds ${limits.titleMaxCharacters} characters.`);
  if (wordCount(summary) > limits.summaryMaxWords) errors.push(`summary exceeds ${limits.summaryMaxWords} words.`);
  if (DECORATIVE_HEADLINE_VERBS.test(title)) errors.push("title uses a decorative headline verb.");
  if (AI_DEFAULT_PATTERNS.some((pattern) => pattern.test(`${title} ${summary}`))) errors.push("copy contains an AI-default phrase.");
  const normalizedTitle = normalized(title);
  const normalizedSummary = normalized(summary);
  if (normalizedTitle && (normalizedSummary === normalizedTitle || normalizedSummary.startsWith(`${normalizedTitle} `))) {
    errors.push("summary repeats the title instead of adding information.");
  }
  if (/[—“”]/u.test(`${title}${summary}`)) errors.push("copy uses disallowed AI-default punctuation.");
  const unsupported = unsupportedFactualAnchors(copy);
  if (unsupported.length) errors.push(`copy introduces unsupported factual anchors: ${unsupported.join(", ")}.`);
  return errors;
}
