import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerStore, type WorkerStoreMetric } from "../src/store.ts";
import type { WorkerRecord } from "../src/types.ts";

const iterations = Number.parseInt(process.env.WORKER_STORE_BENCH_ITERATIONS ?? "100", 10);
const sizes = (process.env.WORKER_STORE_BENCH_SIZES ?? "1,25,100")
  .split(",")
  .map((value) => Number.parseInt(value, 10))
  .filter((value) => Number.isSafeInteger(value) && value > 0);

if (!Number.isSafeInteger(iterations) || iterations < 1 || sizes.length === 0) {
  throw new Error("WORKER_STORE_BENCH_ITERATIONS and WORKER_STORE_BENCH_SIZES must contain positive integers");
}

function worker(index: number): WorkerRecord {
  return {
    id: `bench-${index}`,
    runId: `run-bench-${index}`,
    harness: "codex",
    backend: "systemd",
    role: "builder",
    task: `representative benchmark worker ${index}`,
    cwd: "/tmp",
    state: "ready",
    owned: true,
    managerSessionId: "benchmark-manager",
    createdAt: 1,
    updatedAt: 1,
    leaseExpiresAt: 60_000,
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function summarize(metrics: WorkerStoreMetric[]): Record<string, unknown> {
  const durations = metrics.map((metric) => metric.durationMs);
  return {
    samples: durations.length,
    meanMs: durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    bytes: metrics.reduce((sum, metric) => sum + (metric.bytes ?? 0), 0),
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "worker-store-benchmark-"));
  const results: Record<string, unknown>[] = [];
  try {
    for (const size of sizes) {
      const path = join(root, `workers-${size}.json`);
      const metrics: WorkerStoreMetric[] = [];
      const store = new WorkerStore(path, { instrumentation: (metric) => metrics.push({ ...metric }) });
      await store.mutate((state) => {
        state.workers.push(...Array.from({ length: size }, (_, index) => worker(index)));
      });
      metrics.length = 0;

      for (let index = 0; index < iterations; index += 1) await store.read();
      results.push({ size, scenario: "read", ...summarize(metrics.filter((metric) => metric.operation === "read")) });
      metrics.length = 0;

      for (let index = 0; index < iterations; index += 1) {
        await store.mutateConditionally(() => ({ value: undefined, changed: false }));
      }
      results.push({ size, scenario: "unmatched-noop", ...summarize(metrics.filter((metric) => metric.operation === "mutation")) });
      metrics.length = 0;

      for (let index = 0; index < iterations; index += 1) {
        await store.mutateConditionally((state) => {
          state.workers[0].updatedAt += 1;
          return { value: undefined, changed: true };
        });
      }
      results.push({
        size,
        scenario: "matched-mutation",
        ...summarize(metrics.filter((metric) => metric.operation === "mutation")),
        commit: summarize(metrics.filter((metric) => metric.operation === "commit")),
      });
      metrics.length = 0;

      const contenders = Array.from({ length: 4 }, () => new WorkerStore(path, { instrumentation: (metric) => metrics.push({ ...metric }) }));
      await Promise.all(Array.from({ length: iterations }, (_, index) => contenders[index % contenders.length].mutateConditionally((state) => {
        state.workers[index % size].updatedAt += 1;
        return { value: undefined, changed: true };
      })));
      results.push({
        size,
        scenario: "four-store-contention",
        ...summarize(metrics.filter((metric) => metric.operation === "mutation")),
        lockWait: summarize(metrics.filter((metric) => metric.operation === "lock_wait")),
        commit: summarize(metrics.filter((metric) => metric.operation === "commit")),
      });
    }
    console.log(JSON.stringify({ iterations, sizes, results }, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
