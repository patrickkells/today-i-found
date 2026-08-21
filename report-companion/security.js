import net from "node:net";

export const PUBLIC_READER_ORIGIN = "https://patrickkells.github.io";

export const LOCAL_DEVELOPMENT_ORIGINS = Object.freeze(new Set([
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]));

function exactProductionOrigin(value) {
  if (typeof value !== "string" || !value) return null;
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error("Production origin must be an exact HTTPS origin"); }
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash || value === PUBLIC_READER_ORIGIN) {
    throw new Error("Production origin must be an exact dedicated HTTPS origin");
  }
  return parsed.origin;
}

export function createOriginPolicy(productionOrigin) {
  const privilegedOrigins = new Set(LOCAL_DEVELOPMENT_ORIGINS);
  const healthOrigins = new Set([...LOCAL_DEVELOPMENT_ORIGINS, PUBLIC_READER_ORIGIN]);
  const configured = exactProductionOrigin(productionOrigin);
  if (configured) {
    privilegedOrigins.add(configured);
    healthOrigins.add(configured);
  }
  return { healthOrigins, privilegedOrigins, productionOrigin: configured };
}

export const DEFAULT_ORIGIN_POLICY = createOriginPolicy();

export function assertAllowedOrigin(origin, allowedOrigins) {
  if (typeof origin !== "string" || !allowedOrigins.has(origin)) {
    throw Object.assign(new Error("Browser origin is not allowed"), { statusCode: 403 });
  }
  return origin;
}

export function assertLoopbackHost(host, port) {
  if (typeof host !== "string") throw Object.assign(new Error("Host is required"), { statusCode: 400 });
  const match = host.match(/^([^:]+):(\d+)$/);
  if (!match || !["127.0.0.1", "localhost"].includes(match[1]) || Number(match[2]) !== Number(port)) {
    throw Object.assign(new Error("Host is not the loopback companion"), { statusCode: 400 });
  }
}

export function preflightHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-private-network": "true",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function privateV4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b, c] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113) || a >= 224;
}

export function isPrivateAddress(address) {
  const normalized = String(address ?? "").toLowerCase().split("%")[0];
  if (net.isIPv4(normalized)) return privateV4(normalized);
  if (!net.isIPv6(normalized)) return true;
  if (normalized.startsWith("::ffff:")) return privateV4(normalized.slice(7));
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc")
    || normalized.startsWith("fd") || normalized.startsWith("fe8")
    || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")
    || normalized.startsWith("ff")) return true;
  const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if (first < 0x2000 || first > 0x3fff) return true;
  return normalized.startsWith("2001:db8:") || normalized === "2001:db8::"
    || normalized.startsWith("2001:2:") || normalized === "2001:2::"
    || normalized.startsWith("2001:0:") || normalized === "2001::";
}
