import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export type CleanupRunOutcome = "running" | "ok" | "partial" | "error";

export interface CleanupRunState {
  version: 1;
  outcome: CleanupRunOutcome;
  startedAt: number;
  updatedAt: number;
  durationMs?: number;
  candidates?: number;
  handled?: number;
  errors?: number;
  deferred?: number;
  budgetExhausted?: boolean;
}

export interface CleanupRunDiagnostics {
  state: "never" | CleanupRunOutcome | "invalid";
  ageMs?: number;
  result?: CleanupRunState;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseCleanupRunState(value: unknown): CleanupRunState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowed = new Set(["version", "outcome", "startedAt", "updatedAt", "durationMs", "candidates", "handled", "errors", "deferred", "budgetExhausted"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return undefined;
  if (record.version !== 1 || !["running", "ok", "partial", "error"].includes(String(record.outcome))) return undefined;
  if (!isCount(record.startedAt) || !isCount(record.updatedAt) || record.updatedAt < record.startedAt) return undefined;
  for (const key of ["durationMs", "candidates", "handled", "errors", "deferred"] as const) {
    if (record[key] !== undefined && !isCount(record[key])) return undefined;
  }
  if (record.budgetExhausted !== undefined && typeof record.budgetExhausted !== "boolean") return undefined;
  return record as unknown as CleanupRunState;
}

/** Atomic, directory-fsynced content-free cleanup lifecycle record. Cleanup writers are serialized by cleanup-run.lock. */
export async function writeCleanupRunState(path: string, state: CleanupRunState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function readCleanupRunDiagnostics(path: string, now = Date.now()): Promise<CleanupRunDiagnostics> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "never" };
    return { state: "invalid" };
  }
  try {
    const result = parseCleanupRunState(JSON.parse(raw));
    if (!result) return { state: "invalid" };
    return { state: result.outcome, ageMs: Math.max(0, now - result.updatedAt), result };
  } catch {
    return { state: "invalid" };
  }
}
