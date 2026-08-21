import http from "node:http";
import { assertAllowedOrigin, assertLoopbackHost, createOriginPolicy, preflightHeaders } from "./security.js";
import { loadTrustedSelection } from "./edition-store.js";

function send(response, status, body, headers = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    ...(payload ? { "content-type": "application/json; charset=utf-8", "content-length": payload.length } : {}),
    "cache-control": "no-store",
    ...headers,
  });
  response.end(payload);
}

async function readJson(request, maxBytes = 32_768) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error("Request body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 }); }
}

function bearerToken(request) {
  const match = String(request.headers.authorization ?? "").match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

export function createCompanionServer({
  pairingStore,
  jobs,
  editionsDir,
  productionOrigin,
  originPolicy = createOriginPolicy(productionOrigin),
  port = 43_121,
} = {}) {
  const server = http.createServer(async (request, response) => {
    let origin;
    try {
      const livePort = server.address()?.port ?? port;
      assertLoopbackHost(request.headers.host, livePort);
      const url = new URL(request.url, `http://127.0.0.1:${livePort}`);
      const isHealth = url.pathname === "/v1/health";
      origin = assertAllowedOrigin(request.headers.origin, isHealth ? originPolicy.healthOrigins : originPolicy.privilegedOrigins);
      const cors = preflightHeaders(origin);
      if (request.method === "OPTIONS") {
        response.writeHead(204, { ...cors, "cache-control": "no-store" });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/health") {
        send(response, 200, { status: "ok", version: "1", paired: await pairingStore.isPaired(), busy: jobs.busy }, cors);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/pair") {
        const body = await readJson(request);
        if (Object.keys(body).length !== 1 || typeof body.pairingCode !== "string") throw Object.assign(new Error("Pairing requires only pairingCode"), { statusCode: 400 });
        send(response, 200, await pairingStore.pair(body.pairingCode), cors);
        return;
      }
      if (!await pairingStore.authenticate(bearerToken(request))) throw Object.assign(new Error("Device token is invalid"), { statusCode: 401 });
      if (request.method === "POST" && url.pathname === "/v1/reports") {
        const selection = await loadTrustedSelection({ editionsDir, body: await readJson(request) });
        send(response, 202, jobs.start(selection), cors);
        return;
      }
      const statusMatch = url.pathname.match(/^\/v1\/reports\/([0-9a-f-]+)$/i);
      if (statusMatch && request.method === "GET") {
        send(response, 200, jobs.get(statusMatch[1]), cors);
        return;
      }
      if (statusMatch && request.method === "DELETE") {
        send(response, 202, { cancelled: jobs.cancel(statusMatch[1]) }, cors);
        return;
      }
      const downloadMatch = url.pathname.match(/^\/v1\/reports\/([0-9a-f-]+)\/download\/(markdown|json)$/i);
      if (downloadMatch && request.method === "GET") {
        const kind = downloadMatch[2].toLowerCase();
        const buffer = await jobs.readArtifact(downloadMatch[1], kind);
        response.writeHead(200, {
          ...cors,
          "cache-control": "no-store",
          "content-type": kind === "markdown" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="today-i-found-report.${kind === "markdown" ? "md" : "json"}"`,
          "content-length": buffer.length,
        });
        response.end(buffer);
        return;
      }
      throw Object.assign(new Error("Endpoint was not found"), { statusCode: 404 });
    } catch (error) {
      const headers = origin ? {
        ...preflightHeaders(origin),
        ...(error.retryAfterSeconds ? { "retry-after": String(error.retryAfterSeconds) } : {}),
      } : {};
      send(response, error.statusCode ?? 500, { error: error.message || "Internal companion error" }, headers);
    }
  });
  return server;
}
