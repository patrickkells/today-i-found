export const REPORT_DEVICE_TOKEN_KEY = "today-i-found:report-device-token";
export const REPORT_OWNED_JOB_KEY = "today-i-found:owned-report-job";
export const DEFAULT_REPORT_COMPANION_BASE = "http://127.0.0.1:43121";

export class ReportCompanionError extends Error {
  constructor(message, { code = "request", status = 0 } = {}) {
    super(message);
    this.name = "ReportCompanionError";
    this.code = code;
    this.status = status;
  }
}

function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || DEFAULT_REPORT_COMPANION_BASE);
  const exactLoopback = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/?$/.exec(raw);
  if (!exactLoopback) {
    throw new ReportCompanionError("Report companion base must be an exact loopback URL.");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ReportCompanionError("Report companion base must be an exact loopback URL.");
  }
  const port = Number(exactLoopback[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ReportCompanionError("Report companion base must be an exact loopback URL.");
  }
  return url.origin;
}

function safeFilename(disposition, kind) {
  const match = String(disposition ?? "").match(/filename="([^"]+)"/i);
  return match?.[1] ?? `today-i-found-report.${kind === "markdown" ? "md" : "json"}`;
}

function normalizeOwnedJob(value) {
  const valid = value && typeof value === "object"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.jobId)
    && /^\d{4}-\d{2}-\d{2}$/.test(value.editionDate)
    && !Number.isNaN(new Date(`${value.editionDate}T12:00:00Z`).getTime());
  if (!valid) return null;
  return {
    jobId: value.jobId,
    editionDate: value.editionDate,
    status: ["active", "completed"].includes(value.status) ? value.status : "unknown",
  };
}

export function createReportCompanionClient({
  baseUrl = DEFAULT_REPORT_COMPANION_BASE,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const token = () => storage?.getItem(REPORT_DEVICE_TOKEN_KEY) || null;
  const removeOwnedJob = () => {
    try {
      storage?.removeItem(REPORT_OWNED_JOB_KEY);
      return true;
    } catch {
      return false;
    }
  };
  const readOwnedJob = () => {
    try {
      const value = JSON.parse(storage?.getItem(REPORT_OWNED_JOB_KEY) || "null");
      const normalized = normalizeOwnedJob(value);
      if (normalized) return normalized;
    } catch {
      // Invalid browser storage is discarded below.
    }
    removeOwnedJob();
    return null;
  };

  async function request(path, { method = "GET", body, authenticated = false, artifact = null } = {}) {
    const deviceToken = authenticated ? token() : null;
    if (authenticated && !deviceToken) {
      throw new ReportCompanionError("This browser is not paired with the report companion.", { code: "auth", status: 401 });
    }
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        targetAddressSpace: "loopback",
        cache: "no-store",
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(deviceToken ? { authorization: `Bearer ${deviceToken}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ReportCompanionError("The report companion is unavailable on this Mac.", { code: "offline" });
    }

    if (!response.ok) {
      let message = `The report companion returned ${response.status}.`;
      try {
        const payload = await response.json();
        if (typeof payload?.error === "string") message = payload.error;
      } catch {
        // The status is still sufficient when a proxy returns a non-JSON body.
      }
      const code = response.status === 401 ? "auth" : response.status === 409 ? "busy" : "request";
      if (code === "auth") storage?.removeItem(REPORT_DEVICE_TOKEN_KEY);
      throw new ReportCompanionError(message, { code, status: response.status });
    }

    if (artifact) {
      return {
        blob: await response.blob(),
        filename: safeFilename(response.headers.get("content-disposition"), artifact),
      };
    }
    return response.json();
  }

  return {
    hasToken() { return Boolean(token()); },
    clearToken() { storage?.removeItem(REPORT_DEVICE_TOKEN_KEY); },
    getOwnedJob: readOwnedJob,
    setOwnedJob({ jobId, editionDate, status = "active" }) {
      const value = { jobId, editionDate, status };
      if (!normalizeOwnedJob(value) || !["active", "completed"].includes(status)) throw new ReportCompanionError("Owned report identity is invalid.");
      storage?.setItem(REPORT_OWNED_JOB_KEY, JSON.stringify(value));
    },
    clearOwnedJob(jobId) {
      const current = readOwnedJob();
      if (!current || current.jobId !== jobId) return false;
      return removeOwnedJob();
    },
    health() { return request("/v1/health"); },
    async pair(pairingCode) {
      const result = await request("/v1/pair", { method: "POST", body: { pairingCode } });
      if (typeof result?.deviceToken !== "string" || !result.deviceToken) {
        throw new ReportCompanionError("The report companion did not return a device token.");
      }
      storage?.setItem(REPORT_DEVICE_TOKEN_KEY, result.deviceToken);
      return { paired: true };
    },
    startReport({ date, itemIds }) {
      return request("/v1/reports", { method: "POST", body: { date, itemIds }, authenticated: true });
    },
    getReport(jobId) {
      return request(`/v1/reports/${encodeURIComponent(jobId)}`, { authenticated: true });
    },
    cancel(jobId) {
      return request(`/v1/reports/${encodeURIComponent(jobId)}`, { method: "DELETE", authenticated: true });
    },
    download(jobId, kind) {
      if (!["markdown", "json"].includes(kind)) {
        throw new ReportCompanionError("Report download type is invalid.");
      }
      return request(`/v1/reports/${encodeURIComponent(jobId)}/download/${kind}`, { authenticated: true, artifact: kind });
    },
  };
}
