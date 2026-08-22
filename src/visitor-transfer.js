export const VISITOR_STORAGE_KEY = "today-i-found:visitor-id";

const TRANSFER_PREFIX = "today-i-found:visitor-transfer:v1:";
const TRANSFER_LIFETIME_MS = 5 * 60_000;

function validOrigin(value) {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function validVisitorId(value) {
  return typeof value === "string"
    && value.length >= 8
    && value.length <= 200
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

export function prepareVisitorTransfer(windowImpl, visitorId, targetOrigin, { now = Date.now() } = {}) {
  const sourceOrigin = windowImpl?.location?.origin;
  if (!validVisitorId(visitorId) || !validOrigin(sourceOrigin) || !validOrigin(targetOrigin)) return false;
  try {
    windowImpl.name = `${TRANSFER_PREFIX}${JSON.stringify({
      expiresAt: now + TRANSFER_LIFETIME_MS,
      sourceOrigin,
      targetOrigin,
      visitorId,
    })}`;
    return true;
  } catch {
    return false;
  }
}

export function consumeVisitorTransfer(windowImpl, storage, {
  allowedSourceOrigins,
  targetOrigin,
  now = Date.now(),
} = {}) {
  const value = windowImpl?.name;
  if (typeof value !== "string" || !value.startsWith(TRANSFER_PREFIX)) return false;
  try {
    windowImpl.name = "";
    const transfer = JSON.parse(value.slice(TRANSFER_PREFIX.length));
    if (!Array.isArray(allowedSourceOrigins) || !allowedSourceOrigins.includes(transfer.sourceOrigin)) return false;
    if (targetOrigin !== windowImpl?.location?.origin || transfer.targetOrigin !== targetOrigin) return false;
    if (!Number.isFinite(transfer.expiresAt) || transfer.expiresAt < now) return false;
    if (!validVisitorId(transfer.visitorId)) return false;
    storage?.setItem(VISITOR_STORAGE_KEY, transfer.visitorId);
    return storage?.getItem(VISITOR_STORAGE_KEY) === transfer.visitorId;
  } catch {
    return false;
  }
}
