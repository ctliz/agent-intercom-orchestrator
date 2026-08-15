import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareWorkerRuntime, pruneWorkerRuntimeCaches } from "../src/runtime.ts";
import { supportsUserMountNamespaces } from "./systemd-support.ts";

test("clean environment launcher drops unrelated manager secrets", () => {
  const launcher = fileURLToPath(new URL("../src/clean-env-launcher.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [launcher, "--", "/usr/bin/env"], {
    encoding: "utf8",
    env: {
      ...process.env,
      UNEXPECTED_SECRET_DO_NOT_INHERIT: "leaked",
      EXPLICIT_WORKER_VALUE: "kept",
      AGENT_INTERCOM_ENV_ALLOWLIST: "EXPLICIT_WORKER_VALUE",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^EXPLICIT_WORKER_VALUE=kept$/m);
  assert.doesNotMatch(result.stdout, /UNEXPECTED_SECRET_DO_NOT_INHERIT/);
});

test("clean environment launcher removes ambient scope and manifest unless explicitly allowlisted", () => {
  const launcher = fileURLToPath(new URL("../src/clean-env-launcher.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [launcher, "--", "/usr/bin/env"], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_INTERCOM_SCOPE_ID: "ambient_scope_1234567890",
      AGENT_INTERCOM_TEAM_MANIFEST: "/tmp/ambient_manifest.json",
      EXPLICIT_ALLOWED: "kept",
      AGENT_INTERCOM_ENV_ALLOWLIST: "EXPLICIT_ALLOWED",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^EXPLICIT_ALLOWED=kept$/m);
  assert.doesNotMatch(result.stdout, /AGENT_INTERCOM_SCOPE_ID/);
  assert.doesNotMatch(result.stdout, /AGENT_INTERCOM_TEAM_MANIFEST/);
});

test("identity environment launcher scrubs inherited launcher/manifest/harness IDs while preserving normal and assigned env", () => {
  const launcher = fileURLToPath(new URL("../src/identity-env-launcher.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [launcher, "--", "/usr/bin/env"], {
    encoding: "utf8",
    env: {
      ...process.env,
      NORMAL_USER_VARIABLE: "user_value",
      CUSTOM_PROJECT_ROOT: "/home/user/project",
      // Inherited TmuxDeck and team manifest keys to be stripped
      TMUXDECK_WORKSPACE: "deck_main",
      TMUXDECK_PANE_ID: "%3",
      TMUXDECK_ROLE: "lead",
      AGENT_INTERCOM_TEAM_MANIFEST: "/tmp/teams/team_123.json",
      AGENT_INTERCOM_GENERIC_INHERITED: "inherited_generic_value",
      // Inherited harness identities to be stripped
      PI_INTERCOM_NAME: "inherited_pi_name",
      PI_SESSION_ID: "inherited_pi_sess",
      PI_SUBAGENT_INTERCOM_SESSION_ID: "inherited_pi_subagent_sess",
      PI_SUBAGENT_INTERCOM_SESSION_NAME: "inherited_pi_subagent_name",
      CLAUDE_PEER_ID: "inherited_claude_peer_id",
      CLAUDE_PEER_NAME: "inherited_claude_peer_name",
      CLAUDE_INTERCOM_NAME: "inherited_claude_name",
      CLAUDE_SESSION_ID: "inherited_claude_sess",
      CODEX_PEER_ID: "inherited_codex_peer_id",
      CODEX_PEER_NAME: "inherited_codex_peer_name",
      CODEX_INTERCOM_NAME: "inherited_codex_name",
      CODEX_SESSION_ID: "inherited_codex_sess",
      OPENCODE_SESSION_ID: "inherited_opencode_sess",
      OPENCODE_PEER_NAME: "inherited_opencode_peer_name",
      OPENCODE_INTERCOM_NAME: "inherited_opencode_name",
      // Explicitly assigned child environment retained via allowlist
      AGENT_INTERCOM_WORKER_ID: "assigned_worker_42",
      AGENT_INTERCOM_ROLE: "builder",
      AGENT_INTERCOM_MANAGER_TARGET: "manager_session_target_99",
      AGENT_INTERCOM_SCOPE_ID: "scope_assigned_abc",
      AGENT_INTERCOM_BOSS_RUN_ID: "boss_run_assigned_xyz",
      AGENT_INTERCOM_BOSS_AUTHORITY_PUBKEY: "boss_pubkey_assigned",
      OPENCODE_INTERCOM_SESSION_ID: "opencode_sess_assigned_100",
      AGENT_INTERCOM_ENV_ALLOWLIST: "AGENT_INTERCOM_WORKER_ID,AGENT_INTERCOM_ROLE,AGENT_INTERCOM_MANAGER_TARGET,AGENT_INTERCOM_SCOPE_ID,AGENT_INTERCOM_BOSS_RUN_ID,AGENT_INTERCOM_BOSS_AUTHORITY_PUBKEY,OPENCODE_INTERCOM_SESSION_ID",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  // Preserved normal user environment
  assert.match(result.stdout, /^NORMAL_USER_VARIABLE=user_value$/m);
  assert.match(result.stdout, /^CUSTOM_PROJECT_ROOT=\/home\/user\/project$/m);
  // Retained assigned identity variables
  assert.match(result.stdout, /^AGENT_INTERCOM_WORKER_ID=assigned_worker_42$/m);
  assert.match(result.stdout, /^AGENT_INTERCOM_ROLE=builder$/m);
  assert.match(result.stdout, /^AGENT_INTERCOM_MANAGER_TARGET=manager_session_target_99$/m);
  assert.match(result.stdout, /^AGENT_INTERCOM_SCOPE_ID=scope_assigned_abc$/m);
  assert.match(result.stdout, /^AGENT_INTERCOM_BOSS_RUN_ID=boss_run_assigned_xyz$/m);
  assert.match(result.stdout, /^AGENT_INTERCOM_BOSS_AUTHORITY_PUBKEY=boss_pubkey_assigned$/m);
  assert.match(result.stdout, /^OPENCODE_INTERCOM_SESSION_ID=opencode_sess_assigned_100$/m);
  // Stripped inherited variables
  assert.doesNotMatch(result.stdout, /TMUXDECK_/);
  assert.doesNotMatch(result.stdout, /AGENT_INTERCOM_TEAM_MANIFEST/);
  assert.doesNotMatch(result.stdout, /AGENT_INTERCOM_GENERIC_INHERITED/);
  assert.doesNotMatch(result.stdout, /inherited_pi_/);
  assert.doesNotMatch(result.stdout, /PI_SESSION_ID/);
  assert.doesNotMatch(result.stdout, /PI_SUBAGENT_INTERCOM_/);
  assert.doesNotMatch(result.stdout, /inherited_claude_/);
  assert.doesNotMatch(result.stdout, /CLAUDE_PEER_/);
  assert.doesNotMatch(result.stdout, /CLAUDE_SESSION_ID/);
  assert.doesNotMatch(result.stdout, /CLAUDE_INTERCOM_/);
  assert.doesNotMatch(result.stdout, /inherited_codex_/);
  assert.doesNotMatch(result.stdout, /CODEX_PEER_/);
  assert.doesNotMatch(result.stdout, /CODEX_SESSION_ID/);
  assert.doesNotMatch(result.stdout, /CODEX_INTERCOM_/);
  assert.doesNotMatch(result.stdout, /inherited_opencode_/);
  assert.doesNotMatch(result.stdout, /OPENCODE_SESSION_ID/);
  assert.doesNotMatch(result.stdout, /OPENCODE_PEER_/);
  assert.doesNotMatch(result.stdout, /OPENCODE_INTERCOM_NAME/);
  assert.doesNotMatch(result.stdout, /AGENT_INTERCOM_ENV_ALLOWLIST/);
});

test("clean launcher removes a sentinel inherited from the systemd user manager", (t) => {
  if (process.platform !== "linux" || spawnSync("systemctl", ["--user", "show-environment"]).status !== 0) {
    t.skip("systemd user manager is unavailable");
    return;
  }
  const launcher = fileURLToPath(new URL("../src/clean-env-launcher.mjs", import.meta.url));
  const sentinel = "UNEXPECTED_SECRET_DO_NOT_INHERIT";
  assert.equal(spawnSync("systemctl", ["--user", "set-environment", `${sentinel}=leaked`]).status, 0);
  try {
    const result = spawnSync("systemd-run", ["--user", "--wait", "--pipe", process.execPath, launcher, "--", "/usr/bin/env"], { encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.doesNotMatch(result.stdout, new RegExp(sentinel));
  } finally {
    spawnSync("systemctl", ["--user", "unset-environment", sentinel]);
  }
});

test("worker runtime pre-creates isolated Codex state and seeds config without exposing the source", async () => {
  const home = await mkdtemp(join(tmpdir(), "agent-intercom-runtime-home-"));
  const agentDir = join(home, ".pi", "agent");
  try {
    await mkdir(join(home, ".codex", "skills"), { recursive: true });
    await mkdir(join(home, ".codex-i-m"), { recursive: true });
    await mkdir(join(agentDir, "intercom", "inbox"), { recursive: true });
    await writeFile(join(home, ".codex", "auth.json"), "source-auth\n");
    await writeFile(join(home, ".codex", "config.toml"), "source-config\n");
    await writeFile(join(home, ".codex", "skills", "example.md"), "skill\n");
    await writeFile(join(home, ".codex-i-m", "config.toml"), "minimal-config\n");

    const runtime = await prepareWorkerRuntime("codex", "worker-one", agentDir, { homeDir: home, runtimeDir: join(home, "run") });
    const codexHome = runtime.environment.CODEX_HOME;
    const persistentCodexHome = join(runtime.root, "home", ".codex");
    assert.ok(codexHome);
    assert.equal(await readFile(join(persistentCodexHome, "auth.json"), "utf8"), "source-auth\n");
    assert.equal(await readlink(join(persistentCodexHome, "skills")), join(home, ".codex", "skills"));
    await writeFile(join(persistentCodexHome, "auth.json"), "worker-copy\n");
    assert.equal(await readFile(join(home, ".codex", "auth.json"), "utf8"), "source-auth\n");
    assert.deepEqual(runtime.writablePaths, []);
    assert.deepEqual(runtime.readOnlyPaths, []);
    assert.ok(runtime.inaccessiblePaths.includes(dirname(runtime.root)));
    assert.ok(runtime.bindPaths.includes(`${runtime.root}:${runtime.workerRoot}`));
    assert.equal(runtime.environment.XDG_RUNTIME_DIR, runtime.workerRoot);
    assert.equal(runtime.environment.AGENT_INTERCOM_BROKER_SOURCE, join(agentDir, "intercom", "broker.sock"));
    assert.ok(runtime.extraArgs.includes(`mcp_servers.codex-intercom.env.PI_CODING_AGENT_DIR=${JSON.stringify(runtime.environment.PI_CODING_AGENT_DIR)}`));
    assert.ok(runtime.extraArgs.includes(join(runtime.workerRoot, "coi-state.json")));

    const minimal = await prepareWorkerRuntime("codex", "worker-minimal", agentDir, { homeDir: home, runtimeDir: join(home, "run"), profileName: "codex-minimal" });
    assert.equal(minimal.environment.CODEX_HOME, join(minimal.workerRoot, "home", ".codex-i-m"));
    assert.equal(await readFile(join(minimal.root, "home", ".codex-i-m", "config.toml"), "utf8"), "minimal-config\n");
    await assert.rejects(access(join(minimal.root, "home", ".codex", "auth.json")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("worker runtime creates absent Claude and OpenCode homes before launch", async () => {
  const home = await mkdtemp(join(tmpdir(), "agent-intercom-runtime-empty-"));
  const agentDir = join(home, ".pi", "agent");
  try {
    const claudeAlias = join(home, ".config", "claude-aliases", "profiles", "cliproxy");
    await mkdir(claudeAlias, { recursive: true });
    await writeFile(join(home, ".config", "claude-aliases", "env"), "CLIPROXY_API_KEY=required-provider-key\nUNRELATED_PROVIDER_SECRET=must-not-copy\n");
    await writeFile(join(claudeAlias, "settings.json"), "{}\n");
    await writeFile(join(claudeAlias, ".claude.json"), JSON.stringify({ onboarding: true, projects: { "/secret/project": {} } }));
    await writeFile(join(claudeAlias, ".git-credentials"), "https://secret@example.invalid\n");
    const claude = await prepareWorkerRuntime("claude", "claude-first-run", agentDir, { homeDir: home, runtimeDir: join(home, "run") });
    assert.equal(claude.environment.HOME, join(claude.workerRoot, "home"));
    assert.equal(claude.environment.CLAUDE_CONFIG_DIR, join(claude.workerRoot, "home", ".config", "claude-aliases", "profiles", "cliproxy"));
    const persistentAlias = join(claude.root, "home", ".config", "claude-aliases", "profiles", "cliproxy");
    assert.deepEqual(JSON.parse(await readFile(join(persistentAlias, ".claude.json"), "utf8")), { onboarding: true });
    assert.doesNotMatch(await readFile(join(claude.root, "home", ".config", "claude-aliases", "env"), "utf8"), /UNRELATED_PROVIDER_SECRET/);
    await assert.rejects(access(join(persistentAlias, ".git-credentials")));
    assert.ok(claude.extraArgs.includes("--dangerously-skip-permissions"));
    const opencode = await prepareWorkerRuntime("opencode", "opencode-first-run", agentDir, { homeDir: home, runtimeDir: join(home, "run") });
    assert.equal(opencode.environment.XDG_RUNTIME_DIR, opencode.workerRoot);
    assert.equal(opencode.environment.XDG_DATA_HOME, join(opencode.workerRoot, "home", ".local", "share"));
    await writeFile(join(opencode.root, "home", ".local", "share", "opencode", "runtime-proof"), "ok\n");
    await assert.rejects(access(join(opencode.root, "home", ".config", "opencode", "plugins")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("retained worker cache pruning removes disposable caches without deleting harness state", async () => {
  const home = await mkdtemp(join(tmpdir(), "agent-intercom-runtime-prune-"));
  const agentDir = join(home, ".pi", "agent");
  try {
    const runtime = await prepareWorkerRuntime("opencode", "cache-worker", agentDir, { homeDir: home, runtimeDir: join(home, "run") });
    const persistentHome = join(runtime.root, "home");
    await mkdir(join(persistentHome, ".cache", "npm", "_npx"), { recursive: true });
    await mkdir(join(persistentHome, ".cache", "pip"), { recursive: true });
    await writeFile(join(persistentHome, ".cache", "npm", "_npx", "large-binary"), "cache\n");
    await writeFile(join(persistentHome, ".cache", "pip", "wheel"), "cache\n");
    await writeFile(join(persistentHome, ".local", "share", "opencode", "session-state"), "keep\n");
    await pruneWorkerRuntimeCaches("cache-worker", agentDir);
    await assert.rejects(access(join(persistentHome, ".cache", "npm")));
    await assert.rejects(access(join(persistentHome, ".cache", "pip")));
    assert.equal(await readFile(join(persistentHome, ".local", "share", "opencode", "session-state"), "utf8"), "keep\n");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("worker runtimes isolate writable harness state by worker id", async () => {
  const home = await mkdtemp(join(tmpdir(), "agent-intercom-runtime-isolation-"));
  const agentDir = join(home, ".pi", "agent");
  try {
    const first = await prepareWorkerRuntime("pi", "worker-first", agentDir, { homeDir: home, runtimeDir: join(home, "run") });
    const second = await prepareWorkerRuntime("pi", "worker-second", agentDir, { homeDir: home, runtimeDir: join(home, "run") });
    assert.notEqual(first.root, second.root);
    assert.equal(first.workerRoot, second.workerRoot);
    assert.equal(first.environment.PI_CODING_AGENT_DIR, second.environment.PI_CODING_AGENT_DIR);
    await writeFile(join(first.root, "private-state"), "first\n");
    await assert.rejects(access(join(second.root, "private-state")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("systemd exposes only the assigned worker state through the fixed private mountpoint", async (t) => {
  if (!supportsUserMountNamespaces()) {
    t.skip("systemd user mount namespaces are unavailable");
    return;
  }
  const home = await mkdtemp(join(tmpdir(), "aio-runtime-mount-"));
  const agentDir = join(home, ".pi", "agent");
  try {
    const first = await prepareWorkerRuntime("pi", "mount-first", agentDir, { homeDir: home, runtimeDir: join(home, "run") });
    const second = await prepareWorkerRuntime("pi", "mount-second", agentDir, { homeDir: home, runtimeDir: join(home, "run") });
    await writeFile(join(first.root, "private-state"), "first\n");
    await writeFile(join(second.root, "private-state"), "second\n");
    const result = spawnSync("systemd-run", [
      "--user", "--wait", "--pipe",
      "--property=ProtectSystem=strict",
      "--property=ProtectHome=read-only",
      `--property=InaccessiblePaths=${dirname(first.root)}`,
      `--property=BindPaths=${first.root}:${first.workerRoot}`,
      "/bin/sh", "-c",
      `test \"$(cat ${JSON.stringify(join(first.workerRoot, "private-state"))})\" = first && ! cat ${JSON.stringify(join(second.root, "private-state"))} && echo updated >> ${JSON.stringify(join(first.workerRoot, "private-state"))}`,
    ], { encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(await readFile(join(first.root, "private-state"), "utf8"), /updated/);
    assert.equal(await readFile(join(second.root, "private-state"), "utf8"), "second\n");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("sandbox supervisor proxies a private short broker socket and hides shared Intercom state", async (t) => {
  if (!existsSync("/usr/bin/bwrap")) {
    t.skip("bubblewrap is unavailable");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "aio-proxy-"));
  const sharedIntercom = join(root, "shared-intercom");
  await mkdir(sharedIntercom, { recursive: true });
  const source = join(sharedIntercom, "broker.sock");
  const sharedSecret = join(sharedIntercom, "other-worker-message.json");
  const legacyRuntime = join(root, "legacy-workers");
  const legacySecret = join(legacyRuntime, "other-worker", "auth.json");
  await mkdir(dirname(legacySecret), { recursive: true });
  await writeFile(sharedSecret, "secret\n");
  await writeFile(legacySecret, "legacy-secret\n");
  const privateAgent = join(root, "private-agent");
  const target = join(privateAgent, "intercom", "broker.sock");
  const supervisor = fileURLToPath(new URL("../src/sandbox-supervisor.mjs", import.meta.url));
  const server = net.createServer((socket) => socket.on("data", (chunk) => socket.write(chunk)));
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(source, resolve);
    });
    const childScript = `
      const fs = require("node:fs");
      const net = require("node:net");
      const path = require("node:path");
      const { spawnSync } = require("node:child_process");
      if (fs.existsSync(${JSON.stringify(sharedSecret)})) process.exit(4);
      if (fs.existsSync(${JSON.stringify(legacySecret)})) process.exit(5);
      const supervisorPid = process.env.AGENT_INTERCOM_SANDBOX_SUPERVISOR_PID;
      const supervisorRoot = path.join("/proc", supervisorPid, "root", ${JSON.stringify(sharedSecret)});
      if (fs.existsSync(supervisorRoot)) process.exit(6);
      if (fs.existsSync(path.join("/proc", supervisorPid))) process.exit(7);
      for (const pid of fs.readdirSync("/proc").filter((entry) => /^\\d+$/.test(entry))) {
        if (fs.existsSync(path.join("/proc", pid, "root", ${JSON.stringify(sharedSecret)}))) process.exit(8);
      }
      const nested = spawnSync("/usr/bin/bwrap", [
        "--unshare-user", "--unshare-pid", "--tmpfs", "/", "--dev", "/dev",
        "--ro-bind", "/bin", "/bin", "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64",
        "--proc", "/proc", "/bin/true",
      ], { encoding: "utf8" });
      if (nested.status !== 0) {
        console.error(nested.stderr);
        process.exit(9);
      }
      const socket = net.createConnection(path.join(process.env.PI_CODING_AGENT_DIR, "intercom", "broker.sock"));
      socket.on("connect", () => socket.write("proxy-proof"));
      socket.on("data", (chunk) => process.exit(chunk.toString() === "proxy-proof" ? 0 : 3));
      socket.on("error", (error) => { console.error(error); process.exit(2); });
    `;
    const child = spawn(process.execPath, [supervisor, "--", process.execPath, "-e", childScript], {
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: privateAgent,
        AGENT_INTERCOM_BROKER_SOURCE: source,
        AGENT_INTERCOM_MASK_PATHS: JSON.stringify([sharedIntercom, legacyRuntime]),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0, stderr);
    await assert.rejects(access(target));
    assert.equal(dirname(dirname(target)), privateAgent);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
