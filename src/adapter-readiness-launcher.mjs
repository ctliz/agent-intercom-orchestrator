#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const harnessIndex = args.indexOf("--harness");
const separator = args.indexOf("--");
const harness = harnessIndex >= 0 ? args[harnessIndex + 1] : undefined;
const commandArgs = separator >= 0 ? args.slice(separator + 1) : [];
const [command, ...childArgs] = commandArgs;
if (!command || (harness !== "codex" && harness !== "claude")) {
  process.stderr.write("adapter-readiness-launcher requires --harness codex|claude -- command [args...]\n");
  process.exit(2);
}

const healthPath = process.env.AGENT_INTERCOM_ADAPTER_HEALTH_PATH?.trim();
const runId = process.env.AGENT_INTERCOM_RUN_ID?.trim();
const workerId = process.env.AGENT_INTERCOM_WORKER_ID?.trim();
if (!healthPath || !runId || !workerId) {
  process.stderr.write("adapter-readiness-launcher requires health path, run ID, and worker ID\n");
  process.exit(2);
}

async function writeHealth(value) {
  await mkdir(dirname(healthPath), { recursive: true, mode: 0o700 });
  const temporary = `${healthPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, runId, workerId, harness, updatedAt: Date.now(), ...value }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, healthPath);
}

const marker = harness === "codex"
  ? /codex-intercom bridge running \d+ virtual agent\(s\)/
  : /claude-intercom worker running \d+ agent\(s\)/;
const child = spawn(command, childArgs, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});
child.stdout.pipe(process.stdout);
let stderrBuffer = "";
let ready = false;
let healthWrite;
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  if (ready) return;
  stderrBuffer = `${stderrBuffer}${chunk.toString("utf8")}`.slice(-4096);
  if (!marker.test(stderrBuffer)) return;
  ready = true;
  healthWrite = writeHealth({ ready: true, connected: true, pid: child.pid, status: "idle" }).catch((error) => {
    process.stderr.write(`Could not write ${harness} readiness health: ${error instanceof Error ? error.message : String(error)}\n`);
    ready = false;
    child.kill("SIGTERM");
  });
});

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  timer.unref?.();
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop("SIGINT"));
child.on("error", (error) => {
  healthWrite = writeHealth({ ready: false, connected: false, error: `Could not start ${harness} adapter: ${error.message}` });
  void healthWrite.finally(() => process.exit(1));
});
child.on("exit", (code, signal) => {
  const exitCode = stopping ? 0 : (code ?? (signal === "SIGINT" ? 130 : signal ? 1 : 0));
  const settle = ready || stopping
    ? healthWrite ?? Promise.resolve()
    : writeHealth({ ready: false, connected: false, error: `${harness} adapter exited before readiness (${code ?? signal ?? "unknown"})` });
  void settle.then(() => process.exit(exitCode || (ready || stopping ? 0 : 1)), () => process.exit(1));
});
