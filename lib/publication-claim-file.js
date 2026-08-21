import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLAIM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function writePrivateClaimFile(file, { date, claimId }) {
  if (!path.isAbsolute(file)) throw new Error("Claim file path must be absolute");
  if (!DATE_PATTERN.test(date) || !CLAIM_ID_PATTERN.test(claimId)) throw new Error("Claim file identity is invalid");
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, date, claimId })}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
}

export async function readPrivateClaimFile(file, date) {
  if (!path.isAbsolute(file)) throw new Error("Claim file path must be absolute");
  const metadata = await stat(file).catch((error) => {
    throw new Error("Private claim file is unavailable", { cause: error });
  });
  if ((metadata.mode & 0o077) !== 0) throw new Error("Private claim file permissions must be 0600");
  let claim;
  try { claim = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { throw new Error("Private claim file is invalid", { cause: error }); }
  if (claim?.schemaVersion !== 1 || claim.date !== date || !CLAIM_ID_PATTERN.test(claim.claimId ?? "")) {
    throw new Error("Private claim file identity is invalid");
  }
  return claim.claimId;
}
