import type { TrustedLocalBossAssignmentRole } from "./boss-trusted-local.ts";

// Trusted-local team policy is currently implemented by the Pi Intercom adapter.
// Keep every participant on Pi until coordinated non-Pi adapters implement the
// same exact-ID, role, inbound, and discovery contract.
export const TRUSTED_LOCAL_BOSS_PARTICIPANT_HARNESS = "pi" as const;

export interface TrustedLocalBossTeamIdentity {
  bossRunId: string;
  role: TrustedLocalBossAssignmentRole;
  controllerTarget: string;
}

export function trustedLocalBossParticipantTargets(bossRunId: string): readonly string[] {
  const suffix = bossRunId.slice(-12);
  return [
    `boss-manager-${suffix}`,
    `boss-worker-${suffix}`,
    `boss-scout-${suffix}`,
    `boss-adversary-${suffix}`,
  ];
}

export function assertTrustedLocalBossWorkerAdoptionAllowed(worker: { id: string; bossRunId?: string }): void {
  if (worker.bossRunId) throw new Error(`Boss-bound worker ${worker.id} cannot be adopted by another Controller; cancel the owning Boss run instead`);
}

export function buildTrustedLocalBossTeamEnvironment(identity: TrustedLocalBossTeamIdentity): Record<string, string> {
  const targets = trustedLocalBossParticipantTargets(identity.bossRunId);
  return {
    AGENT_INTERCOM_BOSS_RUN_ID: identity.bossRunId,
    AGENT_INTERCOM_BOSS_ROLE: identity.role,
    AGENT_INTERCOM_BOSS_CONTROLLER_TARGET: identity.controllerTarget,
    AGENT_INTERCOM_BOSS_MANAGER_TARGET: targets[0],
    AGENT_INTERCOM_BOSS_TEAM_TARGETS: JSON.stringify(targets),
    AGENT_INTERCOM_BOSS_VISIBILITY: "team-only",
    AGENT_INTERCOM_ORCHESTRATOR_DISABLED: "1",
  };
}

/** Returns no Boss metadata for ordinary fleet spawns. */
export function buildOptionalTrustedLocalBossTeamEnvironment(identity?: TrustedLocalBossTeamIdentity): Record<string, string> {
  return identity ? buildTrustedLocalBossTeamEnvironment(identity) : {};
}

export function assertTrustedLocalBossControllerTarget(identity: TrustedLocalBossTeamIdentity, managerSessionTarget: string): void {
  if (identity.controllerTarget !== managerSessionTarget) {
    throw new Error("Trusted-local Boss Controller target must equal the exact owning Intercom manager session target");
  }
}
