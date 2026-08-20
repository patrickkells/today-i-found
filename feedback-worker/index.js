const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const RATE_LIMIT = 60;
const RATE_RETENTION_MS = 48 * HOUR_MS;
const MIN_HMAC_SECRET_LENGTH = 32;
const DEFAULT_SUMMARY_DAYS = 90;
const DECAY_HALF_LIFE_DAYS = 30;
const PRIOR_UP = 2;
const PRIOR_DOWN = 2;
const PREFERENCE_ELIGIBILITY_THRESHOLD = 10;

const SQL = {
  editionByDate: `/* edition.byDate */
    SELECT date, title, summary, curated_at AS curatedAt, timezone
    FROM editions WHERE date = ?`,
  editionUpsert: `/* edition.upsert */
    INSERT INTO editions (date, title, summary, curated_at, timezone)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      curated_at = excluded.curated_at,
      timezone = excluded.timezone`,
  itemUpsert: `/* item.upsert */
    INSERT INTO items (
      id, edition_date, title, category, source, tags_json, publication_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      edition_date = excluded.edition_date,
      title = excluded.title,
      category = excluded.category,
      source = excluded.source,
      tags_json = excluded.tags_json,
      publication_date = excluded.publication_date`,
  itemDeleteMissing(retainedCount) {
    const placeholders = Array.from({ length: retainedCount }, () => "?").join(", ");
    return `/* item.deleteMissing */
      DELETE FROM items
      WHERE edition_date = ? AND id NOT IN (${placeholders})`;
  },
  itemById: `/* item.byId */
    SELECT id, edition_date AS editionDate
    FROM items WHERE id = ?`,
  itemsVotesByEdition: `/* items.votesByEdition */
    SELECT
      i.id AS item_id,
      SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END) AS up,
      SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END) AS down,
      MAX(CASE WHEN v.visitor_hash = ? THEN v.value ELSE NULL END) AS my_vote
    FROM items i
    LEFT JOIN votes v ON v.item_id = i.id
    WHERE i.edition_date = ?
    GROUP BY i.id
    ORDER BY i.rowid`,
  rateBump: `/* rate.bump */
    INSERT INTO rate_limits (ip_hash, bucket_start, count)
    VALUES (?, ?, 1)
    ON CONFLICT(ip_hash, bucket_start) DO UPDATE SET count = count + 1
    RETURNING count`,
  ratePrune: `/* rate.prune */
    DELETE FROM rate_limits WHERE bucket_start < ?`,
  voteUpsert: `/* vote.upsert */
    INSERT INTO votes (item_id, visitor_hash, value, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(item_id, visitor_hash) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at`,
  voteDelete: `/* vote.delete */
    DELETE FROM votes WHERE item_id = ? AND visitor_hash = ?`,
  voteAggregate: `/* vote.aggregate */
    SELECT
      i.id AS item_id,
      SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END) AS up,
      SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END) AS down,
      MAX(CASE WHEN v.visitor_hash = ? THEN v.value ELSE NULL END) AS my_vote
    FROM items i
    LEFT JOIN votes v ON v.item_id = i.id
    WHERE i.id = ?
    GROUP BY i.id`,
  summaryRows: `/* summary.rows */
    SELECT
      v.value,
      v.updated_at,
      i.category,
      i.source,
      i.tags_json
    FROM votes v
    INNER JOIN items i ON i.id = v.item_id
    WHERE v.updated_at >= ?`,
};

export function createFeedbackWorker({ now = () => Date.now(), cryptoImpl = globalThis.crypto } = {}) {
  return {
    async fetch(request, env) {
      const origin = request.headers.get("origin");
      if (origin && !isAllowedOrigin(origin, env.ALLOWED_ORIGIN)) {
        return jsonError(403, "origin_not_allowed", "This origin is not allowed.");
      }

      const corsHeaders = cors(origin);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (!isSecureHmacSecret(env.HMAC_SECRET)) {
        return withHeaders(jsonError(
          500,
          "service_misconfigured",
          "The feedback service is not configured securely.",
        ), corsHeaders);
      }

      try {
        const url = new URL(request.url);
        const editionMatch = url.pathname.match(/^\/v1\/editions\/([^/]+)\/votes$/);
        const voteMatch = url.pathname.match(/^\/v1\/items\/([^/]+)\/vote$/);

        let response;
        if (request.method === "GET" && editionMatch) {
          response = await getEditionVotes(env, decodeURIComponent(editionMatch[1]), url.searchParams);
        } else if (request.method === "PUT" && voteMatch) {
          response = await putVote(request, env, decodeURIComponent(voteMatch[1]), now(), cryptoImpl);
        } else if (request.method === "POST" && url.pathname === "/v1/editions") {
          response = await registerEdition(request, env);
        } else if (request.method === "GET" && url.pathname === "/v1/feedback/summary") {
          response = await getSummary(request, env, url.searchParams, now());
        } else {
          response = jsonError(404, "route_not_found", "The requested route was not found.");
        }
        return withHeaders(response, corsHeaders);
      } catch (error) {
        if (error instanceof SyntaxError) {
          return withHeaders(jsonError(400, "invalid_json", "The request body must be valid JSON."), corsHeaders);
        }
        return withHeaders(jsonError(500, "internal_error", "The feedback service could not complete the request."), corsHeaders);
      }
    },
  };
}

