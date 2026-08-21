import { createHash, randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export class PairingStore {
  constructor({
    stateDir,
    randomBytes = cryptoRandomBytes,
    now = () => Date.now(),
    pairingCodeTtlMs = 10 * 60_000,
    maxFailedAttempts = 5,
    lockoutMs = 15 * 60_000,
  } = {}) {
    if (!stateDir) throw new Error("Pairing state directory is required");
    this.stateDir = stateDir;
    this.file = path.join(stateDir, "pairing.json");
    this.randomBytes = randomBytes;
    this.now = now;
    this.pairingCodeTtlMs = pairingCodeTtlMs;
    this.maxFailedAttempts = maxFailedAttempts;
    this.lockoutMs = lockoutMs;
    this.challenge = null;
    this.failedAttempts = 0;
    this.lockedUntil = null;
  }

  async read() {
    try {
      return JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async getPairingCode() {
    if (await this.read()) throw new Error("Device is already paired");
    if (!this.challenge || this.now() >= this.challenge.expiresAt) {
      const value = this.randomBytes(4).readUInt32BE(0) % 1_000_000;
      this.challenge = {
        code: String(value).padStart(6, "0"),
        expiresAt: this.now() + this.pairingCodeTtlMs,
      };
      this.failedAttempts = 0;
    }
    return this.challenge.code;
  }

  async isPaired() {
    return Boolean(await this.read());
  }

  async pair(code) {
    if (await this.read()) throw new Error("Device is already paired");
    const now = this.now();
    if (this.lockedUntil && now < this.lockedUntil) {
      throw Object.assign(new Error("Pairing is temporarily locked"), {
        statusCode: 429,
        retryAfterSeconds: Math.ceil((this.lockedUntil - now) / 1_000),
      });
    }
    if (this.lockedUntil) {
      this.lockedUntil = null;
      this.failedAttempts = 0;
    }
    if (!this.challenge) await this.getPairingCode();
    if (now >= this.challenge.expiresAt) {
      this.challenge = null;
      this.failedAttempts = 0;
      throw Object.assign(new Error("Pairing code has expired"), { statusCode: 401 });
    }
    if (!safeEqual(this.challenge.code, code)) {
      this.failedAttempts += 1;
      if (this.failedAttempts >= this.maxFailedAttempts) {
        this.lockedUntil = now + this.lockoutMs;
        throw Object.assign(new Error("Pairing is temporarily locked"), {
          statusCode: 429,
          retryAfterSeconds: Math.ceil(this.lockoutMs / 1_000),
        });
      }
      throw Object.assign(new Error("Pairing code is invalid"), { statusCode: 401 });
    }
    const deviceToken = base64url(this.randomBytes(32));
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    await writeFile(this.file, `${JSON.stringify({ tokenHash: hash(deviceToken), pairedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    this.challenge = null;
    this.failedAttempts = 0;
    this.lockedUntil = null;
    return { deviceToken };
  }

  async authenticate(token) {
    const state = await this.read();
    return Boolean(state?.tokenHash && token && safeEqual(state.tokenHash, hash(token)));
  }
}
