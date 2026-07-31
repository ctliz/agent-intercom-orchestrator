import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG, mergeConfig, readConfig, writeConfigDefaults } from "../src/config.ts";
import {
  deleteOrphanRuntimeSafely,
  deleteTerminalRuntimeBatchSafely,
  deleteTerminalRuntimeSafely,
  executeCleanupCandidatesIsolated,
  recoverRuntimeCleanupClaims,
  terminalCachePaths,
  terminalWorkerAt,
} from "../src/runtime-cleanup.ts";
import { workerRuntimeRoot } from "../src/runtime.ts";
import { WorkerStore } from "../src/store.ts";
import { verifyUnitAbsentAndEmpty } from "../src/systemd.ts";
import type { CommandRunner, RuntimeCleanupClaim, WorkerRecord } from "../src/types.ts";
import { reserveWorkerRecord } from "../src/index.ts";

function worker(overrides: Partial<WorkerRecord> = {}): WorkerRecord {
  return {
    id: "retained-worker",
    runId: "old-run",
    harness: "codex",
    backend: "systemd",
    role: "builder",
    task: "test retention",
    cwd: "/tmp",
    state: "stopped",
    owned: true,
    managerSessionId: "old-manager",
    unit: "agent-intercom-worker-retained-worker-old-run.service",
    createdAt: 1,
    updatedAt: 1,
    stoppedAt: 1,
    leaseExpiresAt: 1,
    ...overrides,
  };
}

const absentRunner: CommandRunner = {
  async exec(command, args) {
    if (command === "systemctl" && args.includes("list-units")) return { stdout: "", stderr: "", code: 0 };
    if (command === "systemctl") {
      return { stdout: "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n", stderr: "Unit not found", code: 1 };
    }
    if (command === "systemd-cgls") return { stdout: "", stderr: "Unit not found", code: 1 };
    return { stdout: "", stderr: "", code: 0 };
  },
};

test("migration-pending workers are never eligible for terminal runtime cleanup", () => {
  assert.equal(terminalWorkerAt(worker({ state: "migration_pending", stoppedAt: undefined, updatedAt: 42 })), undefined);
});

test("orphan runtime retention defaults and overrides are configurable", () => {
  assert.equal(DEFAULT_CONFIG.orphanRuntimeRetentionMinutes, 60);
  assert.equal(mergeConfig({ leaseMinutes: 5 }).orphanRuntimeRetentionMinutes, 60);
  assert.equal(mergeConfig({ orphanRuntimeRetentionMinutes: 30 }).orphanRuntimeRetentionMinutes, 30);
  assert.equal(mergeConfig({ orphanRuntimeRetentionMinutes: 0 }).orphanRuntimeRetentionMinutes, 60);
});

test("cleanup execution isolates one candidate failure and continues", async () => {
  const result = await executeCleanupCandidatesIsolated(["bad", "good"], async (candidate) => {
    if (candidate === "bad") throw new Error("unsafe runtime path");
    return true;
  });
  assert.deepEqual(result.executed, ["good"]);
  assert.deepEqual(result.errors, [{ candidate: "bad", error: "unsafe runtime path" }]);
});

