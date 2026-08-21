import { spawn } from "node:child_process";

const ACCOUNTS = Object.freeze(["FEEDBACK_SUMMARY_URL", "REGISTER_EDITION_URL", "CURATOR_TOKEN"]);
const KEYCHAIN_SERVICE = "today-i-found.curator";

export function createKeychainReader({ securityPath = "/usr/bin/security" } = {}) {
  return function readSecret(account) {
    if (!ACCOUNTS.includes(account)) throw new Error("Unsupported Keychain account");
    return new Promise((resolve, reject) => {
      const child = spawn(securityPath, [
        "find-generic-password",
        "-w",
        "-s", KEYCHAIN_SERVICE,
        "-a", account,
      ], { stdio: ["ignore", "pipe", "ignore"] });
      let value = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { value += chunk; });
      child.once("error", () => reject(new Error("Keychain credential lookup failed")));
      child.once("close", (code) => code === 0
        ? resolve(value.replace(/[\r\n]+$/, ""))
        : reject(new Error("Keychain credential lookup failed")));
    });
  };
}

function validHttpsUrl(value) {
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}

export async function loadWatchdogCredentials({ feedbackEnabled, readSecret = createKeychainReader() }) {
  if (!feedbackEnabled) return {};
  let entries;
  try {
    entries = await Promise.all(ACCOUNTS.map(async (account) => [account, await readSecret(account)]));
  } catch {
    throw new Error("Feedback is enabled but required Keychain credentials are unavailable");
  }
  const credentials = Object.fromEntries(entries);
  if (!validHttpsUrl(credentials.FEEDBACK_SUMMARY_URL)
    || !validHttpsUrl(credentials.REGISTER_EDITION_URL)
    || !credentials.CURATOR_TOKEN?.trim()) {
    throw new Error("Feedback is enabled but required Keychain credentials are unavailable");
  }
  return credentials;
}
