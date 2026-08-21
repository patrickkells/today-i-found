const BLOCK_END = /<\/(?:address|article|aside|blockquote|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)>/gi;
const BLOCK_START = /<(?:br|hr)\s*\/?>/gi;

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1].toLowerCase() === "x";
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function cssHiddenSelectors(html) {
  const classes = new Set();
  const ids = new Set();
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    for (const rule of style[1].matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
      const declarations = rule[2];
      const hidden = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*!important)?\s*(?:;|$)|font-size\s*:\s*0(?:px|em|rem|%)?(?:\s*!important)?\s*(?:;|$)|clip(?:-path)?\s*:\s*(?:rect\s*\(\s*0|inset\s*\(\s*(?:50|100)%)/i.test(declarations)
        || /position\s*:\s*(?:absolute|fixed)/i.test(declarations) && /(?:left|top|text-indent)\s*:\s*-\d{3,}/i.test(declarations);
      if (!hidden) continue;
      for (const selector of rule[1].split(",")) {
        const matches = [...selector.matchAll(/([.#])([a-z0-9_-]+)/gi)];
        const terminal = matches.at(-1);
        if (terminal?.[1] === ".") classes.add(terminal[2]);
        if (terminal?.[1] === "#") ids.add(terminal[2]);
      }
    }
  }
  return { classes, ids };
}

function removeSelectorHiddenElements(html, selectors) {
  let value = html;
  for (const name of selectors.classes) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*\\bclass\\s*=\\s*(?:"(?:[^"]*\\s)?${escaped}(?:\\s[^"]*)?"|'(?:[^']*\\s)?${escaped}(?:\\s[^']*)?'))[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi");
    value = value.replace(pattern, " ");
  }
  for (const name of selectors.ids) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*\\bid\\s*=\\s*(?:"${escaped}"|'${escaped}'|${escaped}(?:\\s|>)))[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi");
    value = value.replace(pattern, " ");
  }
  return value;
}

export function htmlToPlainText(html, { maxCharacters = 200_000 } = {}) {
  let value = String(html ?? "").slice(0, maxCharacters * 4);
  const hiddenSelectors = cssHiddenSelectors(value);
  value = value.replace(/<!--[\s\S]*?-->/g, " ");
  value = value.replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  value = removeSelectorHiddenElements(value, hiddenSelectors);
  value = value.replace(/<([a-z][\w:-]*)\b[^>]*(?:\shidden(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?|\saria-hidden\s*=\s*(?:"true"|'true'|true)|\sstyle\s*=\s*(?:"[^"]*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*!important)?\s*(?:;|$)|font-size\s*:\s*0(?:px|em|rem|%)?(?:\s*!important)?\s*(?:;|$)|(?:left|top|text-indent)\s*:\s*-\d{3,})[^"]*"|'[^']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*!important)?\s*(?:;|$)|font-size\s*:\s*0(?:px|em|rem|%)?(?:\s*!important)?\s*(?:;|$)|(?:left|top|text-indent)\s*:\s*-\d{3,})[^']*'))[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  value = value.replace(BLOCK_END, "\n\n").replace(BLOCK_START, "\n\n");
  value = decodeEntities(value.replace(/<[^>]+>/g, " "));
  return value
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxCharacters);
}
