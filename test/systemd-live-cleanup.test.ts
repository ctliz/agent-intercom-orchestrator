import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import test from "node:test";
import { getUserManagerHealth, workerSubmissionRejection } from "../src/systemd.ts";
import { systemdUserManagerAvailable } from "./systemd-support.ts";

const execFileAsync = promisify(execFile);
const available = systemdUserManagerAvailable();

async function systemctl(...args: string[]): Promise<string> {
  const result = await execFileAsync("systemctl", ["--user", ...args], { encoding: "utf8", timeout: 10_000 });
  return result.stdout;
}

async function runTransient(unit: string, properties: string[], command: string[]): Promise<void> {
  await execFileAsync("systemd-run", [
    "--user",
    "--no-block",
    `--unit=${unit.replace(/\.service$/, "")}`,
    ...properties.map((property) => `--property=${property}`),
    ...command,
  ], { encoding: "utf8", timeout: 10_000 });
}

async function waitFor(unit: string, predicate: (values: Record<string, string>) => boolean, timeoutMs = 8_000): Promise<Record<string, string>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, string> = {};
  while (Date.now() < deadline) {
    const output = await systemctl("show", unit, "--property=LoadState,ActiveState,SubState,Result,MainPID").catch(() => "LoadState=not-found\n");
    last = Object.fromEntries(output.trim().split("\n").filter(Boolean).map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${unit}: ${JSON.stringify(last)}`);
}

function commandRunner() {
  return {
    async exec(command: string, args: string[], options?: { timeout?: number }) {
      try {
        const result = await execFileAsync(command, args, { encoding: "utf8", timeout: options?.timeout ?? 10_000 });
        return { stdout: result.stdout, stderr: result.stderr, code: 0 };
      } catch (error) {
        const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string; killed?: boolean };
        return {
          stdout: failure.stdout ?? "",
          stderr: failure.stderr ?? failure.message,
          code: typeof failure.code === "number" ? failure.code : 1,
          killed: failure.killed,
        };
      }
    },
  };
}

async function cleanupUnits(units: string[]): Promise<void> {
  await Promise.all(units.map(async (unit) => {
    await systemctl("stop", unit).catch(() => undefined);
    await systemctl("reset-failed", unit).catch(() => undefined);
  }));
}

test("live user manager bounds a cleanup cgroup without killing unrelated work and permits recovery", { skip: !available }, async () => {
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const cleanup = `agent-intercom-test-cleanup-${suffix}.service`;
  const unrelated = `agent-intercom-test-unrelated-${suffix}.service`;
  try {
    await runTransient(unrelated, ["KillMode=control-group", "RuntimeMaxSec=30"], ["/usr/bin/sleep", "30"]);
    await runTransient(cleanup, ["Type=exec", "KillMode=control-group", "RuntimeMaxSec=2", "TimeoutStopSec=1"], ["/bin/sh", "-c", "trap '' TERM; sleep 30 & wait"]);
    await waitFor(unrelated, (state) => state.ActiveState === "active");
    await waitFor(cleanup, (state) => state.ActiveState === "active");

    const expired = await waitFor(cleanup, (state) => state.ActiveState === "failed", 7_000);
    assert.equal(expired.Result, "timeout");
    const survivor = await waitFor(unrelated, (state) => state.ActiveState === "active");
    assert.notEqual(survivor.MainPID, "0", "the unrelated unit must survive the cleanup deadline kill");

    await systemctl("reset-failed", cleanup);
    await runTransient(cleanup, ["Type=exec", "KillMode=control-group", "RuntimeMaxSec=5"], ["/usr/bin/true"]);
    const recovered = await waitFor(cleanup, (state) => state.ActiveState === "inactive" && state.Result === "success");
    assert.equal(recovered.Result, "success", "the exact cleanup unit can run again after deadline recovery");
  } finally {
    await cleanupUnits([cleanup, unrelated]);
  }
});

test("live active cleanup does not block unrelated submissions below the manager job cap", { skip: !available }, async () => {
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const cleanup = `agent-intercom-test-cleanup-active-${suffix}.service`;
  const spawned = Array.from({ length: 4 }, (_, index) => `agent-intercom-test-spawn-${suffix}-${index}.service`);
  try {
    await runTransient(cleanup, ["Type=exec", "KillMode=control-group", "RuntimeMaxSec=30"], ["/usr/bin/sleep", "30"]);
    await waitFor(cleanup, (state) => state.ActiveState === "active");

    const health = await getUserManagerHealth(commandRunner(), { settleMs: 25 });
    assert.equal(workerSubmissionRejection(health), undefined, JSON.stringify(health));

    await Promise.all(spawned.map((unit) => runTransient(unit, ["KillMode=control-group", "RuntimeMaxSec=10"], ["/usr/bin/sleep", "2"])));
    await Promise.all(spawned.map((unit) => waitFor(unit, (state) => state.ActiveState === "active")));
    assert.equal((await systemctl("is-active", cleanup)).trim(), "active");
  } finally {
    await cleanupUnits([cleanup, ...spawned]);
  }
});
