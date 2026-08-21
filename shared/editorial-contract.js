export const PRIMARY_CATEGORIES = Object.freeze([
  "AI & Automation",
  "Software & Developer Tools",
  "Web & Platforms",
  "Security & Privacy",
  "Hardware & Devices",
  "Science & Emerging Tech",
  "Consumer Technology",
  "Curiosities",
]);

export const CATEGORY_PRESENTATION = Object.freeze({
  "AI & Automation": { short: "AI", accent: "lime" },
  "Software & Developer Tools": { short: "DEV TOOL", accent: "cyan" },
  "Web & Platforms": { short: "PLATFORM", accent: "orange" },
  "Security & Privacy": { short: "SECURITY", accent: "violet" },
  "Hardware & Devices": { short: "HARDWARE", accent: "cyan" },
  "Science & Emerging Tech": { short: "SCIENCE", accent: "lime" },
  "Consumer Technology": { short: "CONSUMER", accent: "orange" },
  Curiosities: { short: "CURIOUS", accent: "violet" },
});

export const STRUCTURED_TAG_PATTERN = /^(topic|format|entity|license|depth):[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function freshnessLimitFor(item, policy) {
  return policy.freshness?.windows?.[item?.source?.evidence?.freshnessClass] ?? null;
}
