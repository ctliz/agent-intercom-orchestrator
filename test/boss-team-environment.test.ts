import assert from "node:assert/strict";
import test from "node:test";
import { assertTrustedLocalBossControllerTarget, assertTrustedLocalBossWorkerAdoptionAllowed, buildOptionalTrustedLocalBossTeamEnvironment, buildTrustedLocalBossTeamEnvironment, TRUSTED_LOCAL_BOSS_PARTICIPANT_HARNESS, trustedLocalBossParticipantTargets } from "../src/boss-team-environment.ts";
import { buildWorkerEnvironment } from "../src/workers.ts";

test("Boss team environment binds every role to one deterministic Pi team including prospective adversary", () => {
  assert.equal(TRUSTED_LOCAL_BOSS_PARTICIPANT_HARNESS, "pi");
  const bossRunId = "boss-00000000-0000-4000-8000-123456789abc";
  const targets = [
    "boss-manager-123456789abc",
    "boss-worker-123456789abc",
    "boss-scout-123456789abc",
    "boss-adversary-123456789abc",
  ];
  assert.deepEqual(trustedLocalBossParticipantTargets(bossRunId), targets);
  assert.deepEqual(buildOptionalTrustedLocalBossTeamEnvironment(), {}, "ordinary fleet spawns must receive no Boss metadata");
  assert.doesNotThrow(() => assertTrustedLocalBossControllerTarget({ bossRunId, role: "manager", controllerTarget: "controller-exact-target" }, "controller-exact-target"));
  assert.throws(
    () => assertTrustedLocalBossControllerTarget({ bossRunId, role: "manager", controllerTarget: "stale-controller-target" }, "controller-exact-target"),
    /exact owning Intercom manager session target/,
  );
  assert.doesNotThrow(() => assertTrustedLocalBossWorkerAdoptionAllowed({ id: "ordinary-worker" }));
  assert.throws(
    () => assertTrustedLocalBossWorkerAdoptionAllowed({ id: targets[1], bossRunId }),
    /cannot be adopted by another Controller/,
  );

  for (const role of ["manager", "worker", "scout", "adversary"] as const) {
    const environment = buildTrustedLocalBossTeamEnvironment({ bossRunId, role, controllerTarget: "controller-exact-target" });
    assert.equal(environment.AGENT_INTERCOM_BOSS_RUN_ID, bossRunId);
    assert.equal(environment.AGENT_INTERCOM_BOSS_ROLE, role);
    assert.equal(environment.AGENT_INTERCOM_BOSS_CONTROLLER_TARGET, "controller-exact-target");
    assert.equal(environment.AGENT_INTERCOM_BOSS_MANAGER_TARGET, targets[0]);
    assert.deepEqual(JSON.parse(environment.AGENT_INTERCOM_BOSS_TEAM_TARGETS), targets);
    assert.equal(JSON.parse(environment.AGENT_INTERCOM_BOSS_TEAM_TARGETS).includes("controller-exact-target"), false);
    assert.equal(environment.AGENT_INTERCOM_BOSS_VISIBILITY, "team-only");
    assert.equal(environment.AGENT_INTERCOM_ORCHESTRATOR_DISABLED, "1");
    for (const harness of ["pi", "codex", "claude", "opencode"] as const) {
      const ordinary = {
        ...buildWorkerEnvironment(harness, targets[1], role, undefined, {
          runId: "worker-run-exact",
          unit: "worker-unit-exact.service",
          managerSessionId: "controller-exact-target",
        }),
        ...buildOptionalTrustedLocalBossTeamEnvironment(),
      };
      assert.equal(Object.keys(ordinary).some((key) => key.startsWith("AGENT_INTERCOM_BOSS_")), false, `${harness} ordinary worker must not receive Boss metadata`);
      const launched = { ...ordinary, ...buildOptionalTrustedLocalBossTeamEnvironment({ bossRunId, role, controllerTarget: "controller-exact-target" }) };
      assert.equal(launched.AGENT_INTERCOM_BOSS_CONTROLLER_TARGET, launched.AGENT_INTERCOM_MANAGER_TARGET, `${harness} Boss Controller target must be the adapter's exact stable manager target`);
      assert.equal(launched.AGENT_INTERCOM_ORCHESTRATOR_DISABLED, "1", `${harness} Boss ${role} must remain unable to orchestrate`);
    }
  }
});
