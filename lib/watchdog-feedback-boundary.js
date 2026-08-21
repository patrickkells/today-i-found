import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateEdition } from "./curation.js";

const MAX_JSON_BYTES = 2 * 1024 * 1024;

function validPreference(entry) {
  return entry && typeof entry.value === "string" && entry.value.length <= 200
    && Number.isFinite(entry.effectiveVotes) && entry.effectiveVotes >= 0
    && Number.isFinite(entry.adjustment) && entry.adjustment >= -0.5 && entry.adjustment <= 0.5;
}

export function validateFeedbackSummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) throw new Error("Feedback summary is invalid");
  const preferences = summary.preferences;
  if (!preferences || typeof preferences !== "object") throw new Error("Feedback summary is invalid");
  for (const group of ["category", "source", "tag"]) {
    if (!Array.isArray(preferences[group]) || preferences[group].length > 10_000 || !preferences[group].every(validPreference)) {
      throw new Error("Feedback summary is invalid");
    }
  }
  return summary;
}

async function fetchJson({ fetchImpl, url, token, method = "GET", body }) {
  const response = await fetchImpl(url, {
    method,
    redirect: "error",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(method === "GET" ? "Feedback summary request failed" : "Edition registration failed");
  if (method !== "GET") return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_JSON_BYTES) throw new Error("Feedback summary is invalid");
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Feedback summary is invalid"); }
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > MAX_JSON_BYTES) {
        reject(new Error("Registration payload is too large"));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Registration payload is invalid")); }
    });
    request.on("error", reject);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export async function prepareWatchdogFeedbackBoundary({
  projectRoot,
  date,
  gate,
  claimId,
  credentials,
  fetchImpl = globalThis.fetch,
}) {
  const summary = validateFeedbackSummary(await fetchJson({
    fetchImpl,
    url: credentials.FEEDBACK_SUMMARY_URL,
    token: credentials.CURATOR_TOKEN,
  }));
  const inputDirectory = path.join(projectRoot, ".curation", "watchdog-inputs");
  await mkdir(inputDirectory, { recursive: true, mode: 0o700 });
  const feedbackFile = path.join(inputDirectory, `${date}-${randomUUID()}.json`);
  await writeFile(feedbackFile, `${JSON.stringify(summary)}\n`, { mode: 0o600, flag: "wx" });

  const route = `/register/${randomUUID()}`;
  let registrationComplete = false;
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== route || registrationComplete) {
        response.writeHead(404).end();
        return;
      }
      const edition = await readRequestJson(request);
      const errors = validateEdition(edition);
      if (edition.date !== date || errors.length) throw new Error("Registration payload is not the claimed edition");
      await gate.assertOwned({ date, claimId });
      await fetchJson({
        fetchImpl,
        url: credentials.REGISTER_EDITION_URL,
        token: credentials.CURATOR_TOKEN,
        method: "POST",
        body: edition,
      });
      registrationComplete = true;
      response.writeHead(204).end();
    } catch {
      response.writeHead(502).end();
    }
  });
  try {
    const address = await listen(server);
    return {
      feedbackFile,
      registrationProxyUrl: `http://127.0.0.1:${address.port}${route}`,
      registered: () => registrationComplete,
      close: () => close(server),
    };
  } catch (error) {
    server.close();
    throw error;
  }
}