async function getEditionVotes(env, date, searchParams) {
  const visitorId = validIdentifier(searchParams.get("visitorId"));
  if (!visitorId) return jsonError(400, "invalid_visitor", "A visitorId is required.");

  const edition = await env.DB.prepare(SQL.editionByDate).bind(date).first();
  if (!edition) return jsonError(404, "edition_not_found", "The requested edition is not registered.");

  const visitorHash = await hmac(env.HMAC_SECRET, `visitor:${visitorId}`);
  const query = await env.DB.prepare(SQL.itemsVotesByEdition).bind(visitorHash, date).all();
  return jsonResponse({
    date,
    items: (query.results ?? []).map(canonicalRecord),
  });
}

async function putVote(request, env, itemId, timestamp, cryptoImpl) {
  const body = await request.json();
  const visitorId = validIdentifier(body?.visitorId);
  if (!visitorId) return jsonError(400, "invalid_visitor", "A visitorId is required.");

  const voteValue = normalizeVote(body?.value);
  if (voteValue === undefined) {
    return jsonError(400, "invalid_vote", "Vote value must be up, down, null, -1, 0, or 1.");
  }

  const item = await env.DB.prepare(SQL.itemById).bind(itemId).first();
  if (!item) return jsonError(404, "item_not_found", "The requested item is not registered.");

  const rawIp = request.headers.get("cf-connecting-ip") ?? "unavailable";
  const [visitorHash, ipHash] = await Promise.all([
    hmac(env.HMAC_SECRET, `visitor:${visitorId}`, cryptoImpl),
    hmac(env.HMAC_SECRET, `ip:${rawIp}`, cryptoImpl),
  ]);
  await env.DB.prepare(SQL.ratePrune).bind(timestamp - RATE_RETENTION_MS).run();

  // This is an atomic fixed wall-clock window. The reset is the next UTC hour boundary.
  const bucketStart = Math.floor(timestamp / HOUR_MS) * HOUR_MS;
  const rate = await env.DB.prepare(SQL.rateBump).bind(ipHash, bucketStart).first();
  if ((rate?.count ?? RATE_LIMIT + 1) > RATE_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((bucketStart + HOUR_MS - timestamp) / 1000));
    return jsonError(429, "rate_limited", "Too many vote changes. Try again in the next hour.", {
      "retry-after": String(retryAfter),
    });
  }

  if (voteValue === 0) {
    await env.DB.prepare(SQL.voteDelete).bind(itemId, visitorHash).run();
  } else {
    await env.DB.prepare(SQL.voteUpsert)
      .bind(itemId, visitorHash, voteValue, timestamp, timestamp)
      .run();
  }

  const aggregate = await env.DB.prepare(SQL.voteAggregate).bind(visitorHash, itemId).first();
  return jsonResponse(canonicalRecord(aggregate));
}

async function registerEdition(request, env) {
  if (!isAuthorized(request, env.CURATOR_TOKEN)) return unauthorized();
  const payload = await request.json();
  const validationError = validateEdition(payload);
  if (validationError) return jsonError(400, "invalid_edition", validationError);

  const existing = await env.DB.prepare(SQL.editionByDate).bind(payload.date).first();
  const statements = [
    env.DB.prepare(SQL.editionUpsert).bind(
      payload.date,
      payload.title,
      payload.summary ?? "",
      payload.curatedAt,
      payload.timezone,
    ),
    ...payload.items.map((item) => env.DB.prepare(SQL.itemUpsert).bind(
      item.id,
      payload.date,
      item.title,
      item.category,
      item.source.publisher,
      JSON.stringify(item.tags ?? []),
      item.publicationDate,
    )),
    env.DB.prepare(SQL.itemDeleteMissing(payload.items.length)).bind(
      payload.date,
      ...payload.items.map((item) => item.id),
    ),
  ];
  await env.DB.batch(statements);

  const created = !existing;
  return jsonResponse({ date: payload.date, itemCount: payload.items.length, created }, created ? 201 : 200);
}

