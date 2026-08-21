import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OWNER_PATTERN = /^(scheduled-task|watchdog)$/;
const FAILURE_REASONS = new Set(["authentication-failed", "curation-failed", "publication-failed", "verification-failed"]);
const COMPLETION_RESULTS = new Set(["published", "no-edition"]);
const TRANSITION_STALE_MS = 30_000;

function requireDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("A valid YYYY-MM-DD publication date is required");
  }
}

function publicState(state, now) {
  if (!state) return null;
  const { claimId: _claimId, ...visible } = state;
  if (state.status === "active" && Date.parse(state.expiresAt) <= now.getTime()) {
    visible.status = "stale";
  }
  return visible;
}

function stateFile(directory) {
  return path.join(directory, "state.json");
}

async function readState(directory) {
  try {
    return JSON.parse(await readFile(stateFile(directory), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function interruptedClaimState(directory, date, staleAfterMs) {
  try {
    const metadata = await stat(directory);
    const claimedAt = metadata.mtime;
    return {
      date,
      status: "active",
      owner: "initializing",
      attempt: 0,
      claimedAt: claimedAt.toISOString(),
      expiresAt: new Date(claimedAt.getTime() + staleAfterMs).toISOString(),
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeState(directory, state) {
  const temporary = path.join(directory, `.state-${randomUUID()}.json`);
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, stateFile(directory));
}

export class PublicationRunGate {
  constructor({ rootDirectory, staleAfterMs = 2 * 60 * 60 * 1_000, now = () => new Date() }) {
    if (!rootDirectory) throw new Error("A publication run-gate directory is required");
    if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) throw new Error("staleAfterMs must be positive");
    this.rootDirectory = rootDirectory;
    this.staleAfterMs = staleAfterMs;
    this.now = now;
  }

  directory(date) {
    requireDate(date);
    return path.join(this.rootDirectory, date);
  }

  async claim({ date, owner }) {
    requireDate(date);
    if (!OWNER_PATTERN.test(owner)) throw new Error("owner must be scheduled-task or watchdog");
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const directory = this.directory(date);

    for (;;) {
      const claimedAt = this.now();
      try {
        await mkdir(directory, { mode: 0o700 });
        const state = {
          date,
          status: "active",
          owner,
          attempt: 1,
          claimId: randomUUID(),
          claimedAt: claimedAt.toISOString(),
          expiresAt: new Date(claimedAt.getTime() + this.staleAfterMs).toISOString(),
        };
        await writeState(directory, state);
        return { claimed: true, ...state };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }

      const transition = await this.#acquireTransition(date);
      try {
        const existing = await readState(directory) ?? await interruptedClaimState(directory, date, this.staleAfterMs);
        if (!existing) continue;
        if (existing.status === "completed") return { claimed: false, date, reason: "completed" };
        const isStale = existing.status === "active" && Date.parse(existing.expiresAt) <= claimedAt.getTime();
        if (existing.status === "active" && !isStale) return { claimed: false, date, reason: "active" };

        const replacedDirectory = path.join(this.rootDirectory, `.${date}-replaced-${randomUUID()}`);
        try {
          await rename(directory, replacedDirectory);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        try {
          await mkdir(directory, { mode: 0o700 });
          const state = {
            date,
            status: "active",
            owner,
            attempt: (Number(existing.attempt) || 0) + 1,
            claimId: randomUUID(),
            claimedAt: claimedAt.toISOString(),
            expiresAt: new Date(claimedAt.getTime() + this.staleAfterMs).toISOString(),
          };
          await writeState(directory, state);
          return { claimed: true, ...state };
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        } finally {
          await rm(replacedDirectory, { recursive: true, force: true });
        }
      } finally {
        await rm(transition, { recursive: true, force: true });
      }
    }
  }

  async status({ date }) {
    const directory = this.directory(date);
    const state = await readState(directory) ?? await interruptedClaimState(directory, date, this.staleAfterMs);
    return state ? publicState(state, this.now()) : { date, status: "idle" };
  }

  async renew({ date, claimId }) {
    const directory = this.directory(date);
    const transition = await this.#acquireTransition(date);
    try {
      const current = await this.#ownedState({ directory, date, claimId });
      const renewedAt = this.now();
      const state = {
        ...current,
        renewedAt: renewedAt.toISOString(),
        expiresAt: new Date(renewedAt.getTime() + this.staleAfterMs).toISOString(),
      };
      await writeState(directory, state);
      return publicState(state, renewedAt);
    } finally {
      await rm(transition, { recursive: true, force: true });
    }
  }

  async assertOwned({ date, claimId }) {
    const directory = this.directory(date);
    const transition = await this.#acquireTransition(date);
    try {
      return publicState(await this.#ownedState({ directory, date, claimId }), this.now());
    } finally {
      await rm(transition, { recursive: true, force: true });
    }
  }

  async complete({ date, claimId, result }) {
    if (!COMPLETION_RESULTS.has(result)) throw new Error("result must be published or no-edition");
    return this.#settle({ date, claimId, status: "completed", result });
  }

  async fail({ date, claimId, reason }) {
    if (!FAILURE_REASONS.has(reason)) throw new Error("failure reason is not allowed");
    return this.#settle({ date, claimId, status: "failed", reason });
  }

  async #settle({ date, claimId, status, ...details }) {
    const directory = this.directory(date);
    const transition = await this.#acquireTransition(date);
    try {
      const current = await this.#ownedState({ directory, date, claimId });
      const settledAt = this.now().toISOString();
      const state = {
        date,
        status,
        owner: current.owner,
        attempt: current.attempt,
        claimId: current.claimId,
        claimedAt: current.claimedAt,
        [`${status === "completed" ? "completed" : "failed"}At`]: settledAt,
        ...details,
      };
      await writeState(directory, state);
      return publicState(state, this.now());
    } finally {
      await rm(transition, { recursive: true, force: true });
    }
  }

  async #ownedState({ directory, date, claimId }) {
    const current = await readState(directory);
    if (!current || current.status !== "active" || current.claimId !== claimId) {
      throw new Error(`The private claim does not own the ${date} publication gate`);
    }
    if (Date.parse(current.expiresAt) <= this.now().getTime()) {
      throw new Error(`The private claim for ${date} has expired`);
    }
    return current;
  }

  async #acquireTransition(date) {
    const transition = path.join(this.rootDirectory, `.${date}.transition`);
    for (;;) {
      try {
        await mkdir(transition, { mode: 0o700 });
        return transition;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const metadata = await stat(transition).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
      if (metadata && Date.now() - metadata.mtimeMs >= TRANSITION_STALE_MS) {
        await rm(transition, { recursive: true, force: true });
      } else {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }
}
