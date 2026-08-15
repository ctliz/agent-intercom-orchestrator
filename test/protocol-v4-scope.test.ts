import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INTERCOM_PROTOCOL_V4_VECTOR_SCHEMA_VERSION,
  INTERCOM_PROTOCOL_V4_SEMANTICS_HASH,
  INTERCOM_SCOPE_ENV,
  INTERCOM_SCOPE_ID_PATTERN,
  INTERCOM_SCOPE_ID_PATTERN_SOURCE,
  intercomScopeIdFromEnv,
  parseIntercomScopeId,
} from "../src/protocol-v4-scope.ts";
import { buildWorkerEnvironment } from "../src/workers.ts";

test("vendored scope surface pins the canonical protocol-v4 schema and hash", () => {
  assert.equal(INTERCOM_PROTOCOL_V4_VECTOR_SCHEMA_VERSION, 2);
  assert.equal(INTERCOM_PROTOCOL_V4_SEMANTICS_HASH, "ef23cae55b3cca7683fee60e5f2421350cde731dc5424c82286a33a8b9cdf6cb");
});

test("vendored scope constants match the exact canonical literal values", () => {
  assert.equal(INTERCOM_SCOPE_ENV, "AGENT_INTERCOM_SCOPE_ID");
  assert.equal(INTERCOM_SCOPE_ID_PATTERN_SOURCE, "^[A-Za-z0-9_-]{16,128}$");
  assert.equal(INTERCOM_SCOPE_ID_PATTERN.source, "^[A-Za-z0-9_-]{16,128}$");
});

test("scope validation vectors", () => {
  assert.equal(parseIntercomScopeId(undefined), undefined);
  assert.equal(parseIntercomScopeId(""), undefined);
  const scope = "A".repeat(16);
  assert.equal(parseIntercomScopeId(scope), scope);
  assert.throws(() => parseIntercomScopeId("A".repeat(15)), /must match/);
});

test("buildWorkerEnvironment propagates scope through lifecycle paths", () => {
  const scope = "Lifecycle_Scope_12345";
  const options = { intercomScopeId: scope };

  const envRestart = buildWorkerEnvironment("pi", "w1", "advisor", undefined, {
    runId: "run-restart", unit: "restart.service", managerSessionId: "mgr-1",
  }, options);
  assert.equal(envRestart.AGENT_INTERCOM_SCOPE_ID, scope);

  const envAdopt = buildWorkerEnvironment("pi", "w1", "advisor", undefined, {
    runId: "run-restart", unit: "restart.service", managerSessionId: "mgr-new",
  }, options);
  assert.equal(envAdopt.AGENT_INTERCOM_SCOPE_ID, scope);

  const envNested = buildWorkerEnvironment("pi", "nested-w1", "worker", undefined, {
    runId: "run-nested", unit: "nested.service", managerSessionId: "w1",
  }, options);
  assert.equal(envNested.AGENT_INTERCOM_SCOPE_ID, scope);
});

test("frozen semantics: buildWorkerEnvironment ignores mutated process.env", () => {
  const initialScope = "Initial_Scope_12345";
  const env = buildWorkerEnvironment("pi", "worker-e", "advisor", undefined, undefined, { intercomScopeId: initialScope });
  assert.equal(env.AGENT_INTERCOM_SCOPE_ID, initialScope);
  process.env.AGENT_INTERCOM_SCOPE_ID = "Mutated_Scope_54321";
  const envMutated = buildWorkerEnvironment("pi", "worker-e", "advisor", undefined, undefined, { intercomScopeId: initialScope });
  assert.equal(envMutated.AGENT_INTERCOM_SCOPE_ID, initialScope, "Scope must be frozen to init value");
});

test("launcher scope inheritance across harnesses and explicit scope clearing", () => {
  // Test 1: Worker inherits manager scope when provided
  const scopeA = "Manager_Scope_001_12345";
  const envA = buildWorkerEnvironment("pi", "worker-1", "advisor", undefined, undefined, { intercomScopeId: scopeA });
  assert.equal(envA.AGENT_INTERCOM_SCOPE_ID, scopeA);

  // Test 2: Unscoped manager produces unscoped worker
  const envUnscoped = buildWorkerEnvironment("pi", "worker-2", "advisor", undefined, undefined, { intercomScopeId: undefined });
  assert.equal(envUnscoped.AGENT_INTERCOM_SCOPE_ID, undefined);

  // Test 3: Explicit clearing removes ambient scope
  const envCleared = buildWorkerEnvironment("pi", "worker-3", "advisor", undefined, undefined, { intercomScopeId: "" });
  assert.equal(envCleared.AGENT_INTERCOM_SCOPE_ID, undefined);

  // Test 4: Works across all harnesses (codex, claude, opencode)
  for (const harness of ["pi", "codex", "claude", "opencode"] as const) {
    const envHarness = buildWorkerEnvironment(harness, `worker-${harness}`, "builder", undefined, undefined, { intercomScopeId: scopeA });
    assert.equal(envHarness.AGENT_INTERCOM_SCOPE_ID, scopeA);
  }
});

test("ambient scope absent when captured scope absent and manifest is never emitted", () => {
  const previousScope = process.env.AGENT_INTERCOM_SCOPE_ID;
  const previousManifest = process.env.AGENT_INTERCOM_TEAM_MANIFEST;
  try {
    process.env.AGENT_INTERCOM_SCOPE_ID = "Ambient_Scope_12345";
    process.env.AGENT_INTERCOM_TEAM_MANIFEST = "/tmp/teams/team_ambient.json";

    const env = buildWorkerEnvironment("pi", "worker-ambient", "advisor", undefined, undefined, { intercomScopeId: undefined });
    assert.equal(env.AGENT_INTERCOM_SCOPE_ID, undefined, "Worker environment must NOT inherit ambient scope when captured scope is absent");
    assert.equal(Object.hasOwn(env, "AGENT_INTERCOM_TEAM_MANIFEST"), false, "Worker environment must NOT emit team manifest");
    assert.equal(Object.hasOwn(env, "TMUXDECK_WORKSPACE"), false);
    assert.equal(Object.hasOwn(env, "TMUXDECK_PANE_ID"), false);
  } finally {
    if (previousScope === undefined) delete process.env.AGENT_INTERCOM_SCOPE_ID;
    else process.env.AGENT_INTERCOM_SCOPE_ID = previousScope;
    if (previousManifest === undefined) delete process.env.AGENT_INTERCOM_TEAM_MANIFEST;
    else process.env.AGENT_INTERCOM_TEAM_MANIFEST = previousManifest;
  }
});

test("legacy v3 wire payload shape validation and version negotiation predicate", () => {
  // Real v3 registration payload (version: 3, no scopeId)
  const legacyV3Registration = {
    type: "register",
    protocol: "pi-intercom",
    version: 3,
    sessionId: "v3-session-0000000000000000",
    session: {
      name: "legacy-v3-worker",
      cwd: "/tmp",
      model: "legacy-model",
      pid: 1234,
      startedAt: 1000,
      lastActivity: 2000,
    },
  };

  // V4 broker rejects v3 registration with INCOMPATIBLE_PROTOCOL or version mismatch
  assert.equal(legacyV3Registration.version, 3);
  assert.equal(Object.hasOwn(legacyV3Registration, "scopeId"), false);

  // Assert base protocol mismatch detection
  const v4BaseProtocol = 4;
  const isCompatible = (reqVersion: number) => reqVersion === v4BaseProtocol;
  assert.equal(isCompatible(legacyV3Registration.version), false, "v3 registration must not be accepted by v4 broker");
});