test("batch cleanup bounds verified unit enumeration for 500 unit-less expired workers", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-scale-"));
  const agentDir = join(root, "agent");
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  const store = new WorkerStore(join(orchestrator, "workers.json"));
  const records = Array.from({ length: 500 }, (_, index) => worker({
    id: `expired-${index}`,
    runId: `run-${index}`,
    unit: undefined,
  }));
  let listCalls = 0;
  let showCalls = 0;
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) {
        listCalls += 1;
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command === "systemctl") showCalls += 1;
      return { stdout: "", stderr: "Unit not found", code: 1 };
    },
  };
  try {
    await mkdir(orchestrator, { recursive: true });
    for (const record of records) {
      const runtime = workerRuntimeRoot(record.id, agentDir);
      await mkdir(runtime, { recursive: true });
      await writeFile(join(runtime, "state"), "expired");
    }
    await store.write({ version: 1, workers: records });
    const result = await deleteTerminalRuntimeBatchSafely({
      store,
      runner,
      agentDir,
      candidates: records.map((record) => ({
        workerId: record.id,
        runId: record.runId,
        terminalAt: record.stoppedAt!,
        action: "full",
        eligible: () => true,
      })),
    });
    assert.equal(result.deleted.filter(Boolean).length, 500);
    assert.deepEqual(result.errors, []);
    assert.ok(listCalls <= 12, `expected at most 12 list-units calls, received ${listCalls}`);
    assert.equal(listCalls, 10, "500 candidates must recapture both inventories at each 100-candidate boundary");
    assert.equal(showCalls, 0);
    assert.equal((await store.read()).workers.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("post-move inventory prefix hit blocks deletion, releases ownership, and remains recoverable", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-post-move-unit-"));
  const agentDir = join(root, "agent");
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  const store = new WorkerStore(join(orchestrator, "workers.json"));
  const record = worker({ unit: undefined });
  const runtime = workerRuntimeRoot(record.id, agentDir);
  let listCalls = 0;
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) {
        listCalls += 1;
        return {
          stdout: listCalls === 2 ? "agent-intercom-worker-retained-worker-out-of-band.service loaded active running\n" : "",
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "Unit not found", code: 1 };
    },
  };
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "state"), "recoverable");
    await store.write({ version: 1, workers: [record] });
    const result = await deleteTerminalRuntimeBatchSafely({
      store,
      runner,
      agentDir,
      candidates: [{
        workerId: record.id,
        runId: record.runId,
        terminalAt: record.stoppedAt!,
        action: "full",
        eligible: () => true,
      }],
    });
    assert.deepEqual(result.deleted, [false]);
    const blocked = (await store.read()).runtimeCleanupClaims?.[0];
    assert.equal(blocked?.phase, "moved");
    assert.equal(blocked?.ownerPid, 0);
    await assert.rejects(access(runtime));
    const recovered = await recoverRuntimeCleanupClaims({ store, runner: absentRunner, agentDir });
    assert.equal(recovered.completed, 1);
    assert.equal((await store.read()).workers.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("post-move chunk recapture catches a cross-process unit after 100 candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-post-move-chunk-"));
  const agentDir = join(root, "agent");
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  const store = new WorkerStore(join(orchestrator, "workers.json"));
  const records = Array.from({ length: 101 }, (_, index) => worker({
    id: `chunked-${index}`,
    runId: `run-${index}`,
    unit: undefined,
  }));
  let listCalls = 0;
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) {
        listCalls += 1;
        return {
          stdout: listCalls === 4 ? "agent-intercom-worker-chunked-100-out-of-band.service loaded active running\n" : "",
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "Unit not found", code: 1 };
    },
  };
  try {
    await mkdir(orchestrator, { recursive: true });
    await store.write({ version: 1, workers: records });
    const result = await deleteTerminalRuntimeBatchSafely({
      store,
      runner,
      agentDir,
      candidates: records.map((record) => ({
        workerId: record.id,
        runId: record.runId,
        terminalAt: record.stoppedAt!,
        action: "full",
        eligible: () => true,
      })),
    });
    assert.equal(listCalls, 4);
    assert.equal(result.deleted.filter(Boolean).length, 100);
    assert.equal(result.deleted[100], false);
    const state = await store.read();
    assert.deepEqual(state.workers.map(({ id }) => id), ["chunked-100"]);
    assert.equal(state.runtimeCleanupClaims?.[0].workerId, "chunked-100");
    assert.equal(state.runtimeCleanupClaims?.[0].phase, "moved");
    assert.equal(state.runtimeCleanupClaims?.[0].ownerPid, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pre-move chunk recapture blocks a cross-process unit after 100 candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-pre-move-chunk-"));
  const agentDir = join(root, "agent");
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  const store = new WorkerStore(join(orchestrator, "workers.json"));
  const records = Array.from({ length: 101 }, (_, index) => worker({
    id: `pre-chunked-${index}`,
    runId: `run-${index}`,
    unit: undefined,
  }));
  let listCalls = 0;
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) {
        listCalls += 1;
        return {
          stdout: listCalls === 2 ? "agent-intercom-worker-pre-chunked-100-out-of-band.service loaded active running\n" : "",
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "Unit not found", code: 1 };
    },
  };
  try {
    await mkdir(orchestrator, { recursive: true });
    await store.write({ version: 1, workers: records });
    const result = await deleteTerminalRuntimeBatchSafely({
      store,
      runner,
      agentDir,
      candidates: records.map((record) => ({
        workerId: record.id,
        runId: record.runId,
        terminalAt: record.stoppedAt!,
        action: "full",
        eligible: () => true,
      })),
    });
    assert.equal(listCalls, 3);
    assert.equal(result.deleted.filter(Boolean).length, 100);
    assert.equal(result.deleted[100], false);
    const state = await store.read();
    assert.deepEqual(state.workers.map(({ id }) => id), ["pre-chunked-100"]);
    assert.equal(state.runtimeCleanupClaims?.length ?? 0, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale post-move inventory is recaptured at a candidate boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-stale-inventory-"));
  const agentDir = join(root, "agent");
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  const store = new WorkerStore(join(orchestrator, "workers.json"));
  const record = worker({ unit: undefined });
  let listCalls = 0;
  const times = [1_000, 1_000, 1_000, 7_001, 7_001, 7_001];
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) listCalls += 1;
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  try {
    await mkdir(orchestrator, { recursive: true });
    await store.write({ version: 1, workers: [record] });
    const result = await deleteTerminalRuntimeBatchSafely({
      store,
      runner,
      agentDir,
      inventoryNow: () => times.shift() ?? 7_001,
      candidates: [{
        workerId: record.id,
        runId: record.runId,
        terminalAt: record.stoppedAt!,
        action: "full",
        eligible: () => true,
      }],
    });
    assert.deepEqual(result.deleted, [true]);
    assert.equal(listCalls, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unverified batch inventory fails closed with bounded chunk recaptures", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-unverified-inventory-"));
  const agentDir = join(root, "agent");
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  const store = new WorkerStore(join(orchestrator, "workers.json"));
  const records = Array.from({ length: 201 }, (_, index) => worker({
    id: `unverified-${index}`,
    runId: `run-${index}`,
    unit: undefined,
  }));
  let listCalls = 0;
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) listCalls += 1;
      return { stdout: "", stderr: "Failed to connect to bus", code: 1 };
    },
  };
  try {
    await mkdir(orchestrator, { recursive: true });
    await store.write({ version: 1, workers: records });
    const result = await deleteTerminalRuntimeBatchSafely({
      store,
      runner,
      agentDir,
      candidates: records.map((record) => ({
        workerId: record.id,
        runId: record.runId,
        terminalAt: record.stoppedAt!,
        action: "full",
        eligible: () => true,
      })),
    });
    assert.equal(result.deleted.some(Boolean), false);
    assert.equal(listCalls, 3);
    const state = await store.read();
    assert.equal(state.workers.length, 201);
    assert.equal(state.runtimeCleanupClaims?.length ?? 0, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inventory-proven recorded unit absence still requires targeted cgroup verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-cgroup-inventory-"));
  const agentDir = join(root, "agent");
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  const store = new WorkerStore(join(orchestrator, "workers.json"));
  const record = worker();
  let showCalls = 0;
  let cgroupCalls = 0;
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) return { stdout: "", stderr: "", code: 0 };
      if (command === "systemctl") showCalls += 1;
      if (command === "systemd-cgls") {
        cgroupCalls += 1;
        return { stdout: "Control group:\n└─4242 worker\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  try {
    await mkdir(orchestrator, { recursive: true });
    await store.write({ version: 1, workers: [record] });
    const result = await deleteTerminalRuntimeBatchSafely({
      store,
      runner,
      agentDir,
      candidates: [{
        workerId: record.id,
        runId: record.runId,
        terminalAt: record.stoppedAt!,
        action: "full",
        eligible: () => true,
      }],
    });
    assert.deepEqual(result.deleted, [false]);
    assert.equal(showCalls, 0);
    assert.equal(cgroupCalls, 1);
    assert.equal((await store.read()).workers.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verified prefix absence skips the recorded-unit stop but checks its cgroup in both batch phases", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-skip-stop-"));
  const agentDir = join(root, "agent");
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  const store = new WorkerStore(join(orchestrator, "workers.json"));
  const record = worker();
  let stopCalls = 0;
  let showCalls = 0;
  let cgroupCalls = 0;
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) return { stdout: "", stderr: "", code: 0 };
      if (command === "systemctl" && args.includes("stop")) stopCalls += 1;
      else if (command === "systemctl") showCalls += 1;
      if (command === "systemd-cgls") {
        cgroupCalls += 1;
        return { stdout: "", stderr: "Unit not found", code: 1 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  try {
    await mkdir(orchestrator, { recursive: true });
    await store.write({ version: 1, workers: [record] });
    const result = await deleteTerminalRuntimeBatchSafely({
      store,
      runner,
      agentDir,
      candidates: [{
        workerId: record.id,
        runId: record.runId,
        terminalAt: record.stoppedAt!,
        action: "full",
        stopRecordedUnit: record.unit,
        eligible: () => true,
      }],
    });
    assert.deepEqual(result.deleted, [true]);
    assert.equal(stopCalls, 0);
    assert.equal(showCalls, 0);
    assert.equal(cgroupCalls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("single-candidate cleanup without an inventory retains both live unit fences", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-single-live-fence-"));
  const agentDir = join(root, "agent");
  const orchestrator = join(agentDir, "intercom", "orchestrator");
  const store = new WorkerStore(join(orchestrator, "workers.json"));
  const record = worker();
  let listCalls = 0;
  let showCalls = 0;
  let cgroupCalls = 0;
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) {
        listCalls += 1;
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command === "systemctl") {
        showCalls += 1;
        return { stdout: "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n", stderr: "Unit not found", code: 1 };
      }
      if (command === "systemd-cgls") {
        cgroupCalls += 1;
        return { stdout: "", stderr: "Unit not found", code: 1 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  try {
    await mkdir(orchestrator, { recursive: true });
    await store.write({ version: 1, workers: [record] });
    assert.equal(await deleteTerminalRuntimeSafely({
      store,
      runner,
      agentDir,
      workerId: record.id,
      runId: record.runId,
      terminalAt: record.stoppedAt!,
      action: "full",
      eligible: () => true,
    }), true);
    assert.equal(listCalls, 2);
    assert.equal(showCalls, 2);
    assert.equal(cgroupCalls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy config migration persists explicit orphan retention", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-retention-config-"));
  const path = join(root, "config.json");
  try {
    await writeFile(path, JSON.stringify({ leaseMinutes: 5 }));
    const config = await readConfig(path);
    config.orphanRuntimeRetentionMinutes = 30;
    await writeConfigDefaults(path, config);
    const raw = JSON.parse(await readFile(path, "utf8"));
    assert.equal(raw.orphanRuntimeRetentionMinutes, 30);
    assert.equal(raw.leaseMinutes, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("terminal cache pruning preserves primary harness state and its worker record", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cache-retention-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const record = worker();
  const runtime = workerRuntimeRoot(record.id, agentDir);
  const cache = terminalCachePaths(record.id, agentDir)[0];
  const primary = join(runtime, "home", ".codex", "thread-state.json");
  try {
    await mkdir(cache, { recursive: true });
    await mkdir(join(runtime, "home", ".codex"), { recursive: true });
    await writeFile(join(cache, "download.bin"), "cache bytes");
    await writeFile(primary, "primary state");
    await store.write({ version: 1, workers: [record] });
    assert.equal(await deleteTerminalRuntimeSafely({
      store,
      runner: absentRunner,
      eligible: () => true,
      agentDir,
      workerId: record.id,
      runId: record.runId,
      terminalAt: record.stoppedAt!,
      action: "cache",
      now: Date.now(),
    }), true);
    assert.equal(await readFile(primary, "utf8"), "primary state");
    assert.equal((await store.read()).workers[0].runId, record.runId);
    await assert.rejects(access(cache));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("terminal deletion refuses a loaded unit before touching runtime files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-live-retention-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const record = worker();
  const runtime = workerRuntimeRoot(record.id, agentDir);
  let removedRuntime = false;
  const runner: CommandRunner = {
    async exec(command) {
      if (command === "systemctl") return { stdout: "LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=4242\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "state"), "keep");
    await store.write({ version: 1, workers: [record] });
    assert.equal(await deleteTerminalRuntimeSafely({
      store,
      runner,
      eligible: () => true,
      agentDir,
      workerId: record.id,
      runId: record.runId,
      terminalAt: record.stoppedAt!,
      action: "full",
      now: Date.now(),
      removePath: async (path) => {
        if (path === runtime) removedRuntime = true;
        await rm(path, { recursive: true, force: true });
      },
    }), false);
    assert.equal(removedRuntime, false);
    assert.equal(await readFile(join(runtime, "state"), "utf8"), "keep");
    assert.equal((await store.read()).workers.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unit absence verification rejects residual cgroup processes and unverifiable failures", async () => {
  const residual: CommandRunner = {
    async exec(command) {
      if (command === "systemctl") {
        return { stdout: "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n", stderr: "", code: 1 };
      }
      return { stdout: "Control group:\n└─4242 worker\n", stderr: "", code: 0 };
    },
  };
  assert.deepEqual(await verifyUnitAbsentAndEmpty(residual, "worker.service"), {
    absent: false,
    reason: "unit cgroup still owns processes: 4242",
  });
  const unavailable: CommandRunner = {
    async exec() {
      return { stdout: "", stderr: "Failed to connect to bus", code: 1 };
    },
  };
  assert.deepEqual(await verifyUnitAbsentAndEmpty(unavailable, "worker.service"), {
    absent: false,
    reason: "could not verify unit state: Failed to connect to bus",
  });
});

test("terminal cleanup refuses a different loaded run with the same worker id", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-same-id-unit-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const record = worker();
  const runtime = workerRuntimeRoot(record.id, agentDir);
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) {
        return { stdout: "agent-intercom-worker-retained-worker-new-run.service loaded active running\n", stderr: "", code: 0 };
      }
      if (command === "systemctl") {
        return { stdout: "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n", stderr: "Unit not found", code: 1 };
      }
      return { stdout: "", stderr: "Unit not found", code: 1 };
    },
  };
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "keep"), "live same-id state");
    await store.write({ version: 1, workers: [record] });
    assert.equal(await deleteTerminalRuntimeSafely({
      store,
      runner,
      eligible: () => true,
      agentDir,
      workerId: record.id,
      runId: record.runId,
      terminalAt: record.stoppedAt!,
      action: "full",
      now: Date.now(),
    }), false);
    assert.equal(await readFile(join(runtime, "keep"), "utf8"), "live same-id state");
    assert.equal((await store.read()).runtimeCleanupClaims?.length ?? 0, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cache cleanup rejects a symlinked intermediate directory without touching its target", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cache-symlink-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const record = worker();
  const runtime = workerRuntimeRoot(record.id, agentDir);
  const external = join(root, "external-home");
  try {
    await mkdir(join(external, ".cache"), { recursive: true });
    await writeFile(join(external, ".cache", "keep"), "outside");
    await mkdir(runtime, { recursive: true });
    await symlink(external, join(runtime, "home"), "dir");
    await store.write({ version: 1, workers: [record] });
    await assert.rejects(deleteTerminalRuntimeSafely({
      store,
      runner: absentRunner,
      eligible: () => true,
      agentDir,
      workerId: record.id,
      runId: record.runId,
      terminalAt: record.stoppedAt!,
      action: "cache",
      now: Date.now(),
    }), /symlink or non-directory ancestor/);
    assert.equal(await readFile(join(external, ".cache", "keep"), "utf8"), "outside");
    assert.equal((await store.read()).runtimeCleanupClaims?.length ?? 0, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full cleanup unlinks a runtime-root symlink without following it", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-full-symlink-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const record = worker();
  const runtime = workerRuntimeRoot(record.id, agentDir);
  const external = join(root, "external-runtime");
  try {
    await mkdir(external, { recursive: true });
    await writeFile(join(external, "keep"), "outside");
    await mkdir(join(agentDir, "intercom", "orchestrator", "worker-runtime"), { recursive: true });
    await symlink(external, runtime, "dir");
    await store.write({ version: 1, workers: [record] });
    assert.equal(await deleteTerminalRuntimeSafely({
      store,
      runner: absentRunner,
      eligible: () => true,
      agentDir,
      workerId: record.id,
      runId: record.runId,
      terminalAt: record.stoppedAt!,
      action: "full",
      now: Date.now(),
    }), true);
    assert.equal(await readFile(join(external, "keep"), "utf8"), "outside");
    assert.equal((await store.read()).workers.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale run candidates do not rewrite state or remove the current runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-stale-run-"));
  const agentDir = join(root, "agent");
  const statePath = join(root, "workers.json");
  const store = new WorkerStore(statePath);
  const record = worker({ runId: "current-run" });
  const runtime = workerRuntimeRoot(record.id, agentDir);
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "keep"), "current");
    await store.write({ version: 1, workers: [record] });
    const before = await readFile(statePath, "utf8");
    assert.equal(await deleteTerminalRuntimeSafely({
      store,
      runner: absentRunner,
      eligible: () => true,
      agentDir,
      workerId: record.id,
      runId: "stale-run",
      terminalAt: record.stoppedAt!,
      action: "full",
      now: Date.now(),
    }), false);
    assert.equal(await readFile(statePath, "utf8"), before);
    assert.equal(await readFile(join(runtime, "keep"), "utf8"), "current");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a replacement between claim and unit verification fences the stale deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-replaced-run-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const old = worker();
  const runtime = workerRuntimeRoot(old.id, agentDir);
  let replaced = false;
  const runner: CommandRunner = {
    async exec(command) {
      if (command === "systemctl" && !replaced) {
        replaced = true;
        await store.mutate((state) => {
          state.workers[0] = worker({ runId: "new-run", state: "provisioning", stoppedAt: undefined, updatedAt: 2 });
        });
        return { stdout: "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n", stderr: "Unit not found", code: 1 };
      }
      return { stdout: "", stderr: "Unit not found", code: 1 };
    },
  };
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "keep"), "new runtime");
    await store.write({ version: 1, workers: [old] });
    assert.equal(await deleteTerminalRuntimeSafely({
      store,
      runner,
      eligible: () => true,
      agentDir,
      workerId: old.id,
      runId: old.runId,
      terminalAt: old.stoppedAt!,
      action: "full",
      now: Date.now(),
    }), false);
    assert.equal((await store.read()).workers[0].runId, "new-run");
    assert.equal(await readFile(join(runtime, "keep"), "utf8"), "new runtime");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a fresh cleanup claim blocks same-id reservation only during verification and quarantine", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-claim-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const old = worker();
  const runtime = workerRuntimeRoot(old.id, agentDir);
  let releaseVerification!: () => void;
  let verificationEntered!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseVerification = resolve; });
  const entered = new Promise<void>((resolve) => { verificationEntered = resolve; });
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units")) return { stdout: "", stderr: "", code: 0 };
      if (command === "systemctl") {
        verificationEntered();
        await blocked;
        return { stdout: "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n", stderr: "Unit not found", code: 1 };
      }
      return { stdout: "", stderr: "Unit not found", code: 1 };
    },
  };
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "old"), "old");
    await store.write({ version: 1, workers: [old] });
    const now = Date.now();
    const deleting = deleteTerminalRuntimeSafely({
      store,
      runner,
      eligible: () => true,
      agentDir,
      workerId: old.id,
      runId: old.runId,
      terminalAt: old.stoppedAt!,
      action: "full",
      now,
    });
    await entered;
    await assert.rejects(store.mutate((state) => reserveWorkerRecord(
      state,
      worker({ runId: "new-run", state: "provisioning", stoppedAt: undefined }),
    )), /runtime cleanup in progress/);
    releaseVerification();
    assert.equal(await deleting, true);
    await store.mutate((state) => reserveWorkerRecord(
      state,
      worker({ runId: "new-run", state: "provisioning", stoppedAt: undefined }),
    ));
    assert.equal((await store.read()).workers[0].runId, "new-run");
  } finally {
    releaseVerification?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("a workers.json commit failure after quarantine rename restores the full runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-commit-recovery-"));
  const agentDir = join(root, "agent");
  let armed = false;
  let cleanupCommits = 0;
  const store = new WorkerStore(join(root, "workers.json"), {
    faultInjector(point) {
      if (!armed || point !== "after_temp_write") return;
      cleanupCommits += 1;
      if (cleanupCommits === 3) throw new Error("injected state commit failure");
    },
  });
  const record = worker();
  const runtime = workerRuntimeRoot(record.id, agentDir);
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "primary-state"), "preserve me");
    await store.write({ version: 1, workers: [record] });
    armed = true;
    await assert.rejects(deleteTerminalRuntimeSafely({
      store,
      runner: absentRunner,
      eligible: () => true,
      agentDir,
      workerId: record.id,
      runId: record.runId,
      terminalAt: record.stoppedAt!,
      action: "full",
      now: Date.now(),
    }), /injected state commit failure/);
    assert.equal(await readFile(join(runtime, "primary-state"), "utf8"), "preserve me");
    const state = await store.read();
    assert.equal(state.workers[0].runId, record.runId);
    assert.equal(state.runtimeCleanupClaims?.length ?? 0, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a partial multi-path rename failure rolls quarantined paths back before clearing the claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-partial-rename-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const record = worker();
  const runtime = workerRuntimeRoot(record.id, agentDir);
  const health = join(agentDir, "intercom", "orchestrator", "opencode-peers", `${record.id}.health.json`);
  let renameCount = 0;
  try {
    await mkdir(runtime, { recursive: true });
    await mkdir(join(health, ".."), { recursive: true });
    await writeFile(join(runtime, "primary-state"), "runtime state");
    await writeFile(health, "health state");
    await store.write({ version: 1, workers: [record] });
    await assert.rejects(deleteTerminalRuntimeSafely({
      store,
      runner: absentRunner,
      eligible: () => true,
      agentDir,
      workerId: record.id,
      runId: record.runId,
      terminalAt: record.stoppedAt!,
      action: "full",
      now: Date.now(),
      renamePath: async (source, destination) => {
        renameCount += 1;
        if (renameCount === 2) throw new Error("injected partial rename failure");
        await rename(source, destination);
      },
    }), /injected partial rename failure/);
    assert.equal(await readFile(join(runtime, "primary-state"), "utf8"), "runtime state");
    assert.equal(await readFile(health, "utf8"), "health state");
    const state = await store.read();
    assert.equal(state.workers[0].runId, record.runId);
    assert.equal(state.runtimeCleanupClaims?.length ?? 0, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup recovery restores a runtime stranded in the moving phase", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-crash-recovery-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const token = "full-retained-worker-crash-token";
  const record = worker();
  const claim: RuntimeCleanupClaim = {
    token,
    workerId: record.id,
    runId: record.runId,
    terminalAt: record.stoppedAt,
    unit: record.unit,
    action: "full",
    claimedAt: Date.now(),
    ownerPid: 99_999_999,
    phase: "moving",
    pathIndexes: [0],
  };
  const runtime = workerRuntimeRoot(record.id, agentDir);
  const quarantine = join(agentDir, "intercom", "orchestrator", "runtime-quarantine", token);
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "primary-state"), "recover me");
    await mkdir(quarantine, { recursive: true });
    await rename(runtime, join(quarantine, "0"));
    await store.write({ version: 1, workers: [record], runtimeCleanupClaims: [claim] });
    const recovered = await recoverRuntimeCleanupClaims({ store, runner: absentRunner, agentDir });
    assert.equal(recovered.restored, 1);
    assert.equal(await readFile(join(runtime, "primary-state"), "utf8"), "recover me");
    assert.equal((await store.read()).runtimeCleanupClaims?.length ?? 0, 0);
    await assert.rejects(access(quarantine));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup recovery completes a moved orphan claim and removes its durable marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-orphan-recovery-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const token = "orphan-stranded-worker-token";
  const claim: RuntimeCleanupClaim = { token, workerId: "stranded-worker", action: "orphan", claimedAt: Date.now(), ownerPid: 99_999_999, phase: "moved", pathIndexes: [0] };
  const quarantine = join(agentDir, "intercom", "orchestrator", "runtime-quarantine", token);
  try {
    await mkdir(quarantine, { recursive: true });
    await writeFile(join(quarantine, "0"), "orphan state");
    await store.write({ version: 1, workers: [], runtimeCleanupClaims: [claim] });
    const recovered = await recoverRuntimeCleanupClaims({ store, runner: absentRunner, agentDir });
    assert.equal(recovered.completed, 1);
    await assert.rejects(access(quarantine));
    assert.equal((await store.read()).runtimeCleanupClaims?.length ?? 0, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a recursive deletion failure leaves a retryable durable claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-delete-retry-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const record = worker();
  const runtime = workerRuntimeRoot(record.id, agentDir);
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "primary-state"), "retry deletion");
    await store.write({ version: 1, workers: [record] });
    await assert.rejects(deleteTerminalRuntimeSafely({
      store,
      runner: absentRunner,
      eligible: () => true,
      agentDir,
      workerId: record.id,
      runId: record.runId,
      terminalAt: record.stoppedAt!,
      action: "full",
      now: Date.now(),
      removePath: async () => { throw new Error("injected recursive deletion failure"); },
    }), /injected recursive deletion failure/);
    const stranded = await store.read();
    assert.equal(stranded.workers[0].runId, record.runId);
    assert.equal(stranded.runtimeCleanupClaims?.[0].phase, "deleting");
    assert.equal(stranded.runtimeCleanupClaims?.[0].ownerPid, 0);
    const recovered = await recoverRuntimeCleanupClaims({ store, runner: absentRunner, agentDir });
    assert.equal(recovered.completed, 1);
    assert.deepEqual(recovered.errors, []);
    const cleaned = await store.read();
    assert.equal(cleaned.workers.length, 0);
    assert.equal(cleaned.runtimeCleanupClaims?.length ?? 0, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full retention quarantines atomically and releases the state lock before slow deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-full-respawn-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const old = worker();
  const runtime = workerRuntimeRoot(old.id, agentDir);
  let releaseDelete!: () => void;
  let deleteEntered!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseDelete = resolve; });
  const entered = new Promise<void>((resolve) => { deleteEntered = resolve; });
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "old-state"), "old");
    await store.write({ version: 1, workers: [old] });
    const deleting = deleteTerminalRuntimeSafely({
      store,
      runner: absentRunner,
      eligible: () => true,
      agentDir,
      workerId: old.id,
      runId: old.runId,
      terminalAt: old.stoppedAt!,
      action: "full",
      now: Date.now(),
      removePath: async (path) => {
        deleteEntered();
        await blocked;
        await rm(path, { recursive: true, force: true });
      },
    });
    await entered;
    await store.mutate((state) => {
      state.workers.push(worker({ id: "unrelated-worker", runId: "other-run" }));
    });
    await assert.rejects(store.mutate((state) => reserveWorkerRecord(
      state,
      worker({ runId: "new-run", state: "provisioning", stoppedAt: undefined, updatedAt: 2 }),
    )), /runtime cleanup in progress/);
    releaseDelete();
    assert.equal(await deleting, true);
    await store.mutate((state) => reserveWorkerRecord(
      state,
      worker({ runId: "new-run", state: "provisioning", stoppedAt: undefined, updatedAt: 2 }),
    ));
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "new-state"), "new");
    assert.equal((await store.read()).workers.find((candidate) => candidate.id === old.id)?.runId, "new-run");
    assert.equal(await readFile(join(runtime, "new-state"), "utf8"), "new");
  } finally {
    releaseDelete?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("orphan deletion quarantines atomically and does not hold the state lock during slow removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-orphan-respawn-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const runtime = workerRuntimeRoot("orphan-worker", agentDir);
  let releaseDelete!: () => void;
  let deleteEntered!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseDelete = resolve; });
  const entered = new Promise<void>((resolve) => { deleteEntered = resolve; });
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "old-state"), "old");
    await store.write({ version: 1, workers: [] });
    const deleting = deleteOrphanRuntimeSafely({
      store,
      runner: absentRunner,
      config: DEFAULT_CONFIG,
      agentDir,
      workerId: "orphan-worker",
      path: runtime,
      now: Date.now() + 2 * 60 * 60_000,
      removePath: async (path) => {
        deleteEntered();
        await blocked;
        await rm(path, { recursive: true, force: true });
      },
    });
    await entered;
    await store.mutate((state) => {
      state.workers.push(worker({ id: "unrelated-worker", runId: "other-run" }));
    });
    await assert.rejects(store.mutate((state) => reserveWorkerRecord(
      state,
      worker({ id: "orphan-worker", runId: "new-run", state: "provisioning", stoppedAt: undefined }),
    )), /runtime cleanup in progress/);
    releaseDelete();
    assert.equal(await deleting, true);
    await store.mutate((state) => reserveWorkerRecord(
      state,
      worker({ id: "orphan-worker", runId: "new-run", state: "provisioning", stoppedAt: undefined }),
    ));
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "new-state"), "new");
    assert.equal((await store.read()).workers.find((candidate) => candidate.id === "orphan-worker")?.runId, "new-run");
    assert.equal(await readFile(join(runtime, "new-state"), "utf8"), "new");
  } finally {
    releaseDelete?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("orphan cleanup rechecks registration after unit enumeration", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-orphan-register-race-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const runtime = workerRuntimeRoot("orphan-worker", agentDir);
  let registered = false;
  const runner: CommandRunner = {
    async exec(command, args) {
      if (command === "systemctl" && args.includes("list-units") && !registered) {
        registered = true;
        await store.mutate((state) => {
          state.workers.push(worker({ id: "orphan-worker", runId: "new-run", state: "provisioning", stoppedAt: undefined }));
        });
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "keep"), "registered runtime");
    await store.write({ version: 1, workers: [] });
    assert.equal(await deleteOrphanRuntimeSafely({
      store,
      runner,
      config: DEFAULT_CONFIG,
      agentDir,
      workerId: "orphan-worker",
      path: runtime,
      now: Date.now() + 2 * 60 * 60_000,
    }), false);
    assert.equal((await store.read()).workers[0].runId, "new-run");
    assert.equal(await readFile(join(runtime, "keep"), "utf8"), "registered runtime");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("orphan cleanup refuses a matching loaded unit and an unverifiable unit list", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-orphan-unit-"));
  const agentDir = join(root, "agent");
  const store = new WorkerStore(join(root, "workers.json"));
  const runtime = workerRuntimeRoot("orphan-worker", agentDir);
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "keep"), "live runtime");
    await store.write({ version: 1, workers: [] });
    const loaded: CommandRunner = {
      async exec() {
        return { stdout: "agent-intercom-worker-orphan-worker-live.service loaded active running\n", stderr: "", code: 0 };
      },
    };
    const input = {
      store,
      config: DEFAULT_CONFIG,
      agentDir,
      workerId: "orphan-worker",
      path: runtime,
      now: Date.now() + 2 * 60 * 60_000,
    };
    assert.equal(await deleteOrphanRuntimeSafely({ ...input, runner: loaded }), false);
    const unavailable: CommandRunner = {
      async exec() {
        return { stdout: "", stderr: "Failed to connect to bus", code: 1 };
      },
    };
    assert.equal(await deleteOrphanRuntimeSafely({ ...input, runner: unavailable }), false);
    assert.equal(await readFile(join(runtime, "keep"), "utf8"), "live runtime");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
