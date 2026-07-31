import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { WorkerStore } from "./store.ts";
import {
  getWorkerUnitMutationGeneration,
  listWorkerUnitsForVerification,
  sanitizeUnitPart,
  stopUnit,
  verifyUnitAbsentAndEmpty,
  verifyUnitCgroupEmpty,
} from "./systemd.ts";
import type { CommandRunner, OrchestratorConfig, RuntimeCleanupClaim, WorkerRecord, WorkerStateFile } from "./types.ts";
import { workerRuntimeRoot } from "./runtime.ts";
import { isTerminalState, validateWorkerId } from "./workers.ts";

export const TERMINAL_CACHE_PATHS = [
  ["home", ".cache", "npm"],
  ["home", ".cache", "node-gyp"],
  ["home", ".cache", "pip"],
  ["home", ".cache", "uv"],
  ["home", ".cache", "pnpm"],
  ["home", ".local", "share", "pnpm", "store"],
] as const;

export const CLEANUP_UNIT_INVENTORY_MAX_AGE_MS = 5_000;
export const CLEANUP_UNIT_INVENTORY_CHUNK_SIZE = 100;

export type CleanupUnitInventory = {
  verified: boolean;
  units: ReadonlySet<string>;
  capturedAt: number;
  generation: number;
  reason?: string;
};

export async function captureCleanupUnitInventory(
  runner: CommandRunner,
  now: () => number = Date.now,
): Promise<CleanupUnitInventory> {
  const generation = getWorkerUnitMutationGeneration();
  const loaded = await listWorkerUnitsForVerification(runner);
  const capturedAt = now();
  const currentGeneration = getWorkerUnitMutationGeneration();
  if (generation !== currentGeneration) {
    return {
      verified: false,
      units: new Set<string>(),
      capturedAt,
      generation: currentGeneration,
      reason: "worker unit state changed during inventory capture",
    };
  }
  return {
    verified: loaded.verified,
    units: new Set(loaded.units),
    capturedAt,
    generation,
    ...(loaded.reason ? { reason: loaded.reason } : {}),
  };
}

export function cleanupUnitInventoryIsUsable(
  inventory: CleanupUnitInventory,
  now = Date.now(),
): boolean {
  return inventory.verified
    && inventory.generation === getWorkerUnitMutationGeneration()
    && now >= inventory.capturedAt
    && now - inventory.capturedAt <= CLEANUP_UNIT_INVENTORY_MAX_AGE_MS;
}

export function cleanupInventoryProvesPrefixAbsent(
  inventory: CleanupUnitInventory,
  workerId: string,
  now = Date.now(),
): boolean {
  if (!cleanupUnitInventoryIsUsable(inventory, now)) return false;
  const prefix = `agent-intercom-worker-${sanitizeUnitPart(workerId)}-`;
  for (const unit of inventory.units) {
    if (unit.startsWith(prefix)) return false;
  }
  return true;
}

