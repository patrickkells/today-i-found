import path from "node:path";
import { createOriginPolicy } from "../report-companion/security.js";

const LABELS = {
  companion: "com.today-i-found.report-companion",
  watchdog: "com.today-i-found.publication-watchdog",
};

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function string(value) {
  return `    <string>${xml(value)}</string>`;
}

function plist({ label, arguments: programArguments, projectRoot, stdoutPath, stderrPath, environment, companion = false }) {
  const keepAlive = companion
    ? `\n  <key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>`
    : `\n  <key>StartInterval</key>\n  <integer>900</integer>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
${string(label)}
  <key>ProgramArguments</key>
  <array>
${programArguments.map(string).join("\n")}
  </array>
  <key>WorkingDirectory</key>
${string(projectRoot)}
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(environment).map(([key, value]) => `    <key>${xml(key)}</key>\n${string(value)}`).join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>${keepAlive}
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
${string(stdoutPath)}
  <key>StandardErrorPath</key>
${string(stderrPath)}
</dict>
</plist>
`;
}

export function launchAgentPlan({ homeDirectory, projectRoot, nodePath, packageManagerPath, codexPath, productionOrigin, uid, feedbackEnabled = false }) {
  if (![homeDirectory, projectRoot, nodePath, packageManagerPath, codexPath].every((value) => path.isAbsolute(value ?? ""))) {
    throw new Error("LaunchAgent home, project, Node, package manager, and Codex paths must be absolute");
  }
  const exactProductionOrigin = createOriginPolicy(productionOrigin).productionOrigin;
  if (!exactProductionOrigin) throw new Error("A dedicated production origin is required");
  const searchPath = [...new Set([
    path.dirname(nodePath),
    path.dirname(packageManagerPath),
    path.dirname(codexPath),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ])].join(":");
  const baseEnvironment = {
    PATH: searchPath,
    TODAY_I_FOUND_NODE_PATH: nodePath,
    TODAY_I_FOUND_PACKAGE_MANAGER_PATH: packageManagerPath,
    CODEX_PATH: codexPath,
  };
  const launchAgentsDirectory = path.join(homeDirectory, "Library", "LaunchAgents");
  const logDirectory = path.join(homeDirectory, "Library", "Logs", "today-i-found");
  const agents = [
    {
      label: LABELS.companion,
      file: path.join(launchAgentsDirectory, `${LABELS.companion}.plist`),
      contents: plist({
        label: LABELS.companion,
        arguments: [nodePath, path.join(projectRoot, "report-companion", "cli.js")],
        projectRoot,
        stdoutPath: path.join(logDirectory, "report-companion.log"),
        stderrPath: path.join(logDirectory, "report-companion.error.log"),
        environment: {
          ...baseEnvironment,
          TODAY_I_FOUND_PRODUCTION_ORIGIN: exactProductionOrigin,
        },
        companion: true,
      }),
    },
    {
      label: LABELS.watchdog,
      file: path.join(launchAgentsDirectory, `${LABELS.watchdog}.plist`),
      contents: plist({
        label: LABELS.watchdog,
        arguments: [nodePath, path.join(projectRoot, "scripts", "publication-watchdog.mjs")],
        projectRoot,
        stdoutPath: path.join(logDirectory, "publication-watchdog.log"),
        stderrPath: path.join(logDirectory, "publication-watchdog.error.log"),
        environment: {
          ...baseEnvironment,
          TODAY_I_FOUND_FEEDBACK_ENABLED: feedbackEnabled ? "1" : "0",
        },
      }),
    },
  ];
  return { domain: `gui/${uid}`, launchAgentsDirectory, logDirectory, agents };
}