async function getSummary(request, env, searchParams, timestamp) {
  if (!isAuthorized(request, env.CURATOR_TOKEN)) return unauthorized();
  const days = parseDays(searchParams.get("days"));
  if (days === null) return jsonError(400, "invalid_days", "days must be an integer from 1 through 365.");

  const since = timestamp - days * DAY_MS;
  const query = await env.DB.prepare(SQL.summaryRows).bind(since).all();
  const groups = { category: new Map(), source: new Map(), tag: new Map() };

  for (const row of query.results ?? []) {
    const ageDays = Math.max(0, (timestamp - row.updated_at) / DAY_MS);
    const weight = 0.5 ** (ageDays / DECAY_HALF_LIFE_DAYS);
    addPreference(groups.category, row.category, row.value, weight);
    addPreference(groups.source, row.source, row.value, weight);
    for (const tag of safeTags(row.tags_json)) addPreference(groups.tag, tag, row.value, weight);
  }

  return jsonResponse({
    days,
    generatedAt: new Date(timestamp).toISOString(),
    model: {
      decayHalfLifeDays: DECAY_HALF_LIFE_DAYS,
      prior: { up: PRIOR_UP, down: PRIOR_DOWN },
      adjustmentRange: [-0.5, 0.5],
    },
    preferences: {
      category: summarize(groups.category),
      source: summarize(groups.source),
      tag: summarize(groups.tag),
    },
  });
}

function addPreference(group, value, vote, weight) {
  if (!value) return;
  const current = group.get(value) ?? { value, up: 0, down: 0 };
  if (vote === 1) current.up += weight;
  if (vote === -1) current.down += weight;
  group.set(value, current);
}

function summarize(group) {
  return [...group.values()]
    .map(({ value, up, down }) => {
      const preference = (up + PRIOR_UP) / (up + down + PRIOR_UP + PRIOR_DOWN);
      const effectiveVotes = rounded(up + down);
      return {
        value,
        up: rounded(up),
        down: rounded(down),
        effectiveVotes,
        eligible: effectiveVotes >= PREFERENCE_ELIGIBILITY_THRESHOLD,
        preference: rounded(preference),
        adjustment: rounded(clamp((preference - 0.5) * 2, -0.5, 0.5)),
      };
    })
    .sort((left, right) => right.adjustment - left.adjustment || left.value.localeCompare(right.value));
}

function canonicalRecord(row) {
  const numericVote = row?.my_vote == null ? null : Number(row.my_vote);
  return {
    itemId: row.item_id,
    up: Number(row.up ?? 0),
    down: Number(row.down ?? 0),
    myVote: numericVote === 1 ? "up" : numericVote === -1 ? "down" : null,
  };
}

function normalizeVote(value) {
  if (value === "up" || value === 1) return 1;
  if (value === "down" || value === -1) return -1;
  if (value === null || value === 0) return 0;
  return undefined;
}

function validateEdition(payload) {
  if (!payload || typeof payload !== "object") return "The edition must be a JSON object.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date ?? "")) return "date must use YYYY-MM-DD.";
  if (!validText(payload.title)) return "title is required.";
  if (!validText(payload.curatedAt) || !Number.isFinite(Date.parse(payload.curatedAt))) return "curatedAt must be a timestamp.";
  if (!validText(payload.timezone)) return "timezone is required.";
  if (!Array.isArray(payload.items) || payload.items.length === 0) return "items must be a non-empty array.";

  const ids = new Set();
  for (const item of payload.items) {
    if (!validIdentifier(item?.id)) return "Every item requires a valid id.";
    if (ids.has(item.id)) return "Item IDs must be unique within an edition.";
    ids.add(item.id);
    if (!validText(item.title) || !validText(item.category)) return "Every item requires title and category.";
    if (!validText(item.source?.publisher)) return "Every item requires source.publisher.";
  }
  return null;
}

async function hmac(secret, value, cryptoImpl = globalThis.crypto) {
  if (!isSecureHmacSecret(secret)) throw new Error("HMAC_SECRET must contain at least 32 characters");
  const encoder = new TextEncoder();
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoImpl.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeTags(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(validText) : [];
  } catch {
    return [];
  }
}

function parseDays(value) {
  if (value === null || value === "") return DEFAULT_SUMMARY_DAYS;
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : null;
}

function validIdentifier(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256 ? value : null;
}

function validText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSecureHmacSecret(value) {
  return typeof value === "string" && value.trim().length >= MIN_HMAC_SECRET_LENGTH;
}

function isAuthorized(request, token) {
  return validText(token) && request.headers.get("authorization") === `Bearer ${token}`;
}

function unauthorized() {
  return jsonError(401, "unauthorized", "A valid curator token is required.", {
    "www-authenticate": "Bearer",
  });
}

function isAllowedOrigin(origin, configuredOrigin) {
  if (origin === configuredOrigin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function cors(origin) {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function jsonError(status, code, message, headers = {}) {
  return jsonResponse({ error: { code, message } }, status, headers);
}

function withHeaders(response, headers) {
  const next = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) next.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: next });
}

function rounded(value) {
  return Math.round(value * 10_000) / 10_000;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export default createFeedbackWorker();
