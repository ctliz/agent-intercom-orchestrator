import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { resolvePiRuntime } from "../src/pi-runtime.ts";
import { buildWorkerArgs } from "../src/workers.ts";

async function fakeManagerPi(root: string, packageName = "@earendil-works/pi-coding-agent"): Promise<{ entry: string; node: string }> {
  const [scope, name] = packageName.split("/");
  const packageRoot = join(root, "node_modules", scope, name);
  const entry = join(packageRoot, "dist", "cli.js");
  const node = join(root, "node");
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: packageName,
    version: "1.2.3",
    bin: { pi: "dist/cli.js" },
  }));
  await writeFile(entry, "#!/usr/bin/env node\n");
  await writeFile(node, "#!/bin/sh\nexit 0\n");
  await chmod(node, 0o755);
  return { entry, node };
}

test("unchanged pi-peer uses the manager's concrete Pi package instead of its npx wrapper", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-pi-runtime-"));
  try {
    const manager = await fakeManagerPi(root);
    const profile = structuredClone(DEFAULT_CONFIG.profiles["pi-peer"]);
    const runtime = await resolvePiRuntime({
      profileName: "pi-peer",
      profile,
      configuredExecutable: "/home/test/.local/bin/pi",
      builtInProfile: profile,
      managerEntry: manager.entry,
      managerExecutable: manager.node,
    });

    assert.deepEqual(runtime, {
      command: manager.node,
      args: [manager.entry],
      source: "manager-runtime",
      version: "1.2.3",
    });
    assert.ok(!runtime.command.includes("npx"));
    assert.ok(runtime.args.every((arg) => !arg.includes("npx")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the legacy upstream Pi package name is also accepted", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-legacy-pi-runtime-"));
  try {
    const manager = await fakeManagerPi(root, "@mariozechner/pi-coding-agent");
    const profile = structuredClone(DEFAULT_CONFIG.profiles["pi-peer"]);
    const runtime = await resolvePiRuntime({
      profileName: "pi-peer",
      profile,
      builtInProfile: profile,
      managerEntry: manager.entry,
      managerExecutable: manager.node,
    });
    assert.equal(runtime?.source, "manager-runtime");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the verified manager runtime rescues a missing built-in Pi wrapper", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-pi-runtime-rescue-"));
  try {
    const manager = await fakeManagerPi(root);
    const profile = structuredClone(DEFAULT_CONFIG.profiles["pi-peer"]);
    const runtime = await resolvePiRuntime({
      profileName: "pi-peer",
      profile,
      configuredExecutable: undefined,
      builtInProfile: profile,
      managerEntry: manager.entry,
      managerExecutable: manager.node,
    });
    assert.deepEqual(runtime, {
      command: manager.node,
      args: [manager.entry],
      source: "manager-runtime",
      version: "1.2.3",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("custom and explicitly overridden Pi profiles preserve their configured commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-pi-explicit-"));
  try {
    const manager = await fakeManagerPi(root);
    const builtIn = structuredClone(DEFAULT_CONFIG.profiles["pi-peer"]);
    for (const [profileName, profile] of [
      ["pinned-pi", { ...builtIn, command: "/opt/pi-0.80/bin/pi" }],
      ["pi-peer", { ...builtIn, command: "/opt/team/pi-wrapper" }],
    ] as const) {
      const runtime = await resolvePiRuntime({
        profileName,
        profile,
        configuredExecutable: profile.command,
        builtInProfile: builtIn,
        managerEntry: manager.entry,
        managerExecutable: manager.node,
      });
      assert.deepEqual(runtime, { command: profile.command, args: [], source: "profile" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unverified manager entries fall back to the configured Pi command", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-pi-fallback-"));
  try {
    const manager = await fakeManagerPi(root);
    const unrelated = join(root, "not-the-declared-bin.js");
    await writeFile(unrelated, "#!/usr/bin/env node\n");
    const profile = structuredClone(DEFAULT_CONFIG.profiles["pi-peer"]);
    const runtime = await resolvePiRuntime({
      profileName: "pi-peer",
      profile,
      configuredExecutable: "/home/test/.local/bin/pi",
      builtInProfile: profile,
      managerEntry: unrelated,
      managerExecutable: manager.node,
    });
    assert.deepEqual(runtime, { command: "/home/test/.local/bin/pi", args: [], source: "profile" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unverified manager entry with no configured fallback remains unresolved", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-pi-no-runtime-"));
  try {
    const manager = await fakeManagerPi(root);
    const unrelated = join(root, "not-pi.js");
    await writeFile(unrelated, "#!/usr/bin/env node\n");
    const profile = structuredClone(DEFAULT_CONFIG.profiles["pi-peer"]);
    const runtime = await resolvePiRuntime({
      profileName: "pi-peer",
      profile,
      configuredExecutable: undefined,
      builtInProfile: profile,
      managerEntry: unrelated,
      managerExecutable: manager.node,
    });
    assert.equal(runtime, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manager runtime prefix leaves persistent Pi session arguments unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-intercom-pi-session-"));
  try {
    const manager = await fakeManagerPi(root);
    const profile = structuredClone(DEFAULT_CONFIG.profiles["pi-peer"]);
    const runtime = await resolvePiRuntime({
      profileName: "pi-peer",
      profile,
      configuredExecutable: "/home/test/.local/bin/pi",
      builtInProfile: profile,
      managerEntry: manager.entry,
      managerExecutable: manager.node,
    });
    assert.ok(runtime);
    const workerArgs = buildWorkerArgs({
      harness: "pi",
      profile,
      workerId: "same-session",
      cwd: "/repo",
      role: "advisor",
      task: "Review",
      managerTarget: "manager",
    });
    const launchArgs = [...runtime.args, ...workerArgs];

    assert.equal(launchArgs[0], manager.entry);
    assert.deepEqual(launchArgs.slice(launchArgs.indexOf("--session-id"), launchArgs.indexOf("--session-id") + 2), ["--session-id", "same-session"]);
    assert.deepEqual(launchArgs.slice(launchArgs.indexOf("--name"), launchArgs.indexOf("--name") + 2), ["--name", "same-session"]);
    assert.ok(launchArgs.includes("--mode"));
    assert.ok(launchArgs.includes("rpc"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
