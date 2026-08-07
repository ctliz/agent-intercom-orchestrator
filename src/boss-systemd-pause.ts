import { setTimeout as delay } from "node:timers/promises";
import type { TrustedLocalBossAssignmentRole, TrustedLocalBossRun } from "./boss-trusted-local.ts";
import { getUnitStatus } from "./systemd.ts";
import type { CommandRunner, UnitStatus, WorkerRecord } from "./types.ts";
import { isLiveState } from "./workers.ts";

export type BossFreezableRole = Exclude<TrustedLocalBossAssignmentRole, "manager">;
export type BossUnitFreezerState = "running" | "frozen";

export interface BossSystemdPauseTarget {
  role: BossFreezableRole;
  workerId: string;
  workerIncarnationId: string;
  unit: string;
  expectedMainPid?: number;
}

export interface BossSystemdPausePlan {
  targets: BossSystemdPauseTarget[];
  intentionallyUnfrozenManager: {
    workerId: string;
    workerIncarnationId: string;
    unit: string;
  } | null;
  terminalRoles: BossFreezableRole[];
}

function workerIncarnation(worker: WorkerRecord): string {
  return worker.workerIncarnationId ?? worker.runId;
}

function exactAssignedWorker(run: TrustedLocalBossRun, role: TrustedLocalBossAssignmentRole, workers: readonly WorkerRecord[]): WorkerRecord | null {
  const assignment = run.assignments.find((candidate) => candidate.role === role);
  if (!assignment || assignment.state !== "assigned" || !assignment.workerId || !assignment.workerIncarnationId) return null;
  const worker = workers.find((candidate) => candidate.id === assignment.workerId && workerIncarnation(candidate) === assignment.workerIncarnationId);
  if (!worker) throw new Error(`Boss ${role} exact WorkerStore incarnation is unavailable for pause control`);
  if (!worker.owned || worker.bossRunId !== run.bossRunId || worker.managerSessionId !== run.managerSessionId) {
    throw new Error(`Boss ${role} WorkerStore identity is not the exact owned run participant`);
  }
  if (worker.backend !== "systemd" || !worker.unit) throw new Error(`Boss ${role} participant is not attached to a controllable systemd unit`);
  return worker;
}

/**
 * Resolve the exact managed units eligible for Boss cgroup pause. The Manager is
 * deliberately validated and returned separately, but can never become a
 * freeze target: it must remain runnable while the Controller awaits it.
 */
export function resolveBossSystemdPausePlan(run: TrustedLocalBossRun, workers: readonly WorkerRecord[]): BossSystemdPausePlan {
  if (run.state !== "active" && run.state !== "paused") throw new Error(`Boss run ${run.bossRunId} is not controllable from ${run.state}`);
  const manager = exactAssignedWorker(run, "manager", workers);
  const intentionallyUnfrozenManager = manager && isLiveState(manager.state)
    ? { workerId: manager.id, workerIncarnationId: workerIncarnation(manager), unit: manager.unit! }
    : null;
  const targets: BossSystemdPauseTarget[] = [];
  const terminalRoles: BossFreezableRole[] = [];
  for (const role of ["worker", "scout", "adversary"] as const) {
    const assignment = run.assignments.find((candidate) => candidate.role === role);
    if (!assignment || assignment.state !== "assigned") continue;
    const worker = exactAssignedWorker(run, role, workers)!;
    if (!isLiveState(worker.state)) {
      terminalRoles.push(role);
      continue;
    }
    targets.push({
      role,
      workerId: worker.id,
      workerIncarnationId: workerIncarnation(worker),
      unit: worker.unit!,
      ...(worker.mainPid ? { expectedMainPid: worker.mainPid } : {}),
    });
  }
  return { targets, intentionallyUnfrozenManager, terminalRoles };
}

function assertExactLiveUnit(status: UnitStatus, unit: string, expectedMainPid?: number): void {
  if (status.verified === false) throw new Error(`Could not verify Boss unit ${unit}: ${status.error ?? "unknown systemd error"}`);
  if (!status.exists || status.activeState !== "active" || !status.mainPid || status.job) {
    throw new Error(`Boss unit ${unit} is not an exact settled live unit`);
  }
  if (expectedMainPid !== undefined && status.mainPid !== expectedMainPid) {
    throw new Error(`Boss unit ${unit} main PID changed from ${expectedMainPid} to ${status.mainPid}`);
  }
}

export async function waitForUnitFreezerState(
  runner: CommandRunner,
  unit: string,
  expected: BossUnitFreezerState,
  options: { timeoutMs?: number; intervalMs?: number; expectedMainPid?: number } = {},
): Promise<UnitStatus> {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  let last: UnitStatus = { verified: false, exists: false, error: "no status observed" };
  while (Date.now() < deadline) {
    last = await getUnitStatus(runner, unit);
    assertExactLiveUnit(last, unit, options.expectedMainPid);
    if (last.freezerState === expected) return last;
    if (last.freezerState !== "freezing" && last.freezerState !== "thawing" && last.freezerState !== "running" && last.freezerState !== "frozen") {
      throw new Error(`Boss unit ${unit} returned unavailable or unsupported FreezerState=${last.freezerState ?? "unknown"}`);
    }
    await delay(options.intervalMs ?? 50);
  }
  throw new Error(`Timed out waiting for Boss unit ${unit} FreezerState=${expected}; observed ${last.freezerState ?? "unknown"}`);
}

/** Apply one bounded systemd cgroup freeze/thaw and prove its resulting state. */
export async function setBossUnitFreezerState(
  runner: CommandRunner,
  target: Pick<BossSystemdPauseTarget, "unit" | "expectedMainPid">,
  expected: BossUnitFreezerState,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<UnitStatus> {
  const before = await getUnitStatus(runner, target.unit);
  assertExactLiveUnit(before, target.unit, target.expectedMainPid);
  if (before.freezerState === expected) return before;
  if (before.freezerState !== (expected === "frozen" ? "running" : "frozen")) {
    throw new Error(`Boss unit ${target.unit} cannot transition from FreezerState=${before.freezerState ?? "unknown"}`);
  }
  const action = expected === "frozen" ? "freeze" : "thaw";
  const result = await runner.exec("systemctl", ["--user", action, target.unit], { timeout: options.timeoutMs ?? 5_000 });
  if (result.killed) throw new Error(`Could not determine whether Boss unit ${target.unit} was ${action}d: systemctl timed out`);
  if (result.code !== 0) throw new Error(`Could not ${action} Boss unit ${target.unit}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
  return waitForUnitFreezerState(runner, target.unit, expected, { ...options, expectedMainPid: target.expectedMainPid });
}
