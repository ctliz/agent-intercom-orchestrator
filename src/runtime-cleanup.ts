import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { WorkerStore } from "./store.ts";
import { listWorkerUnitsForVerification, sanitizeUnitPart, verifyUnitAbsentAndEmpty } from "./systemd.ts";
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

async function unitPrefixIsClear(runner: CommandRunner, workerId: string): Promise<boolean> {
  const loaded = await listWorkerUnitsForVerification(runner);
  if (!loaded.verified) return false;
  const prefix = `agent-intercom-worker-${sanitizeUnitPart(workerId)}-`;
  return !loaded.units.some((unit) => unit.startsWith(prefix));
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
}): Promise<boolean> {
  const snapshot = await input.store.read();
  const current = snapshot.runtimeCleanupClaims?.find((claim) => claim.token === input.token);
  if (!current || current.phase !== "moved") return false;
  if (!(await unitPrefixIsClear(input.runner, current.workerId)) || (current.unit && !(await verifyUnitAbsentAndEmpty(input.runner, current.unit)).absent)) {
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

export async function deleteTerminalRuntimeSafely(input: {
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
}): Promise<boolean> {
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
  if (!claimed) return false;
  const quarantine = await prepareQuarantine(input.agentDir, token).catch(async (error) => {
    await removeClaim(input.store, token).catch(() => undefined);
    throw error;
  });
  const workerUnit = (await input.store.read()).runtimeCleanupClaims?.find((claim) => claim.token === token)?.unit;
  const verified = workerUnit ? await verifyUnitAbsentAndEmpty(input.runner, workerUnit) : { absent: true };
  if (!verified.absent || !(await unitPrefixIsClear(input.runner, input.workerId))) {
    await removeClaim(input.store, token);
    await removePath(quarantine);
    return false;
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
      return false;
    }
  } catch (error) {
    await recoverRuntimeCleanupClaims({ store: input.store, runner: input.runner, agentDir: input.agentDir, forceToken: token, removePath }).catch(() => undefined);
    throw error;
  }
  return deleteMovedClaim({ store: input.store, runner: input.runner, token, quarantine, removePath });
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
