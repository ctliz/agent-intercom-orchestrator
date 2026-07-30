import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const launcher = new URL("../src/adapter-readiness-launcher.mjs", import.meta.url);

async function run(root: string, harness: "codex" | "claude", body: string) {
  const fake = join(root, `fake-${harness}.mjs`);
  const healthPath = join(root, `${harness}.health.json`);
  await writeFile(fake, body);
  const child = spawn(process.execPath, [launcher.pathname, "--harness", harness, "--", process.execPath, fake], {
    env: {
      ...process.env,
      AGENT_INTERCOM_ADAPTER_HEALTH_PATH: healthPath,
      AGENT_INTERCOM_RUN_ID: `run-${harness}`,
      AGENT_INTERCOM_WORKER_ID: `worker-${harness}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  const health = JSON.parse(await readFile(healthPath, "utf8"));
  return { code, health, stderr: Buffer.concat(stderr).toString("utf8") };
}

test("Codex and Claude post-connect markers produce exact-run readiness health", async () => {
  const root = await mkdtemp(join(tmpdir(), "adapter-ready-success-"));
  try {
    const codex = await run(root, "codex", "process.stderr.write('codex-intercom bridge running 1 virtual agent(s)\\n'); setTimeout(() => process.exit(0), 20);\n");
    assert.equal(codex.code, 0);
    assert.equal(codex.health.runId, "run-codex");
    assert.equal(codex.health.workerId, "worker-codex");
    assert.equal(codex.health.ready, true);
    assert.equal(codex.health.connected, true);
    assert.match(codex.stderr, /bridge running/);

    const claude = await run(root, "claude", "process.stderr.write('claude-intercom worker running 1 agent(s)\\n'); setTimeout(() => process.exit(0), 20);\n");
    assert.equal(claude.code, 0);
    assert.equal(claude.health.runId, "run-claude");
    assert.equal(claude.health.ready, true);
    assert.equal(claude.health.connected, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adapter exit before its post-connect marker records a readiness failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "adapter-ready-failure-"));
  try {
    const result = await run(root, "codex", "process.stderr.write('startup failed\\n'); process.exit(7);\n");
    assert.equal(result.code, 7);
    assert.equal(result.health.ready, false);
    assert.equal(result.health.connected, false);
    assert.match(result.health.error, /exited before readiness/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
