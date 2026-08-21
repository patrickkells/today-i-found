import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateEdition } from "../lib/curation.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,199}$/i;

export async function loadTrustedSelection({ editionsDir, body }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("Request body must be an object"), { statusCode: 400 });
  const keys = Object.keys(body).sort();
  if (keys.length !== 2 || keys[0] !== "date" || keys[1] !== "itemIds") {
    throw Object.assign(new Error("Request may contain only date and itemIds"), { statusCode: 400 });
  }
  if (!DATE_PATTERN.test(body.date)) throw Object.assign(new Error("Edition date is invalid"), { statusCode: 400 });
  if (!Array.isArray(body.itemIds) || body.itemIds.length < 1 || body.itemIds.length > 40
    || body.itemIds.some((id) => typeof id !== "string" || !ID_PATTERN.test(id))
    || new Set(body.itemIds).size !== body.itemIds.length) {
    throw Object.assign(new Error("itemIds must contain one to forty unique published IDs"), { statusCode: 400 });
  }
  let edition;
  try {
    edition = JSON.parse(await readFile(path.join(editionsDir, `${body.date}.json`), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw Object.assign(new Error("Edition was not found"), { statusCode: 404 });
    throw Object.assign(new Error("Edition JSON is unreadable"), { statusCode: 500, cause: error });
  }
  if (edition.date !== body.date) throw Object.assign(new Error("Edition date does not match its filename"), { statusCode: 500 });
  const errors = validateEdition(edition);
  if (errors.length) throw Object.assign(new Error(`Edition validation failed: ${errors.join(" ")}`), { statusCode: 500 });
  const byId = new Map(edition.items.map((item) => [item.id, item]));
  const items = body.itemIds.map((id) => byId.get(id));
  if (items.some((item) => !item)) throw Object.assign(new Error("Request contains an unknown item ID"), { statusCode: 400 });
  if (items.some((item) => {
    try { return new URL(item.source.url).protocol !== "https:"; } catch { return true; }
  })) throw Object.assign(new Error("Published source URL is not a valid HTTPS URL"), { statusCode: 500 });
  return { edition, items };
}
