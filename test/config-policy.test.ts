import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mergeConfig, readConfig, writeConfig, writeConfigDefaults } from "../src/config.ts";

test("policy config merges partial values without dropping typed defaults", () => {
  assert.equal(mergeConfig({}).routing.modelRouting.unmatchedHarness, null);
  const config = mergeConfig({
    routing: {
      explicitOnly: [],
      profilePreferences: { codex: ["custom", "custom", "codex-safe"] },
      roleRequirements: { builder: { requiresSubagents: true }, invalid: { requiresSubagents: "yes" } },
      modelRouting: {
        unmatchedHarness: "opencode",
        rules: [{ harness: "codex", patterns: ["private/*", "private/*", "bad*pattern"] }],
        stripPrefixes: { codex: ["private/", "bad*"] },
      },
      fallback: { preserveRoleInstructions: false },
    },
    supervision: { recommendReturnOnAfterSpawn: false },
  });
  assert.deepEqual(config.routing.explicitOnly, []);
  assert.deepEqual(config.routing.profilePreferences.codex, ["custom", "codex-safe"]);
  assert.deepEqual(config.routing.roleRequirements.builder, { requiresSubagents: true });
  assert.deepEqual(config.routing.roleRequirements.invalid, {});
  assert.equal(config.routing.modelRouting.unmatchedHarness, "opencode");
  assert.equal(mergeConfig({ routing: { modelRouting: { unmatchedHarness: null } } }).routing.modelRouting.unmatchedHarness, null);
  assert.deepEqual(config.routing.modelRouting.rules, [{ harness: "codex", patterns: ["private/*"] }]);
  assert.deepEqual(config.routing.modelRouting.stripPrefixes.codex, ["private/"]);
  assert.equal(config.routing.fallback.preserveRoleInstructions, false);
  assert.equal(config.supervision.recommendRalphForSubstantialWork, true);
  assert.equal(config.supervision.recommendReturnOnAfterSpawn, false);
});

test("legacy defaultProfiles migrate into ordered fallback without overriding explicit new policy", () => {
  const legacy = mergeConfig({ defaultProfiles: { claude: "team-claude" } });
  assert.deepEqual(legacy.routing.profilePreferences.claude, ["team-claude", "claude-safe", "claude-minimal"]);
  const configured = mergeConfig({
    defaultProfiles: { claude: "team-claude" },
    routing: { profilePreferences: { claude: ["claude-minimal", "team-claude"] } },
  });
  assert.deepEqual(configured.routing.profilePreferences.claude, ["claude-minimal", "team-claude"]);
});

test("default-policy writes preserve unknown config and round-trip policy deltas with mode 0600", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orchestrator-policy-write-"));
  const path = join(directory, "config.json");
  try {
    await writeFile(path, JSON.stringify({
      futureTopLevel: true,
      routing: {
        futureRouting: { keep: true },
        profilePreferences: { futureHarness: ["keep"] },
        modelRouting: { futureModelField: true, stripPrefixes: { futureHarness: ["keep/"] } },
        fallback: { futureFallback: true },
        capabilities: { futureCapability: true },
      },
      supervision: { futureGuidance: "keep" },
    }), { mode: 0o644 });
    const config = await readConfig(path);
    config.routing.explicitOnly = [];
    config.routing.profilePreferences.codex = ["codex-minimal", "codex-safe"];
    config.routing.roleRequirements.builder = { requiresSubagents: true };
    config.routing.modelRouting.unmatchedHarness = "opencode";
    config.routing.modelRouting.rules = [{ harness: "pi", patterns: ["google/*"] }];
    config.routing.modelRouting.stripPrefixes.pi = ["google/"];
    config.routing.fallback.preserveRoleInstructions = false;
    config.supervision.recommendRalphForSubstantialWork = false;
    config.supervision.recommendReturnOnAfterSpawn = false;
    await writeConfigDefaults(path, config);

    const raw = JSON.parse(await readFile(path, "utf8"));
    assert.equal(raw.futureTopLevel, true);
    assert.deepEqual(raw.routing.futureRouting, { keep: true });
    assert.deepEqual(raw.routing.profilePreferences.futureHarness, ["keep"]);
    assert.deepEqual(raw.routing.explicitOnly, []);
    assert.deepEqual(raw.routing.profilePreferences.codex, ["codex-minimal", "codex-safe"]);
    assert.deepEqual(raw.routing.roleRequirements.builder, { requiresSubagents: true });
    assert.equal(raw.routing.modelRouting.unmatchedHarness, "opencode");
    assert.deepEqual(raw.routing.modelRouting.rules, [{ harness: "pi", patterns: ["google/*"] }]);
    assert.deepEqual(raw.routing.modelRouting.stripPrefixes.pi, ["google/"]);
    assert.equal(raw.routing.modelRouting.futureModelField, true);
    assert.deepEqual(raw.routing.modelRouting.stripPrefixes.futureHarness, ["keep/"]);
    assert.equal(raw.routing.fallback.preserveRoleInstructions, false);
    assert.equal(raw.routing.fallback.futureFallback, true);
    assert.equal(raw.routing.capabilities.futureCapability, true);
    assert.equal(raw.supervision.futureGuidance, "keep");
    assert.equal(raw.supervision.recommendRalphForSubstantialWork, false);
    assert.equal(raw.supervision.recommendReturnOnAfterSpawn, false);
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    const roundTrip = await readConfig(path);
    assert.deepEqual(roundTrip.routing.modelRouting, config.routing.modelRouting);
    assert.deepEqual(roundTrip.routing.profilePreferences, config.routing.profilePreferences);
    assert.deepEqual(roundTrip.routing.roleRequirements, config.routing.roleRequirements);
    assert.deepEqual(roundTrip.supervision, config.supervision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("full config writes round-trip all policy fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orchestrator-policy-full-write-"));
  const path = join(directory, "config.json");
  try {
    const config = mergeConfig({
      routing: {
        explicitOnly: ["claude"],
        profilePreferences: { pi: ["pi-peer"] },
        roleRequirements: { researcher: { requiresSubagents: true } },
        modelRouting: { unmatchedHarness: "claude", rules: [], stripPrefixes: { claude: [] } },
        fallback: { preserveRoleInstructions: false },
      },
      supervision: { recommendRalphForSubstantialWork: false, recommendReturnOnAfterSpawn: false },
    });
    await writeConfig(path, config);
    assert.deepEqual(await readConfig(path), config);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
