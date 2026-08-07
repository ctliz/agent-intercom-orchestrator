import { setTimeout as delay } from "node:timers/promises";
import type { TrustedLocalBossAssignmentRole, TrustedLocalBossPausedTimer, TrustedLocalBossRun } from "./boss-trusted-local.ts";
import type { WorkerStore } from "./store.ts";
import { getUnitStatus } from "./systemd.ts";
import type { CommandRunner, UnitStatus, WorkerRecord, WorkerStateFile } from "./types.ts";
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
export function validatePersistedBossSystemdPauseTargets(run: TrustedLocalBossRun, workers: readonly WorkerRecord[], targets: readonly BossSystemdPauseTarget[]): void {
  for (const target of targets) {
    const worker = workers.find((candidate) => candidate.id === target.workerId && workerIncarnation(candidate) === target.workerIncarnationId);
    if (!worker) throw new Error(`Boss ${target.role} exact WorkerStore incarnation changed during pause reconciliation`);
    if (!worker.owned || worker.bossRunId !== run.bossRunId || worker.managerSessionId !== run.managerSessionId
      || worker.backend !== "systemd" || worker.unit !== target.unit || !isLiveState(worker.state)) {
      throw new Error(`Boss ${target.role} exact owned live systemd identity changed during pause reconciliation`);
    }
    if (!target.expectedMainPid || worker.mainPid !== target.expectedMainPid) {
      throw new Error(`Boss ${target.role} main PID changed during pause reconciliation`);
    }
  }
}

export async function verifyAcceptedBossSystemdPause(
  runner: CommandRunner,
  run: TrustedLocalBossRun,
  workers: readonly WorkerRecord[],
): Promise<void> {
  if (!run.currentPause) throw new Error("Boss accepted pause projection is unavailable");
  const targets: BossSystemdPauseTarget[] = run.currentPause.targets.map((target) => ({ ...target, expectedMainPid: target.mainPid }));
  validatePersistedBossSystemdPauseTargets(run, workers, targets);
  for (const target of targets) {
    const status = await getUnitStatus(runner, target.unit);
    assertExactLiveUnit(status, target.unit, target.expectedMainPid);
    if (status.freezerState !== "frozen") throw new Error(`Boss unit ${target.unit} accepted pause drifted to FreezerState=${status.freezerState ?? "unknown"}`);
  }
}

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