export function terminalWorkerAt(worker: WorkerRecord): number | undefined {
  if (!worker.owned || !isTerminalState(worker.state)) return undefined;
  return worker.stoppedAt ?? worker.updatedAt;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function terminalCachePaths(workerId: string, agentDir: string): string[] {
  validateWorkerId(workerId);
  const root = workerRuntimeRoot(workerId, agentDir);
  return TERMINAL_CACHE_PATHS.map((parts) => join(root, ...parts));
}

export function fullRuntimePaths(workerId: string, agentDir: string): string[] {
  validateWorkerId(workerId);
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  return [
    workerRuntimeRoot(workerId, agentDir),
    join(orchestrator, "opencode-peers", `${workerId}.health.json`),
    join(orchestrator, "opencode-peers", `${workerId}.state.json`),
  ];
}

async function assertContainedPath(base: string, path: string): Promise<void> {
  const relativePath = relative(base, path);
  if (!relativePath || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`Cleanup path escapes its runtime root: ${path}`);
  }
  const baseInfo = await lstat(base);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new Error(`Cleanup root is not a real directory: ${base}`);
  const parts = relativePath.split(/[\\/]+/).slice(0, -1);
  let current = base;
  for (const part of parts) {
    current = join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Cleanup path has a symlink or non-directory ancestor: ${current}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function existingContainedPaths(entries: Array<{ base: string; path: string }>): Promise<string[]> {
  const existing: string[] = [];
  for (const entry of entries) {
    try {
      await assertContainedPath(entry.base, entry.path);
      await lstat(entry.path);
      existing.push(entry.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return existing;
}

export async function existingTerminalCachePaths(workerId: string, agentDir: string): Promise<string[]> {
  const root = workerRuntimeRoot(workerId, agentDir);
  return existingContainedPaths(terminalCachePaths(workerId, agentDir).map((path) => ({ base: root, path })));
}

export async function removeFullRuntimePathsSafely(
  workerId: string,
  agentDir: string,
  removePath: (path: string) => Promise<void> = async (path) => rm(path, { recursive: true, force: true }),
): Promise<void> {
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  const paths = fullRuntimePaths(workerId, agentDir);
  const entries = [
    { base: join(orchestrator, "worker-runtime"), path: paths[0] },
    { base: join(orchestrator, "opencode-peers"), path: paths[1] },
    { base: join(orchestrator, "opencode-peers"), path: paths[2] },
  ];
  for (const entry of entries) {
    try {
      await assertContainedPath(entry.base, entry.path);
      if (await pathExists(entry.path)) await removePath(entry.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function listRuntimeRoots(agentDir: string): Promise<Array<{ workerId: string; path: string }>> {
  const root = join(agentDir, "intercom", "orchestrator", "worker-runtime");
  try {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return [];
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).flatMap((entry) => {
      try {
        validateWorkerId(entry.name);
        return [{ workerId: entry.name, path: join(root, entry.name) }];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function executeCleanupCandidatesIsolated<T>(
  candidates: T[],
  execute: (candidate: T) => Promise<boolean>,
): Promise<{ executed: T[]; errors: Array<{ candidate: T; error: string }> }> {
  const executed: T[] = [];
  const errors: Array<{ candidate: T; error: string }> = [];
  for (const candidate of candidates) {
    try {
      if (await execute(candidate)) executed.push(candidate);
    } catch (error) {
      errors.push({ candidate, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { executed, errors };
}

function claims(state: WorkerStateFile): RuntimeCleanupClaim[] {
  return state.runtimeCleanupClaims ??= [];
}

function quarantineRoot(agentDir: string): string {
  return join(agentDir, "intercom", "orchestrator", "runtime-quarantine");
}

function quarantinePath(agentDir: string, token: string): string {
  if (!/^[A-Za-z0-9_.-]{1,200}$/.test(token)) throw new Error("Invalid runtime cleanup token");
  return join(quarantineRoot(agentDir), token);
}

async function prepareQuarantine(agentDir: string, token: string): Promise<string> {
  const intercom = join(agentDir, "intercom");
  const orchestrator = join(intercom, "orchestrator");
  for (const path of [intercom, orchestrator]) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Cleanup state path is not a real directory: ${path}`);
  }
  const root = quarantineRoot(agentDir);
  try {
    await mkdir(root, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error(`Cleanup quarantine is not a real directory: ${root}`);
  const path = quarantinePath(agentDir, token);
  await mkdir(path, { mode: 0o700 });
  return path;
}

function expectedEntries(claim: RuntimeCleanupClaim, agentDir: string): Array<{ base: string; path: string; index: number }> {
  validateWorkerId(claim.workerId);
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  if (claim.action === "orphan") return [{ base: join(orchestrator, "worker-runtime"), path: workerRuntimeRoot(claim.workerId, agentDir), index: 0 }];
  const paths = claim.action === "full" ? fullRuntimePaths(claim.workerId, agentDir) : terminalCachePaths(claim.workerId, agentDir);
  return paths.map((path, index) => ({
    path,
    index,
    base: claim.action === "cache" ? workerRuntimeRoot(claim.workerId, agentDir) : index === 0 ? join(orchestrator, "worker-runtime") : join(orchestrator, "opencode-peers"),
  }));
}

function selectedEntries(claim: RuntimeCleanupClaim, agentDir: string): Array<{ base: string; path: string; index: number; quarantine: string }> {
  const expected = expectedEntries(claim, agentDir);
  const indexes = new Set(claim.pathIndexes);
  if (indexes.size !== claim.pathIndexes.length || claim.pathIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= expected.length)) {
    throw new Error(`Invalid cleanup path mapping for ${claim.workerId}`);
  }
  return expected.filter((entry) => indexes.has(entry.index)).map((entry) => ({ ...entry, quarantine: join(quarantinePath(agentDir, claim.token), String(entry.index)) }));
}

async function unitPrefixIsClear(
  runner: CommandRunner,
  workerId: string,
  inventory?: CleanupUnitInventory,
  now = Date.now(),
): Promise<boolean> {
  if (inventory) return cleanupInventoryProvesPrefixAbsent(inventory, workerId, now);
  const loaded = await listWorkerUnitsForVerification(runner);
  if (!loaded.verified) return false;
  const prefix = `agent-intercom-worker-${sanitizeUnitPart(workerId)}-`;
  return !loaded.units.some((unit) => unit.startsWith(prefix));
}

async function recordedUnitIsAbsentAndEmpty(
  runner: CommandRunner,
  unit: string,
  inventory?: CleanupUnitInventory,
  now = Date.now(),
): Promise<boolean> {
  if (!inventory) return (await verifyUnitAbsentAndEmpty(runner, unit)).absent;
  if (!cleanupUnitInventoryIsUsable(inventory, now) || inventory.units.has(unit)) return false;
  return (await verifyUnitCgroupEmpty(runner, unit)).absent;
}

async function removeClaim(store: WorkerStore, token: string): Promise<void> {
  await store.mutateConditionally((state) => {
    const before = claims(state).length;
    state.runtimeCleanupClaims = claims(state).filter((claim) => claim.token !== token);
    return { value: undefined, changed: state.runtimeCleanupClaims.length !== before };
  });
}

async function finalizeClaim(store: WorkerStore, token: string): Promise<boolean> {
  return store.mutateConditionally((state) => {
    const claim = claims(state).find((candidate) => candidate.token === token);
    if (!claim || claim.phase !== "deleting") return { value: false, changed: false };
    if (claim.action === "full") {
      state.workers = state.workers.filter((worker) => worker.id !== claim.workerId || worker.runId !== claim.runId);
    }
    state.runtimeCleanupClaims = claims(state).filter((candidate) => candidate.token !== token);
    return { value: true, changed: true };
  });
}

async function recoverOneClaim(input: {
  store: WorkerStore;
  runner: CommandRunner;
  agentDir: string;
  claim: RuntimeCleanupClaim;
  force?: boolean;
  removePath: (path: string) => Promise<void>;
}): Promise<"restored" | "completed" | "blocked" | "gone"> {
  const current = (await input.store.read()).runtimeCleanupClaims?.find((claim) => claim.token === input.claim.token);
  if (!current) return "gone";
  if (!input.force && isProcessAlive(current.ownerPid)) return "blocked";
  const quarantine = quarantinePath(input.agentDir, current.token);

  if (current.phase === "claimed") {
    const entries = await readdir(quarantine).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
      throw error;
    });
    if (entries.length > 0) throw new Error(`Claimed cleanup quarantine is unexpectedly non-empty: ${quarantine}`);
    await input.removePath(quarantine);
    await removeClaim(input.store, current.token);
    return "restored";
  }

  if (current.phase === "moving") {
    await input.store.transaction(async (state, persist) => {
      const claim = claims(state).find((candidate) => candidate.token === current.token);
      if (!claim || claim.phase !== "moving") return;
      const entries = selectedEntries(claim, input.agentDir);
      for (const entry of entries) {
        await assertContainedPath(entry.base, entry.path);
        await assertContainedPath(quarantineRoot(input.agentDir), entry.quarantine);
        const [sourceExists, quarantinedExists] = await Promise.all([pathExists(entry.path), pathExists(entry.quarantine)]);
        if (sourceExists && quarantinedExists) throw new Error(`Cleanup recovery found both source and quarantine for ${entry.path}`);
        if (!sourceExists && !quarantinedExists) throw new Error(`Cleanup recovery found neither source nor quarantine for ${entry.path}`);
        if (quarantinedExists) await rename(entry.quarantine, entry.path);
      }
      claim.phase = "claimed";
      claim.pathIndexes = [];
      await persist();
    });
    await input.removePath(quarantine);
    await removeClaim(input.store, current.token);
    return "restored";
  }

  if (!(await unitPrefixIsClear(input.runner, current.workerId))) return "blocked";
  if (current.unit) {
    const verified = await verifyUnitAbsentAndEmpty(input.runner, current.unit);
    if (!verified.absent) return "blocked";
  }
  if (current.phase === "moved") {
    const transitioned = await input.store.mutateConditionally((state) => {
      const claim = claims(state).find((candidate) => candidate.token === current.token);
      if (!claim || claim.phase !== "moved") return { value: false, changed: false };
      claim.phase = "deleting";
      claim.ownerPid = process.pid;
      return { value: true, changed: true };
    });
    if (!transitioned) return "gone";
  }
  await input.removePath(quarantine);
  await finalizeClaim(input.store, current.token);
  return "completed";
}

export async function recoverRuntimeCleanupClaims(input: {
  store: WorkerStore;
  runner: CommandRunner;
  agentDir: string;
  forceToken?: string;
  removePath?: (path: string) => Promise<void>;
}): Promise<{ restored: number; completed: number; blocked: number; errors: Array<{ token: string; error: string }> }> {
  const removePath = input.removePath ?? (async (path: string) => rm(path, { recursive: true, force: true }));
  const snapshot = await input.store.read();
  const result: { restored: number; completed: number; blocked: number; errors: Array<{ token: string; error: string }> } = {
    restored: 0,
    completed: 0,
    blocked: 0,
    errors: [],
  };
  for (const claim of snapshot.runtimeCleanupClaims ?? []) {
    try {
      const outcome = await recoverOneClaim({ ...input, claim, force: input.forceToken === claim.token, removePath });
      if (outcome === "restored") result.restored += 1;
      else if (outcome === "completed") result.completed += 1;
      else if (outcome === "blocked") result.blocked += 1;
    } catch (error) {
      await input.store.mutateConditionally((state) => {
        const current = claims(state).find((candidate) => candidate.token === claim.token);
        if (!current || current.ownerPid !== process.pid) return { value: undefined, changed: false };
        current.ownerPid = 0;
        return { value: undefined, changed: true };
      }).catch(() => undefined);
      result.errors.push({ token: claim.token, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export const recoverStaleRuntimeCleanupClaims = recoverRuntimeCleanupClaims;

async function transitionToMoved(input: {
  store: WorkerStore;
  agentDir: string;
  token: string;
  renamePath?: (source: string, destination: string) => Promise<void>;
  revalidate: (state: WorkerStateFile, claim: RuntimeCleanupClaim) => Promise<boolean> | boolean;
}): Promise<boolean> {
  return input.store.transaction(async (state, persist) => {
    const claim = claims(state).find((candidate) => candidate.token === input.token);
    if (!claim || claim.phase !== "claimed" || !(await input.revalidate(state, claim))) return false;
    const existing: number[] = [];
    for (const entry of expectedEntries(claim, input.agentDir)) {
      try {
        await assertContainedPath(entry.base, entry.path);
        if (await pathExists(entry.path)) existing.push(entry.index);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    claim.pathIndexes = existing;
    claim.phase = "moving";
    await persist();
    const movingClaim = claims(state).find((candidate) => candidate.token === input.token && candidate.phase === "moving");
    if (!movingClaim) throw new Error(`Cleanup claim ${input.token} was not durably published as moving`);
    for (const entry of selectedEntries(movingClaim, input.agentDir)) {
      await (input.renamePath ?? rename)(entry.path, entry.quarantine);
    }
    movingClaim.phase = "moved";
    await persist();
    return true;
  });
}

async function deleteMovedClaim(input: {
  store: WorkerStore;
  runner: CommandRunner;
  token: string;
  quarantine: string;
  removePath: (path: string) => Promise<void>;
  inventory?: CleanupUnitInventory;
  now?: number;
}): Promise<boolean> {
  const snapshot = await input.store.read();
  const current = snapshot.runtimeCleanupClaims?.find((claim) => claim.token === input.token);
  if (!current || current.phase !== "moved") return false;
  const now = input.now ?? Date.now();
  if (!(await unitPrefixIsClear(input.runner, current.workerId, input.inventory, now))
    || (current.unit && !(await recordedUnitIsAbsentAndEmpty(input.runner, current.unit, input.inventory, now)))) {
    await input.store.mutateConditionally((state) => {
      const claim = claims(state).find((candidate) => candidate.token === input.token);
      if (!claim || claim.ownerPid === 0) return { value: undefined, changed: false };
      claim.ownerPid = 0;
      return { value: undefined, changed: true };
    });
    return false;
  }
  const transitioned = await input.store.mutateConditionally((state) => {
    const claim = claims(state).find((candidate) => candidate.token === input.token);
    if (!claim || claim.phase !== "moved") return { value: false, changed: false };
    claim.phase = "deleting";
    return { value: true, changed: true };
  });
  if (!transitioned) return false;
  try {
    await input.removePath(input.quarantine);
    return await finalizeClaim(input.store, input.token);
  } catch (error) {
    await input.store.mutateConditionally((state) => {
      const claim = claims(state).find((candidate) => candidate.token === input.token && candidate.phase === "deleting");
      if (!claim || claim.ownerPid === 0) return { value: undefined, changed: false };
      claim.ownerPid = 0;
      return { value: undefined, changed: true };
    }).catch(() => undefined);
    throw error;
  }
}

export type TerminalRuntimeCleanupInput = {
  store: WorkerStore;
  runner: CommandRunner;
  agentDir: string;
  workerId: string;
  runId: string;
  terminalAt: number;
  action: "cache" | "full";
  eligible: (worker: WorkerRecord) => boolean;
  now?: number;
  removePath?: (path: string) => Promise<void>;
  renamePath?: (source: string, destination: string) => Promise<void>;
};

type PreparedRuntimeCleanup = {
  token: string;
  quarantine: string;
  removePath: (path: string) => Promise<void>;
};

async function prepareTerminalRuntimeCleanup(
  input: TerminalRuntimeCleanupInput,
  inventory?: CleanupUnitInventory,
  inventoryNow = Date.now(),
): Promise<PreparedRuntimeCleanup | undefined> {
  const now = input.now ?? Date.now();
  validateWorkerId(input.workerId);
  const removePath = input.removePath ?? (async (path: string) => rm(path, { recursive: true, force: true }));
  const token = `${input.action}-${input.workerId}-${randomUUID()}`;
  const claimed = await input.store.mutateConditionally((state) => {
    const worker = state.workers.find((candidate) => candidate.id === input.workerId && candidate.runId === input.runId);
    if (!worker || terminalWorkerAt(worker) !== input.terminalAt || worker.mainPid || !input.eligible(worker)) return { value: false, changed: false };
    if (claims(state).some((claim) => claim.workerId === input.workerId)) return { value: false, changed: false };
    claims(state).push({ token, workerId: input.workerId, runId: input.runId, terminalAt: input.terminalAt, unit: worker.unit, action: input.action, claimedAt: now, ownerPid: process.pid, phase: "claimed", pathIndexes: [] });
    return { value: true, changed: true };
  });
  if (!claimed) return undefined;
  const quarantine = await prepareQuarantine(input.agentDir, token).catch(async (error) => {
    await removeClaim(input.store, token).catch(() => undefined);
    throw error;
  });
  const workerUnit = (await input.store.read()).runtimeCleanupClaims?.find((claim) => claim.token === token)?.unit;
  const recordedUnitClear = workerUnit
    ? await recordedUnitIsAbsentAndEmpty(input.runner, workerUnit, inventory, inventoryNow)
    : true;
  if (!recordedUnitClear || !(await unitPrefixIsClear(input.runner, input.workerId, inventory, inventoryNow))) {
    await removeClaim(input.store, token);
    await removePath(quarantine);
    return undefined;
  }
  try {
    const moved = await transitionToMoved({
      store: input.store,
      agentDir: input.agentDir,
      token,
      renamePath: input.renamePath,
      revalidate: (state, claim) => {
        const worker = state.workers.find((candidate) => candidate.id === claim.workerId && candidate.runId === claim.runId);
        return Boolean(worker && terminalWorkerAt(worker) === claim.terminalAt && !worker.mainPid && input.eligible(worker));
      },
    });
    if (!moved) {
      await removeClaim(input.store, token);
      await removePath(quarantine);
      return undefined;
    }
  } catch (error) {
    await recoverRuntimeCleanupClaims({ store: input.store, runner: input.runner, agentDir: input.agentDir, forceToken: token, removePath }).catch(() => undefined);
    throw error;
  }
  return { token, quarantine, removePath };
}

export async function deleteTerminalRuntimeSafely(input: TerminalRuntimeCleanupInput): Promise<boolean> {
  const prepared = await prepareTerminalRuntimeCleanup(input);
  if (!prepared) return false;
  return deleteMovedClaim({
    store: input.store,
    runner: input.runner,
    token: prepared.token,
    quarantine: prepared.quarantine,
    removePath: prepared.removePath,
  });
}

export type TerminalRuntimeCleanupBatchCandidate = Omit<TerminalRuntimeCleanupInput, "store" | "runner" | "agentDir"> & {
  stopRecordedUnit?: string;
};

export async function deleteTerminalRuntimeBatchSafely(input: {
  store: WorkerStore;
  runner: CommandRunner;
  agentDir: string;
  candidates: TerminalRuntimeCleanupBatchCandidate[];
  preMoveInventory?: CleanupUnitInventory;
  inventoryNow?: () => number;
}): Promise<{ deleted: boolean[]; errors: Array<{ index: number; error: string }> }> {
  const deleted = input.candidates.map(() => false);
  const errors: Array<{ index: number; error: string }> = [];
  const inventoryNow = input.inventoryNow ?? Date.now;
  let preMoveInventory = input.preMoveInventory ?? await captureCleanupUnitInventory(input.runner, inventoryNow);
  let chunkRemaining = CLEANUP_UNIT_INVENTORY_CHUNK_SIZE;
  const releaseOwners = async (tokens: ReadonlySet<string>): Promise<void> => {
    await input.store.mutateConditionally((state) => {
      let changed = false;
      for (const claim of claims(state)) {
        if (tokens.has(claim.token) && claim.ownerPid !== 0) {
          claim.ownerPid = 0;
          changed = true;
        }
      }
      return { value: undefined, changed };
    }).catch(() => undefined);
  };

  const currentInventory = async (): Promise<{ inventory: CleanupUnitInventory; now: number }> => {
    let now = inventoryNow();
    if (chunkRemaining === 0
      || (preMoveInventory.verified && !cleanupUnitInventoryIsUsable(preMoveInventory, now))) {
      preMoveInventory = await captureCleanupUnitInventory(input.runner, inventoryNow);
      now = inventoryNow();
      chunkRemaining = CLEANUP_UNIT_INVENTORY_CHUNK_SIZE;
    }
    chunkRemaining -= 1;
    return { inventory: preMoveInventory, now };
  };

  const stopped = new Set<number>();
  for (const [index, candidate] of input.candidates.entries()) {
    try {
      if (candidate.stopRecordedUnit) {
        const current = await currentInventory();
        if (!cleanupInventoryProvesPrefixAbsent(current.inventory, candidate.workerId, current.now)
          || current.inventory.units.has(candidate.stopRecordedUnit)) {
          await stopUnit(input.runner, candidate.stopRecordedUnit);
        }
      }
      stopped.add(index);
    } catch (error) {
      errors.push({ index, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const requests = input.candidates.map((candidate, index) => ({
    candidate,
    index,
    token: `${candidate.action}-${candidate.workerId}-${randomUUID()}`,
  })).filter(({ index }) => stopped.has(index));
  const admitted = await input.store.mutateConditionally((state) => {
    const accepted: Array<{ index: number; token: string; unit?: string }> = [];
    let changed = false;
    for (const { candidate, index, token } of requests) {
      const worker = state.workers.find((current) => current.id === candidate.workerId && current.runId === candidate.runId);
      if (!worker || terminalWorkerAt(worker) !== candidate.terminalAt || worker.mainPid || !candidate.eligible(worker)) continue;
      if (claims(state).some((claim) => claim.workerId === candidate.workerId)) continue;
      claims(state).push({
        token,
        workerId: candidate.workerId,
        runId: candidate.runId,
        terminalAt: candidate.terminalAt,
        unit: worker.unit,
        action: candidate.action,
        claimedAt: candidate.now ?? Date.now(),
        ownerPid: process.pid,
        phase: "claimed",
        pathIndexes: [],
      });
      accepted.push({ index, token, ...(worker.unit ? { unit: worker.unit } : {}) });
      changed = true;
    }
    return { value: accepted, changed };
  });

  const quarantines = new Map<string, string>();
  const rejected = new Set<string>();
  for (const claim of admitted) {
    try {
      quarantines.set(claim.token, await prepareQuarantine(input.agentDir, claim.token));
      const current = await currentInventory();
      const unitClear = claim.unit
        ? await recordedUnitIsAbsentAndEmpty(input.runner, claim.unit, current.inventory, current.now)
        : true;
      if (!unitClear || !(await unitPrefixIsClear(
        input.runner,
        input.candidates[claim.index].workerId,
        current.inventory,
        current.now,
      ))) rejected.add(claim.token);
    } catch (error) {
      rejected.add(claim.token);
      errors.push({ index: claim.index, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (rejected.size) {
    await input.store.mutateConditionally((state) => {
      const before = claims(state).length;
      state.runtimeCleanupClaims = claims(state).filter((claim) => !rejected.has(claim.token));
      return { value: undefined, changed: claims(state).length !== before };
    });
    for (const token of rejected) {
      const quarantine = quarantines.get(token);
      if (quarantine) await rm(quarantine, { recursive: true, force: true });
    }
  }

  const movable = admitted.filter(({ token }) => !rejected.has(token));
  const invalid = new Set<string>();
  const moveFailures = new Set<string>();
  let movementError: unknown;
  if (movable.length) {
    await input.store.transaction(async (state, persist) => {
      const moving: Array<{ index: number; token: string }> = [];
      for (const item of movable) {
        const claim = claims(state).find((candidate) => candidate.token === item.token);
        const candidate = input.candidates[item.index];
        const worker = claim?.runId
          ? state.workers.find((current) => current.id === claim.workerId && current.runId === claim.runId)
          : undefined;
        if (!claim || claim.phase !== "claimed"
          || !worker || terminalWorkerAt(worker) !== claim.terminalAt || worker.mainPid || !candidate.eligible(worker)) {
          invalid.add(item.token);
          continue;
        }
        try {
          const existing: number[] = [];
          for (const entry of expectedEntries(claim, input.agentDir)) {
            try {
              await assertContainedPath(entry.base, entry.path);
              if (await pathExists(entry.path)) existing.push(entry.index);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
          }
          claim.pathIndexes = existing;
          claim.phase = "moving";
          moving.push({ index: item.index, token: claim.token });
        } catch (error) {
          invalid.add(item.token);
          errors.push({ index: item.index, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (moving.length) await persist();
      for (const item of moving) {
        try {
          const movingClaim = claims(state).find((claim) => claim.token === item.token && claim.phase === "moving");
          if (!movingClaim) throw new Error(`Cleanup claim ${item.token} was not durably published as moving`);
          for (const entry of selectedEntries(movingClaim, input.agentDir)) await rename(entry.path, entry.quarantine);
          movingClaim.phase = "moved";
        } catch (error) {
          moveFailures.add(item.token);
          errors.push({ index: item.index, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (moving.length) await persist();
    }).catch((error) => { movementError = error; });
  }
  if (movementError) {
    for (const item of movable) {
      const claim = (await input.store.read()).runtimeCleanupClaims?.find((candidate) => candidate.token === item.token);
      if (claim) {
        await recoverOneClaim({
          store: input.store,
          runner: input.runner,
          agentDir: input.agentDir,
          claim,
          force: true,
          removePath: async (path) => rm(path, { recursive: true, force: true }),
        }).catch(() => undefined);
      }
      errors.push({ index: item.index, error: movementError instanceof Error ? movementError.message : String(movementError) });
    }
    await releaseOwners(new Set(movable.map(({ token }) => token)));
    return { deleted, errors };
  }

  if (invalid.size) {
    await input.store.mutateConditionally((state) => {
      const before = claims(state).length;
      state.runtimeCleanupClaims = claims(state).filter((claim) => !invalid.has(claim.token));
      return { value: undefined, changed: claims(state).length !== before };
    });
    for (const token of invalid) {
      const quarantine = quarantines.get(token);
      if (quarantine) await rm(quarantine, { recursive: true, force: true });
    }
  }
  for (const token of moveFailures) {
    const claim = (await input.store.read()).runtimeCleanupClaims?.find((candidate) => candidate.token === token);
    if (claim) {
      await recoverOneClaim({
        store: input.store,
        runner: input.runner,
        agentDir: input.agentDir,
        claim,
        force: true,
        removePath: async (path) => rm(path, { recursive: true, force: true }),
      }).catch(async () => {
        await input.store.mutateConditionally((state) => {
          const current = claims(state).find((candidate) => candidate.token === token);
          if (!current || current.ownerPid === 0) return { value: undefined, changed: false };
          current.ownerPid = 0;
          return { value: undefined, changed: true };
        }).catch(() => undefined);
      });
    }
  }

  const moved = movable.filter(({ token }) => !invalid.has(token) && !moveFailures.has(token));
  if (moved.length === 0) return { deleted, errors };

  let postMoveInventory = await captureCleanupUnitInventory(input.runner, inventoryNow);
  chunkRemaining = CLEANUP_UNIT_INVENTORY_CHUNK_SIZE;
  const currentPostMoveInventory = async (): Promise<{ inventory: CleanupUnitInventory; now: number }> => {
    let now = inventoryNow();
    if (chunkRemaining === 0
      || (postMoveInventory.verified && !cleanupUnitInventoryIsUsable(postMoveInventory, now))) {
      postMoveInventory = await captureCleanupUnitInventory(input.runner, inventoryNow);
      now = inventoryNow();
      chunkRemaining = CLEANUP_UNIT_INVENTORY_CHUNK_SIZE;
    }
    chunkRemaining -= 1;
    return { inventory: postMoveInventory, now };
  };

  const readyToDelete = new Set<string>();
  const blocked = new Set<string>();
  for (const item of moved) {
    try {
      const current = await currentPostMoveInventory();
      const workerId = input.candidates[item.index].workerId;
      const prefixClear = await unitPrefixIsClear(input.runner, workerId, current.inventory, current.now);
      const unitClear = item.unit
        ? await recordedUnitIsAbsentAndEmpty(input.runner, item.unit, current.inventory, current.now)
        : true;
      (prefixClear && unitClear ? readyToDelete : blocked).add(item.token);
    } catch (error) {
      blocked.add(item.token);
      errors.push({ index: item.index, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const transitioned = await input.store.mutateConditionally((state) => {
    let changed = false;
    const deleting: string[] = [];
    for (const claim of claims(state)) {
      if (readyToDelete.has(claim.token) && claim.phase === "moved") {
        claim.phase = "deleting";
        deleting.push(claim.token);
        changed = true;
      } else if (blocked.has(claim.token) && claim.ownerPid !== 0) {
        claim.ownerPid = 0;
        changed = true;
      }
    }
    return { value: deleting, changed };
  }).catch(async (error) => {
    await releaseOwners(new Set(moved.map(({ token }) => token)));
    for (const item of moved) errors.push({ index: item.index, error: error instanceof Error ? error.message : String(error) });
    return [] as string[];
  });
  const deleting = new Set(transitioned);

  const removed = new Set<string>();
  const removeFailed = new Set<string>();
  for (const item of moved) {
    if (!deleting.has(item.token)) continue;
    try {
      const removePath = input.candidates[item.index].removePath
        ?? (async (path: string) => rm(path, { recursive: true, force: true }));
      await removePath(quarantines.get(item.token)!);
      removed.add(item.token);
    } catch (error) {
      removeFailed.add(item.token);
      errors.push({ index: item.index, error: error instanceof Error ? error.message : String(error) });
    }
  }

  let finalized = new Set<string>();
  if (removed.size || removeFailed.size) {
    const completedTokens = await input.store.mutateConditionally((state) => {
      let changed = false;
      for (const claim of claims(state)) {
        if (removeFailed.has(claim.token) && claim.ownerPid !== 0) {
          claim.ownerPid = 0;
          changed = true;
        }
      }
      const completed = claims(state).filter((claim) => removed.has(claim.token) && claim.phase === "deleting");
      if (completed.length) {
        const fullRuns = new Set(completed.filter((claim) => claim.action === "full").map((claim) => `${claim.workerId}\u0000${claim.runId}`));
        state.workers = state.workers.filter((worker) => !fullRuns.has(`${worker.id}\u0000${worker.runId}`));
        state.runtimeCleanupClaims = claims(state).filter((claim) => !removed.has(claim.token));
        changed = true;
      }
      return { value: completed.map((claim) => claim.token), changed };
    }).catch(async (error) => {
      await releaseOwners(new Set([...removed, ...removeFailed]));
      for (const item of moved) {
        if (removed.has(item.token) || removeFailed.has(item.token)) {
          errors.push({ index: item.index, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return [] as string[];
    });
    finalized = new Set(completedTokens);
  }
  for (const item of moved) if (finalized.has(item.token)) deleted[item.index] = true;
  return { deleted, errors };
}

export async function deleteOrphanRuntimeSafely(input: {
  store: WorkerStore;
  runner: CommandRunner;
  config: OrchestratorConfig;
  agentDir: string;
  workerId: string;
  path: string;
  now?: number;
  removePath?: (path: string) => Promise<void>;
}): Promise<boolean> {
  const now = input.now ?? Date.now();
  validateWorkerId(input.workerId);
  const canonical = workerRuntimeRoot(input.workerId, input.agentDir);
  if (input.path !== canonical) throw new Error(`Orphan runtime path is not canonical for ${input.workerId}`);
  const info = await lstat(canonical).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (!info || info.mtimeMs > now - input.config.orphanRuntimeRetentionMinutes * 60_000) return false;
  const removePath = input.removePath ?? (async (path: string) => rm(path, { recursive: true, force: true }));
  const token = `orphan-${input.workerId}-${randomUUID()}`;
  const claimed = await input.store.mutateConditionally((state) => {
    if (state.workers.some((worker) => worker.id === input.workerId) || claims(state).some((claim) => claim.workerId === input.workerId)) return { value: false, changed: false };
    claims(state).push({ token, workerId: input.workerId, action: "orphan", claimedAt: now, ownerPid: process.pid, phase: "claimed", pathIndexes: [] });
    return { value: true, changed: true };
  });
  if (!claimed) return false;
  const quarantine = await prepareQuarantine(input.agentDir, token).catch(async (error) => {
    await removeClaim(input.store, token).catch(() => undefined);
    throw error;
  });
  if (!(await unitPrefixIsClear(input.runner, input.workerId))) {
    await removeClaim(input.store, token);
    await removePath(quarantine);
    return false;
  }
  try {
    const moved = await transitionToMoved({
      store: input.store,
      agentDir: input.agentDir,
      token,
      revalidate: async (state) => {
        if (state.workers.some((worker) => worker.id === input.workerId)) return false;
        const current = await lstat(canonical).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        });
        return Boolean(current && current.mtimeMs <= now - input.config.orphanRuntimeRetentionMinutes * 60_000);
      },
    });
    if (!moved) {
      await removeClaim(input.store, token);
      await removePath(quarantine);
      return false;
    }
  } catch (error) {
    await recoverRuntimeCleanupClaims({ store: input.store, runner: input.runner, agentDir: input.agentDir, forceToken: token, removePath }).catch(() => undefined);
    throw error;
  }
  return deleteMovedClaim({ store: input.store, runner: input.runner, token, quarantine, removePath });
}
