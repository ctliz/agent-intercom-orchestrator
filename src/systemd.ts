import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CommandRunner, LaunchProfile, UnitStatus } from "./types.ts";
import { expandHome, resolveProfileCommand } from "./config.ts";

let workerUnitMutationGeneration = 0;

export function getWorkerUnitMutationGeneration(): number {
  return workerUnitMutationGeneration;
}

function markWorkerUnitMutation(): void {
  workerUnitMutationGeneration += 1;
}

export function sanitizeUnitPart(value: string, fallback = "worker"): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized || fallback;
}

export function makeUnitName(workerId: string, runId: string): string {
  return `agent-intercom-worker-${sanitizeUnitPart(workerId)}-${sanitizeUnitPart(runId).slice(0, 12)}.service`;
}

export function parseDurationToSeconds(value: string): number {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "infinity") return Number.POSITIVE_INFINITY;
  const units: Record<string, number> = {
    us: 0.000001,
    ms: 0.001,
    s: 1,
    min: 60,
    h: 3600,
    d: 86400,
    w: 604800,
    month: 2629800,
    year: 31557600,
  };
  const pattern = /(\d+(?:\.\d+)?)\s*(us|ms|s|min|h|d|w|month|year)/gy;
  let total = 0;
  let offset = 0;
  while (offset < trimmed.length) {
    while (/\s/.test(trimmed[offset] || "")) offset += 1;
    pattern.lastIndex = offset;
    const match = pattern.exec(trimmed);
    if (!match) throw new Error(`Invalid systemd duration: ${value}`);
    total += Number(match[1]) * units[match[2]];
    offset = pattern.lastIndex;
  }
  if (!Number.isFinite(total) || total <= 0) throw new Error(`Invalid systemd duration: ${value}`);
  return total;
}

