import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readCleanupRunDiagnostics, writeCleanupRunState } from "../src/cleanup-state.ts";

test("cleanup run state is durable, content-free, and reports age/result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-state-"));
  try {
    const path = join(directory, "cleanup-run.json");
    await writeCleanupRunState(path, {
      version: 1,
      outcome: "partial",
      startedAt: 1_000,
      updatedAt: 1_250,
      durationMs: 250,
      candidates: 7,
      handled: 5,
      errors: 1,
      deferred: 1,
      budgetExhausted: true,
    });
    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(raw, /worker|task|prompt|credential|path/i);
    const diagnostics = await readCleanupRunDiagnostics(path, 2_000);
    assert.equal(diagnostics.state, "partial");
    assert.equal(diagnostics.ageMs, 750);
    assert.deepEqual(diagnostics.result, {
      version: 1,
      outcome: "partial",
      startedAt: 1_000,
      updatedAt: 1_250,
      durationMs: 250,
      candidates: 7,
      handled: 5,
      errors: 1,
      deferred: 1,
      budgetExhausted: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cleanup run diagnostics fail closed on malformed or unknown state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-intercom-cleanup-state-invalid-"));
  try {
    const path = join(directory, "cleanup-run.json");
    assert.deepEqual(await readCleanupRunDiagnostics(path), { state: "never" });
    await writeFile(path, JSON.stringify({ version: 1, outcome: "ok", startedAt: 10, updatedAt: 9 }));
    assert.deepEqual(await readCleanupRunDiagnostics(path), { state: "invalid" });
    await writeFile(path, JSON.stringify({ version: 1, outcome: "ok", startedAt: 10, updatedAt: 10, worker: "secret" }));
    assert.deepEqual(await readCleanupRunDiagnostics(path), { state: "invalid" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
