const VISITOR_KEY = "today-i-found:visitor-id";
const VOTE_KEY_PREFIX = "today-i-found:votes:";
const OUTBOX_KEY_PREFIX = "today-i-found:vote-outbox:";

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

function outboxKey(visitorId) {
  return `${OUTBOX_KEY_PREFIX}${visitorId}`;
}

function readOutbox(storage, visitorId) {
  const entries = readJson(storage, outboxKey(visitorId), {});
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return {};
  return Object.fromEntries(Object.entries(entries).filter(([, entry]) => (
    entry
    && typeof entry === "object"
    && validVote(entry.value)
    && Number.isFinite(entry.updatedAt)
  )));
}

function writeOutbox(storage, visitorId, outbox) {
  if (typeof storage?.setItem !== "function") return false;
  try {
    storage.setItem(outboxKey(visitorId), JSON.stringify(outbox));
    return true;
  } catch {
    return false;
  }
}

function localSelections(storage, visitorId, outbox) {
  const legacy = readLocalVotes(storage, visitorId);
  const queued = Object.fromEntries(Object.entries(outbox).map(([itemId, entry]) => [itemId, entry.value]));
  return { ...legacy, ...queued };
}

function applyLocalSelection(record, value) {
  if (!validVote(value) || record.myVote === value) return record;
  const next = { ...record };
  if (next.myVote) next[next.myVote] = Math.max(0, next[next.myVote] - 1);
  if (value) next[value] += 1;
  next.myVote = value;
  return next;
}

function overlayLocalSelections(records, selections) {
  return Object.fromEntries(Object.entries(records).map(([itemId, record]) => [
    itemId,
    applyLocalSelection(record, selections[itemId]),
  ]));
}

export function seedVoteRecords(items, votes = {}) {
  return Object.fromEntries(
    items.map((item) => {
      const myVote = validVote(votes[item.id]) ? votes[item.id] : null;
      return [
        item.id,
        {
          up: myVote === "up" ? 1 : 0,
          down: myVote === "down" ? 1 : 0,
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
  now = () => Date.now(),
} = {}) {
  const visitorId = getOrCreateVisitorId(storage, cryptoImpl);
  const normalizedApiBase = typeof apiBase === "string" ? apiBase.trim().replace(/\/+$/, "") : "";
  const apiUrl = (path) => `${normalizedApiBase}${path}`;
  const mutationQueues = new Map();
  const outbox = readOutbox(storage, visitorId);
  const durableVersions = new Map(Object.entries(outbox).map(([itemId, mutation]) => [itemId, mutation.updatedAt]));
  let lastMutationAt = 0;

  const persistOutbox = () => {
    if (!writeOutbox(storage, visitorId, outbox)) return false;
    durableVersions.clear();
    for (const [itemId, mutation] of Object.entries(outbox)) durableVersions.set(itemId, mutation.updatedAt);
    return true;
  };
  const isDurable = (itemId, mutation) => durableVersions.get(itemId) === mutation.updatedAt;
  const nextMutationAt = () => {
    lastMutationAt = Math.max(now(), lastMutationAt + 1);
    return lastMutationAt;
  };

  const acknowledge = (itemId, updatedAt) => {
    if (outbox[itemId]?.updatedAt !== updatedAt) return false;
    delete outbox[itemId];
    durableVersions.delete(itemId);
    persistOutbox();
    return true;
  };

  const migrateLegacyVotes = () => {
    const legacy = readLocalVotes(storage, visitorId);
    let migrated = false;
    let hasLegacySelections = false;
    for (const [itemId, value] of Object.entries(legacy)) {
      if (!validVote(value)) continue;
      hasLegacySelections = true;
      if (Object.hasOwn(outbox, itemId)) continue;
      outbox[itemId] = { value, updatedAt: nextMutationAt() };
      migrated = true;
    }
    if (migrated && !persistOutbox()) return;
    if (!hasLegacySelections) return;
    try {
      storage?.removeItem(localVoteKey(visitorId));
    } catch {
      // A blocked legacy cleanup will be retried after the next remote load.
    }
  };

  const sendMutation = async (itemId, mutation) => {
    if (!fetchImpl) throw new Error("Fetch is unavailable");
    const response = await fetchImpl(apiUrl(`/v1/items/${itemId}/vote`), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: mutation.value, visitorId }),
    });
    if (!response.ok) {
      const error = new Error(`Feedback update failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    const record = canonicalRecord(payload.record ?? payload);
    acknowledge(itemId, mutation.updatedAt);
    return record;
  };

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
        let records = canonicalRecords(await response.json());
        migrateLegacyVotes();
        const visibleIds = new Set(items.map((item) => item.id));
        records = overlayLocalSelections(records, localSelections(storage, visitorId, outbox));
        let persistenceFailed = false;
        const visibleEntries = Object.entries(outbox).filter(([itemId]) => visibleIds.has(itemId));
        if (visibleEntries.some(([itemId, mutation]) => !isDurable(itemId, mutation)) && !persistOutbox()) {
          persistenceFailed = true;
        }
        for (const [itemId, mutation] of Object.entries(outbox)) {
          if (!visibleIds.has(itemId)) continue;
          if (!isDurable(itemId, mutation)) continue;
          try {
            records[itemId] = await enqueueMutation(itemId, () => sendMutation(itemId, mutation));
          } catch {
            // Keep the durable mutation for a future load or retry.
          }
        }
        const pending = Object.keys(outbox).some((itemId) => visibleIds.has(itemId));
        return {
          records,
          source: persistenceFailed ? "local" : pending ? "syncing" : "synced",
          ...(persistenceFailed ? { persistence: "failed" } : {}),
        };
      } catch {
        return {
          records: seedVoteRecords(items, localSelections(storage, visitorId, outbox)),
          source: "local",
        };
      }
    },

    setVote(itemId, value, fallbackRecord) {
      if (!validVote(value)) throw new Error("Vote value must be up, down, or null");
      const mutation = { value, updatedAt: nextMutationAt() };
      outbox[itemId] = mutation;
      const fallback = canonicalRecord({
        up: fallbackRecord?.up ?? 0,
        down: fallbackRecord?.down ?? 0,
        myVote: value,
      });
      if (!persistOutbox()) {
        return Object.assign(Promise.resolve({ record: fallback, source: "local", persistence: "failed" }), {
          initialSource: "local",
          initialPersistence: "failed",
        });
      }
      const request = enqueueMutation(itemId, async () => {
        try {
          const record = await sendMutation(itemId, mutation);
          return { record, source: Object.hasOwn(outbox, itemId) ? "syncing" : "synced", persistence: "durable" };
        } catch (error) {
          return { record: fallback, source: error?.status === 429 ? "syncing" : "local", persistence: "durable" };
        }
      });
      return Object.assign(request, { initialSource: "syncing", initialPersistence: "durable" });
    },
  };
}