function parseSystemctlShow(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return index < 0 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

export type UserManagerHealth = {
  responsive: boolean;
  settled?: boolean;
  jobCount?: number;
  jobs?: string[];
  persistentJobs?: string[];
  error?: string;
};

export async function getUserManagerHealth(
  runner: CommandRunner,
  options: { settleMs?: number } = {},
): Promise<UserManagerHealth> {
  const readJobs = async (): Promise<{ jobs?: string[]; error?: string }> => {
    const result = await runner.exec(
      "systemctl",
      ["--user", "list-jobs", "--no-legend", "--no-pager", "--plain"],
      { timeout: 5000 },
    );
    if (result.killed) return { error: "systemctl list-jobs timed out" };
    if (result.code !== 0) return { error: result.stderr.trim() || result.stdout.trim() || `systemctl list-jobs exited ${result.code}` };
    return { jobs: result.stdout.split("\n").map((line) => line.trim()).filter(Boolean) };
  };
  const first = await readJobs();
  if (!first.jobs) return { responsive: false, error: first.error };
  if (first.jobs.length === 0) return { responsive: true, settled: true, jobCount: 0, jobs: [] };
  await delay(options.settleMs ?? 250);
  const second = await readJobs();
  if (!second.jobs) return { responsive: false, error: second.error, jobCount: first.jobs.length, jobs: first.jobs };
  const secondIds = new Set(second.jobs.map((line) => line.split(/\s+/, 1)[0]));
  const persistentJobs = first.jobs.filter((line) => secondIds.has(line.split(/\s+/, 1)[0]));
  return {
    responsive: true,
    settled: persistentJobs.length === 0,
    jobCount: second.jobs.length,
    jobs: second.jobs,
    ...(persistentJobs.length ? { persistentJobs } : {}),
  };
}

export async function systemdAvailable(runner: CommandRunner): Promise<boolean> {
  const result = await runner.exec("systemctl", ["--user", "show-environment"], { timeout: 5000 });
  if (result.killed || result.code !== 0) return false;
  return (await getUserManagerHealth(runner)).responsive;
}

export async function resolveLaunchCommand(profile: LaunchProfile): Promise<string> {
  const expanded = expandHome(profile.command);
  const resolved = resolveProfileCommand(expanded);
  if (!resolved) throw new Error(`Profile command not found or not executable: ${profile.command}`);
  await access(resolved, fsConstants.X_OK);
  return resolved;
}

export interface LaunchUnitInput {
  unit: string;
  profile: LaunchProfile;
  args: string[];
  cwd: string;
  maxRuntime: string;
  stopTimeoutSeconds: number;
  environment?: Record<string, string>;
  properties?: string[];
}

export async function launchUnit(runner: CommandRunner, input: LaunchUnitInput): Promise<void> {
  markWorkerUnitMutation();
  const executable = await resolveLaunchCommand(input.profile);
  const unitBase = input.unit.endsWith(".service") ? input.unit.slice(0, -8) : input.unit;
  const environment: Record<string, string> = {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.PI_CODING_AGENT_DIR ? { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR } : {}),
    ...(input.profile.env ?? {}),
    ...(input.environment ?? {}),
  };
  const args = [
    "--user",
    `--unit=${unitBase}`,
    `--working-directory=${input.cwd}`,
    "--property=KillMode=control-group",
    `--property=TimeoutStopSec=${Math.max(1, Math.floor(input.stopTimeoutSeconds))}s`,
    `--property=RuntimeMaxSec=${input.maxRuntime}`,
    "--property=StandardOutput=journal",
    "--property=StandardError=journal",
  ];
  for (const property of input.properties ?? []) {
    if (!property.includes("=") || property.includes("\0") || property.includes("\n")) continue;
    args.push(`--property=${property}`);
  }
  if (input.profile.mode === "one-shot") args.push("--property=RemainAfterExit=yes");
  for (const [key, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.includes("\0")) continue;
    args.push(`--setenv=${key}=${value}`);
  }
  args.push(executable, ...input.args);
  // Submission and readiness are separate phases. --no-block prevents a
  // wedged user manager from holding this process indefinitely; callers must
  // subsequently prove that the queued job completed and the unit is running.
  args.splice(1, 0, "--no-block");
  const result = await runner.exec("systemd-run", args, { timeout: 15000 });
  if (result.killed) {
    throw new Error(`Could not determine whether ${input.unit} was submitted: systemd-run timed out`);
  }
  if (result.code !== 0) {
    throw new Error(`Could not start ${input.unit}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
  }
}

export async function getUnitStatus(runner: CommandRunner, unit: string): Promise<UnitStatus> {
  const result = await runner.exec(
    "systemctl",
    [
      "--user",
      "show",
      unit,
      "--no-pager",
      "--property=LoadState,ActiveState,SubState,MainPID,Result,ExecMainStatus,Job,FreezerState,ActiveEnterTimestampMonotonic,InactiveEnterTimestampMonotonic,ExecMainStartTimestampMonotonic",
    ],
    { timeout: 5000 },
  );
  const values = parseSystemctlShow(result.stdout);
  if (result.killed) {
    return { verified: false, exists: values.LoadState !== "not-found", error: "systemctl show timed out" };
  }
  if (result.code !== 0 && values.LoadState !== "not-found") {
    return {
      verified: false,
      exists: false,
      error: result.stderr.trim() || result.stdout.trim() || `systemctl show exited ${result.code}`,
    };
  }
  const numeric = (value: string | undefined): number | undefined => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  };
  const mainPid = numeric(values.MainPID);
  const execMainStatus = Number(values.ExecMainStatus);
  return {
    verified: true,
    exists: values.LoadState !== "not-found",
    activeState: values.ActiveState,
    subState: values.SubState,
    ...(mainPid ? { mainPid } : {}),
    ...(values.Result ? { result: values.Result } : {}),
    ...(Number.isInteger(execMainStatus) ? { execMainStatus } : {}),
    ...(values.Job ? { job: values.Job } : {}),
    ...(values.FreezerState ? { freezerState: values.FreezerState } : {}),
    ...(numeric(values.ActiveEnterTimestampMonotonic) ? { activeEnterTimestampMonotonic: numeric(values.ActiveEnterTimestampMonotonic) } : {}),
    ...(numeric(values.InactiveEnterTimestampMonotonic) ? { inactiveEnterTimestampMonotonic: numeric(values.InactiveEnterTimestampMonotonic) } : {}),
    ...(numeric(values.ExecMainStartTimestampMonotonic) ? { execMainStartTimestampMonotonic: numeric(values.ExecMainStartTimestampMonotonic) } : {}),
  };
}

export function formatUnitStatus(status: UnitStatus): string {
  const fields = [
    `verified=${status.verified !== false}`,
    `exists=${status.exists}`,
    `state=${status.activeState ?? "unknown"}/${status.subState ?? "unknown"}`,
    `pid=${status.mainPid ?? 0}`,
    `job=${status.job || "none"}`,
  ];
  if (status.result) fields.push(`result=${status.result}`);
  if (status.execMainStatus !== undefined) fields.push(`exit=${status.execMainStatus}`);
  if (status.error) fields.push(`error=${status.error}`);
  return fields.join(" ");
}

export async function waitForUnitRunning(
  runner: CommandRunner,
  unit: string,
  options: { timeoutMs?: number; intervalMs?: number; stableMs?: number } = {},
): Promise<UnitStatus> {
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  const stableMs = options.stableMs ?? 750;
  let runningSince: number | undefined;
  let runningPid: number | undefined;
  let last: UnitStatus = { verified: false, exists: false, error: "no status observed" };
  while (Date.now() < deadline) {
    last = await getUnitStatus(runner, unit);
    if (last.verified !== false && !last.job && last.exists && last.activeState === "active" && Boolean(last.mainPid)) {
      if (runningPid !== last.mainPid) {
        runningPid = last.mainPid;
        runningSince = Date.now();
      }
      if (Date.now() - runningSince! >= stableMs) return last;
    } else {
      runningPid = undefined;
      runningSince = undefined;
    }
    if (last.verified !== false && !last.job && last.exists
      && (last.activeState === "failed" || (last.result && last.result !== "success"))) {
      throw new Error(`Worker unit ${unit} failed before readiness (${formatUnitStatus(last)})`);
    }
    await delay(options.intervalMs ?? 100);
  }
  throw new Error(`Timed out waiting for worker unit ${unit} to run (${formatUnitStatus(last)})`);
}

export async function readUnitProcessTree(runner: CommandRunner, unit: string): Promise<{ tree: string; pids: number[] }> {
  const result = await runner.exec("systemd-cgls", ["--user-unit", unit, "--no-pager", "--full"], { timeout: 5000 });
  if (result.code !== 0) return { tree: "", pids: [] };
  const pids = [...result.stdout.matchAll(/[├└]─(\d+)\s/g)].map((match) => Number(match[1])).filter((pid) => Number.isInteger(pid) && pid > 0);
  return { tree: result.stdout.trim(), pids: [...new Set(pids)] };
}

export async function verifyUnitAbsentAndEmpty(
  runner: CommandRunner,
  unit: string,
): Promise<{ absent: boolean; reason?: string }> {
  const status = await runner.exec(
    "systemctl",
    ["--user", "show", unit, "--no-pager", "--property=LoadState,ActiveState,SubState,MainPID"],
    { timeout: 5000 },
  );
  const values = parseSystemctlShow(status.stdout);
  if (values.LoadState !== "not-found") {
    if (status.code !== 0) {
      return { absent: false, reason: `could not verify unit state: ${status.stderr.trim() || `exit ${status.code}`}` };
    }
    return { absent: false, reason: `unit is still loaded (${values.ActiveState || "unknown"}/${values.SubState || "unknown"})` };
  }
  return verifyUnitCgroupEmpty(runner, unit);
}

export async function verifyUnitCgroupEmpty(
  runner: CommandRunner,
  unit: string,
): Promise<{ absent: boolean; reason?: string }> {
  const processes = await runner.exec("systemd-cgls", ["--user-unit", unit, "--no-pager", "--full"], { timeout: 5000 });
  if (processes.code === 0) {
    const pids = [...processes.stdout.matchAll(/[├└]─(\d+)\s/g)]
      .map((match) => Number(match[1]))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
    return pids.length
      ? { absent: false, reason: `unit cgroup still owns processes: ${[...new Set(pids)].join(", ")}` }
      : { absent: true };
  }
  const diagnostic = `${processes.stdout}\n${processes.stderr}`;
  if (/not found|not loaded|no such (?:file|process|unit)|does not exist/i.test(diagnostic)) return { absent: true };
  return { absent: false, reason: `could not verify unit cgroup absence: ${processes.stderr.trim() || `exit ${processes.code}`}` };
}

export async function stopUnit(
  runner: CommandRunner,
  unit: string,
  options: { timeoutMs?: number; intervalMs?: number; stableMs?: number } = {},
): Promise<void> {
  markWorkerUnitMutation();
  try {
    const result = await runner.exec("systemctl", ["--user", "stop", "--no-block", unit], { timeout: 15000 });
    const missing = /not loaded|not found/i.test(`${result.stdout}\n${result.stderr}`);
    if (!result.killed && result.code !== 0 && !missing) {
      throw new Error(`Could not stop ${unit}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
    }

    const deadline = Date.now() + (options.timeoutMs ?? 20_000);
    const stableMs = options.stableMs ?? 750;
    let conclusiveSince: number | undefined;
    let last: UnitStatus = { verified: false, exists: false, error: result.killed ? "systemctl stop timed out" : undefined };
    while (Date.now() < deadline) {
      last = await getUnitStatus(runner, unit);
      const conclusive = last.verified !== false && !last.job
        && (!last.exists || last.activeState === "inactive" || last.activeState === "failed");
      if (conclusive) {
        conclusiveSince ??= Date.now();
        if (Date.now() - conclusiveSince >= stableMs) break;
      } else {
        conclusiveSince = undefined;
      }
      await delay(options.intervalMs ?? 100);
    }
    if (last.verified === false || last.job
      || (last.exists && last.activeState !== "inactive" && last.activeState !== "failed")) {
      throw new Error(`Could not conclusively stop ${unit} (${formatUnitStatus(last)})`);
    }

    let remaining = await readUnitProcessTree(runner, unit);
    if (remaining.pids.length) {
      const killed = await runner.exec("systemctl", ["--user", "kill", "--kill-whom=all", "--signal=SIGKILL", unit], { timeout: 5000 });
      if (killed.killed) throw new Error(`Could not determine whether ${unit} descendants were killed: systemctl timed out`);
      remaining = await readUnitProcessTree(runner, unit);
    }
    if (remaining.pids.length) {
      throw new Error(`Worker unit ${unit} still owns processes after stop: ${remaining.pids.join(", ")}`);
    }
  } finally {
    await runner.exec("systemctl", ["--user", "reset-failed", unit], { timeout: 5000 }).catch(() => undefined);
  }
}