/** Best-effort recovery control used after an interrupted transaction. It never reverses successful recovery work. */
export async function recoverBossSystemdPauseTargets(
  runner: CommandRunner,
  targets: readonly BossSystemdPauseTarget[],
  expected: BossUnitFreezerState,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string[]> {
  const failures: string[] = [];
  for (const target of targets) {
    try { await setBossUnitFreezerState(runner, target, expected, options); }
    catch (error) { failures.push(`${target.unit}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return failures;
}

/** Apply every target in order and compensate already-changed units in reverse on failure. */
export async function applyBossSystemdPausePlan(
  runner: CommandRunner,
  targets: readonly BossSystemdPauseTarget[],
  expected: BossUnitFreezerState,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<UnitStatus[]> {
  const changed: BossSystemdPauseTarget[] = [];
  const statuses: UnitStatus[] = [];
  try {
    for (const target of targets) {
      const before = await getUnitStatus(runner, target.unit);
      const alreadyExpected = before.freezerState === expected;
      statuses.push(await setBossUnitFreezerState(runner, target, expected, options));
      if (!alreadyExpected) changed.push(target);
    }
    return statuses;
  } catch (error) {
    const compensationErrors: string[] = [];
    const compensationState: BossUnitFreezerState = expected === "frozen" ? "running" : "frozen";
    for (const target of changed.reverse()) {
      try { await setBossUnitFreezerState(runner, target, compensationState, options); }
      catch (compensationError) { compensationErrors.push(`${target.unit}: ${compensationError instanceof Error ? compensationError.message : String(compensationError)}`); }
    }
    const original = error instanceof Error ? error.message : String(error);
    if (compensationErrors.length) throw new Error(`Boss cgroup ${expected} failed: ${original}; compensation incomplete: ${compensationErrors.join("; ")}`);
    throw new Error(`Boss cgroup ${expected} failed and prior unit changes were compensated: ${original}`);
  }
}

const SUSPENDED_DEADLINE = 8_640_000_000_000_000 - 1;

export function captureBossPausedTimers(
  state: WorkerStateFile,
  targets: readonly BossSystemdPauseTarget[],
  now: number,
  checkpointRetryIntervalMs: number,
): TrustedLocalBossPausedTimer[] {
  return targets.map((target) => {
    const worker = state.workers.find((candidate) => candidate.id === target.workerId && workerIncarnation(candidate) === target.workerIncarnationId);
    if (!worker || !worker.owned || worker.unit !== target.unit || worker.bossRunId === undefined) throw new Error(`Boss worker ${target.workerId} exact timer identity is unavailable`);
    const remaining = (value: number | undefined): number | null => value === undefined ? null : Math.max(0, value - now);
    return {
      workerId: worker.id,
      workerIncarnationId: workerIncarnation(worker),
      leaseRemainingMs: Math.max(0, worker.leaseExpiresAt - now),
      idleRemainingMs: remaining(worker.idleDeadlineAt),
      checkpointRemainingMs: remaining(worker.checkpointDeadlineAt),
      checkpointRetryRemainingMs: worker.checkpointLastAttemptAt === undefined ? null : Math.max(0, worker.checkpointLastAttemptAt + checkpointRetryIntervalMs - now),
      checkpointRetryIntervalMs: worker.checkpointLastAttemptAt === undefined ? null : checkpointRetryIntervalMs,
    };
  });
}

function exactTimerWorker(state: WorkerStateFile, timer: TrustedLocalBossPausedTimer): WorkerRecord {
  const worker = state.workers.find((candidate) => candidate.id === timer.workerId && workerIncarnation(candidate) === timer.workerIncarnationId);
  if (!worker || !worker.owned) throw new Error(`Boss worker ${timer.workerId} exact timer identity changed`);
  return worker;
}

/** Fence WorkerStore lifecycle timers while systemd units are frozen. */
export async function suspendBossWorkerTimers(store: WorkerStore, timers: readonly TrustedLocalBossPausedTimer[], now: number): Promise<void> {
  await store.mutate((state) => {
    for (const timer of timers) {
      const worker = exactTimerWorker(state, timer);
      worker.leaseExpiresAt = SUSPENDED_DEADLINE;
      if (timer.idleRemainingMs !== null) worker.idleDeadlineAt = SUSPENDED_DEADLINE;
      if (timer.checkpointRemainingMs !== null) worker.checkpointDeadlineAt = SUSPENDED_DEADLINE;
      if (timer.checkpointRetryRemainingMs !== null) worker.checkpointLastAttemptAt = SUSPENDED_DEADLINE;
      worker.updatedAt = Math.max(worker.updatedAt, now);
    }
  });
}

/** Restore each lifecycle deadline relative to the verified thaw completion time. */
export async function restoreBossWorkerTimers(store: WorkerStore, timers: readonly TrustedLocalBossPausedTimer[], now: number): Promise<void> {
  await store.mutate((state) => {
    for (const timer of timers) {
      const worker = exactTimerWorker(state, timer);
      worker.leaseExpiresAt = now + timer.leaseRemainingMs;
      if (timer.idleRemainingMs !== null) worker.idleDeadlineAt = now + timer.idleRemainingMs;
      if (timer.checkpointRemainingMs !== null) worker.checkpointDeadlineAt = now + timer.checkpointRemainingMs;
      if (timer.checkpointRetryRemainingMs !== null && timer.checkpointRetryIntervalMs !== null) worker.checkpointLastAttemptAt = now + timer.checkpointRetryRemainingMs - timer.checkpointRetryIntervalMs;
      worker.updatedAt = Math.max(worker.updatedAt, now);
    }
  });
}
