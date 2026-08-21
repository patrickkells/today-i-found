import dns from "node:dns/promises";
import https from "node:https";
import { isPrivateAddress } from "./security.js";
import { htmlToPlainText } from "./html-text.js";

function productionRequest(url, { address, family, signal, maxBytes }) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: "https:",
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        accept: "text/html,text/plain;q=0.9",
        "user-agent": "today-i-found-local-report/1.0",
      },
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address, family),
      signal,
    }, (response) => {
      const chunks = [];
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > maxBytes) request.destroy(new Error("Source response is too large"));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

function header(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()];
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

export function createSourceFetcher({
  resolve = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
  request = productionRequest,
  maxBytes = 2_000_000,
  timeoutMs = 15_000,
  maxRedirects = 3,
} = {}) {
  return async function fetchSource(sourceUrl, { signal: outerSignal } = {}) {
    let current;
    try { current = new URL(sourceUrl); } catch { throw new Error("Source URL is invalid"); }
    if (current.protocol !== "https:") throw new Error("Source URL must use HTTPS");
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("Source retrieval timed out")), timeoutMs);
      timeout.unref?.();
      const abortOuter = () => controller.abort(outerSignal.reason ?? new Error("Source retrieval cancelled"));
      if (outerSignal?.aborted) abortOuter();
      else outerSignal?.addEventListener("abort", abortOuter, { once: true });
      let response;
      try {
        const records = await abortable(resolve(current.hostname), controller.signal);
        if (!Array.isArray(records) || records.length === 0) throw new Error("Source hostname did not resolve");
        if (records.some(({ address }) => isPrivateAddress(address))) throw new Error("Source resolves to a private network address");
        const record = records[0];
        response = await request(current, {
          address: record.address,
          family: record.family,
          signal: controller.signal,
          maxBytes,
        });
      } finally {
        clearTimeout(timeout);
        outerSignal?.removeEventListener("abort", abortOuter);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === maxRedirects) throw new Error("Source redirected too many times");
        const location = header(response.headers, "location");
        if (!location) throw new Error("Source redirect has no location");
        current = new URL(location, current);
        if (current.protocol !== "https:") throw new Error("Source redirect must use HTTPS");
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`Source request failed with status ${response.status}`);
      if (!Buffer.isBuffer(response.body)) throw new Error("Source response body is invalid");
      if (response.body.length > maxBytes) throw new Error("Source response is too large");
      const type = String(header(response.headers, "content-type") ?? "text/plain").toLowerCase();
      if (!type.includes("text/html") && !type.includes("text/plain") && !type.includes("application/xhtml+xml")) {
        throw new Error("Source content type is not readable text");
      }
      const raw = response.body.toString("utf8");
      const text = type.includes("html") || type.includes("xhtml") ? htmlToPlainText(raw) : raw.trim().slice(0, 200_000);
      if (!text) throw new Error("Source contained no readable text");
      return { text, finalUrl: current.href, contentType: type };
    }
    throw new Error("Source redirect limit exceeded");
  };
}
