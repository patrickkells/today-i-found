const VISITOR_KEY = "today-i-found:visitor-id";
const VOTE_KEY_PREFIX = "today-i-found:votes:";

function seedFor(id) {
  return [...id].reduce((total, character) => total + character.charCodeAt(0), 0);
}

function validVote(value) {
  return value === "up" || value === "down" || value === null;
}

function readJson(storage, key, fallback) {
  try {
    return JSON.parse(storage?.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function createVisitorId(cryptoImpl) {
  if (typeof cryptoImpl?.randomUUID === "function") return cryptoImpl.randomUUID();
  const random = Math.random().toString(36).slice(2);
  return `visitor-${Date.now().toString(36)}-${random}`;
}

export function getOrCreateVisitorId(storage, cryptoImpl = globalThis.crypto) {
  const existing = storage?.getItem(VISITOR_KEY);
  if (existing) return existing;
  const visitorId = createVisitorId(cryptoImpl);
  try {
    storage?.setItem(VISITOR_KEY, visitorId);
  } catch {
    // The in-memory identifier still keeps this service instance consistent.
  }
  return visitorId;
}

function localVoteKey(visitorId) {
  return `${VOTE_KEY_PREFIX}${visitorId}`;
}

function readLocalVotes(storage, visitorId) {
  return readJson(storage, localVoteKey(visitorId), {});
}

function writeLocalVote(storage, visitorId, itemId, value) {
  const votes = readLocalVotes(storage, visitorId);
  if (value) votes[itemId] = value;
  else delete votes[itemId];
  try {
    storage?.setItem(localVoteKey(visitorId), JSON.stringify(votes));
  } catch {
    // A blocked storage write does not prevent the current-session vote.
  }
}

export function seedVoteRecords(items, votes = {}) {
  return Object.fromEntries(
    items.map((item) => {
      const seed = seedFor(item.id);
      const myVote = validVote(votes[item.id]) ? votes[item.id] : null;
      return [
        item.id,
        {
          up: 6 + (seed % 19) + (myVote === "up" ? 1 : 0),
          down: (seed % 5) + (myVote === "down" ? 1 : 0),
          myVote,
        },
      ];
    }),
  );
}

export function seedVoteCounts(items) {
  return Object.fromEntries(
    Object.entries(seedVoteRecords(items)).map(([itemId, record]) => [
      itemId,
      { up: record.up, down: record.down },
    ]),
  );
}

function canonicalRecord(value) {
  if (!value || !Number.isFinite(value.up) || !Number.isFinite(value.down)) {
    throw new Error("Feedback response contains an invalid vote record");
  }
  if (!validVote(value.myVote)) throw new Error("Feedback response contains an invalid myVote");
  return {
    up: Math.max(0, value.up),
    down: Math.max(0, value.down),
    myVote: value.myVote,
  };
}

function canonicalRecords(payload) {
  const entries = Array.isArray(payload?.items)
    ? payload.items.map((item) => [item.itemId, item])
    : Object.entries(payload?.items ?? payload?.records ?? {});
  return Object.fromEntries(entries.map(([itemId, record]) => [itemId, canonicalRecord(record)]));
}

export function reconcileLoadedRecords(current, loaded, versionsAtStart, currentVersions) {
  const next = { ...current };
  for (const [itemId, record] of Object.entries(loaded)) {
    if ((versionsAtStart[itemId] ?? 0) === (currentVersions[itemId] ?? 0)) {
      next[itemId] = record;
    }
  }
  return next;
}

export function reconcileMutationRecord(current, response, requestVersion, currentVersion) {
  return requestVersion === currentVersion ? response : current;
}

export function reconcileFeedbackSource(current, response, requestVersion, currentVersion) {
  return requestVersion === currentVersion ? response : current;
}

export function createFeedbackService({
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  cryptoImpl = globalThis.crypto,
  apiBase = "",
} = {}) {
  const visitorId = getOrCreateVisitorId(storage, cryptoImpl);
  const normalizedApiBase = typeof apiBase === "string" ? apiBase.trim().replace(/\/+$/, "") : "";
  const apiUrl = (path) => `${normalizedApiBase}${path}`;
  const mutationQueues = new Map();

  const enqueueMutation = (itemId, task) => {
    const previous = mutationQueues.get(itemId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    mutationQueues.set(itemId, current);
    current.then(
      () => { if (mutationQueues.get(itemId) === current) mutationQueues.delete(itemId); },
      () => { if (mutationQueues.get(itemId) === current) mutationQueues.delete(itemId); },
    );
    return current;
  };

  return {
    visitorId,

    async getVotes(date, items) {
      try {
        if (!fetchImpl) throw new Error("Fetch is unavailable");
        const response = await fetchImpl(
          apiUrl(`/v1/editions/${date}/votes?visitorId=${encodeURIComponent(visitorId)}`),
          { headers: { accept: "application/json" } },
        );
        if (!response.ok) throw new Error(`Feedback request failed: ${response.status}`);
        return { records: canonicalRecords(await response.json()), source: "remote" };
      } catch {
        return {
          records: seedVoteRecords(items, readLocalVotes(storage, visitorId)),
          source: "fallback",
        };
      }
    },

    setVote(itemId, value, fallbackRecord) {
      if (!validVote(value)) throw new Error("Vote value must be up, down, or null");
      return enqueueMutation(itemId, async () => {
        try {
          if (!fetchImpl) throw new Error("Fetch is unavailable");
          const response = await fetchImpl(apiUrl(`/v1/items/${itemId}/vote`), {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ value, visitorId }),
          });
          if (!response.ok) throw new Error(`Feedback update failed: ${response.status}`);
          const payload = await response.json();
          const record = canonicalRecord(payload.record ?? payload);
          writeLocalVote(storage, visitorId, itemId, record.myVote);
          return { record, source: "remote" };
        } catch {
          const record = canonicalRecord({
            up: fallbackRecord?.up ?? 0,
            down: fallbackRecord?.down ?? 0,
            myVote: value,
          });
          writeLocalVote(storage, visitorId, itemId, value);
          return { record, source: "fallback" };
        }
      });
    },
  };
}