export async function listWorkerUnits(runner: CommandRunner): Promise<string[]> {
  const result = await runner.exec(
    "systemctl",
    ["--user", "list-units", "agent-intercom-worker-*", "--all", "--no-legend", "--no-pager", "--plain"],
    { timeout: 10000 },
  );
  if (result.code !== 0) return [];
  return result.stdout.split("\n").map((line) => line.trim().split(/\s+/, 1)[0]).filter(Boolean);
}

export async function listWorkerUnitsForVerification(
  runner: CommandRunner,
): Promise<{ verified: boolean; units: string[]; reason?: string }> {
  const result = await runner.exec(
    "systemctl",
    ["--user", "list-units", "agent-intercom-worker-*", "--all", "--no-legend", "--no-pager", "--plain"],
    { timeout: 10000 },
  );
  if (result.code !== 0) {
    return { verified: false, units: [], reason: result.stderr.trim() || `exit ${result.code}` };
  }
  return {
    verified: true,
    units: result.stdout.split("\n").map((line) => line.trim().split(/\s+/, 1)[0]).filter(Boolean),
  };
}

export async function readUnitLogs(runner: CommandRunner, unit: string, lines = 80): Promise<string> {
  const result = await runner.exec(
    "journalctl",
    ["--user", "--unit", unit, "--no-pager", "-n", String(Math.max(1, Math.min(Math.floor(lines), 500)))],
    { timeout: 10000 },
  );
  if (result.code !== 0) {
    throw new Error(`Could not read logs for ${unit}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
  }
  return result.stdout.trim() || `(no journal output for ${basename(unit)})`;
}
