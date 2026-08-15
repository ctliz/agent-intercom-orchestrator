#!/usr/bin/env node
const separator = process.argv.indexOf("--");
const commandArgs = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);
const [command, ...args] = commandArgs;
if (!command) {
  process.stderr.write("identity-env-launcher requires a command after --\n");
  process.exit(2);
}

const explicitAllowed = new Set();
for (const key of (process.env.AGENT_INTERCOM_ENV_ALLOWLIST || "").split(",")) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) explicitAllowed.add(key);
}

function isIdentityKey(key) {
  if (key.startsWith("AGENT_INTERCOM_")) return true;
  if (key.startsWith("TMUXDECK_")) return true;
  if (key.startsWith("PI_INTERCOM_") || key.startsWith("PI_SUBAGENT_INTERCOM_") || key === "PI_SESSION_ID") return true;
  if (key.startsWith("CLAUDE_INTERCOM_") || key.startsWith("CLAUDE_PEER_") || key === "CLAUDE_SESSION_ID") return true;
  if (key.startsWith("CODEX_INTERCOM_") || key.startsWith("CODEX_PEER_") || key === "CODEX_SESSION_ID") return true;
  if (key.startsWith("OPENCODE_INTERCOM_") || key.startsWith("OPENCODE_PEER_") || key === "OPENCODE_SESSION_ID") return true;
  return false;
}

const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (isIdentityKey(key) && !explicitAllowed.has(key)) {
    delete environment[key];
  }
}
delete environment.AGENT_INTERCOM_ENV_ALLOWLIST;

try {
  process.execve(command, [command, ...args], environment);
} catch (error) {
  process.stderr.write(`Could not exec ${command} with clean identity environment: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(127);
}
