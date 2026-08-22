export const REPORT_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["stories"],
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "paragraphs"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          paragraphs: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
        },
      },
    },
  },
});

function spokenWordCount(paragraphs) {
  return paragraphs.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

function schemaError(message) {
  return Object.assign(new Error(message), { code: "report_schema", retryable: true });
}

function assertTtsFriendly(value, label, { paragraph = false } = {}) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    || /\b(?:https?:\/\/|www\.)\S+/i.test(value)
    || /(^|\n)\s{0,3}(?:#{1,6}\s|[-+*]\s|>\s)/.test(value)
    || /\[[^\]]+\]\([^\)]+\)|```|`[^`]+`|\*\*|__|~~|<\/?[a-z][^>]*>/i.test(value)
    || paragraph && /\n\s*\n/.test(value)) {
    throw schemaError(`${label} must use TTS-friendly spoken text without URLs, markup, control characters, or internal blank lines`);
  }
}

export function validateStorySummaries(stories, expectedIds) {
  if (!Array.isArray(stories) || stories.length !== expectedIds.length) throw schemaError("Report story IDs do not match the requested edition items");
  const actualIds = stories.map(({ id }) => id);
  if (actualIds.some((id, index) => id !== expectedIds[index]) || new Set(actualIds).size !== actualIds.length) {
    throw schemaError("Report story IDs do not match the requested edition items");
  }
  for (const story of stories) {
    if (typeof story.title !== "string" || !story.title.trim()) throw schemaError(`Story ${story.id} has no title`);
    assertTtsFriendly(story.title, `Story ${story.id} title`);
    if (!Array.isArray(story.paragraphs) || story.paragraphs.length < 2 || story.paragraphs.length > 4
      || story.paragraphs.some((paragraph) => typeof paragraph !== "string" || !paragraph.trim())) {
      throw schemaError(`Story ${story.id} must contain two to four paragraphs`);
    }
    for (const paragraph of story.paragraphs) assertTtsFriendly(paragraph, `Story ${story.id} paragraph`, { paragraph: true });
    const words = spokenWordCount(story.paragraphs);
    if (words < 180 || words > 350) throw schemaError(`Story ${story.id} must contain 180 to 350 words; received ${words}`);
  }
  return stories;
}
