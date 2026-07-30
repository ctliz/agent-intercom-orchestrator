import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import type {
  AuthorityTransitionOperation as CoreAuthorityTransitionOperation,
  BossParticipantRole as CoreBossParticipantRole,
  ParticipantState as CoreParticipantState,
} from "@dataforxyz/agent-intercom-core/boss";

export const BOSS_CONTROLLER_STORE_VERSION = "orc.boss-controller-store.v1" as const;
export const BOSS_RUN_VERSION = "orc.boss-run.v1" as const;
export const BOSS_GOAL_REVISION_VERSION = "orc.boss-goal-revision.v1" as const;
export const BOSS_PARTICIPANT_VERSION = "orc.boss-participant.v1" as const;
export const BOSS_ASSIGNMENT_VERSION = "orc.boss-assignment.v1" as const;
export const BOSS_APPROVAL_VERSION = "orc.boss-approval.v1" as const;
export const BOSS_PROOF_MANIFEST_VERSION = "orc.boss-proof-manifest.v1" as const;
export const BOSS_EVIDENCE_REF_VERSION = "orc.boss-evidence-ref.v1" as const;
export const BOSS_OUTBOX_ITEM_VERSION = "orc.boss-outbox-item.v1" as const;
export const BOSS_WATCHDOG_VERSION = "orc.boss-watchdog.v1" as const;
export const BOSS_AUTHORITY_PROJECTION_VERSION = "orc.boss-authority-projection.v1" as const;
export const BOSS_AUDIT_ENTRY_VERSION = "orc.boss-audit-entry.v1" as const;
export const BOSS_REQUIRED_FEATURE = "boss-run-v1" as const;

export const BOSS_PARTICIPANT_ROLES = (["boss", "manager", "adversary", "scout", "worker", "council"] as const) satisfies readonly CoreBossParticipantRole[];
export type BossParticipantRole = CoreBossParticipantRole;

export const BOSS_PARTICIPANT_STATES = ([
  "provisioning", "registering", "ready", "working", "waiting", "paused",
  "stalled", "blocked", "failed", "lost", "unreachable", "stopped",
] as const) satisfies readonly CoreParticipantState[];
export type BossParticipantState = CoreParticipantState;

export const AUTHORITY_TRANSITION_OPERATIONS = ([
  "bind_boss", "rebind_boss", "revoke_boss", "bind_participant", "rebind_participant",
  "revoke_participant", "replace_participant", "replace_manager", "rebind_subscriber",
  "controller_takeover", "rotate_credential",
] as const) satisfies readonly CoreAuthorityTransitionOperation[];
export type AuthorityTransitionOperation = CoreAuthorityTransitionOperation;

export const BOSS_RUN_STATES = [
  "provisioning", "active", "paused", "blocked", "awaiting_approval", "completed", "cancelled",
] as const;
export type BossRunState = (typeof BOSS_RUN_STATES)[number];

export const BOSS_BINDING_STATES = ["pending", "active", "revoked", "replaced"] as const;
export type BossParticipantBindingState = (typeof BOSS_BINDING_STATES)[number];

export const GOAL_REVISION_STATES = ["current", "superseded", "withdrawn"] as const;
export type GoalRevisionState = (typeof GOAL_REVISION_STATES)[number];

export const ASSIGNMENT_STATES = [
  "created", "accepted", "working", "submitted", "rejected", "cancelled", "blocked", "failed",
] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

export const APPROVAL_STATES = ["pending", "approved", "rejected", "invalidated"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const PROOF_CLASSES = ["ui", "api", "cli", "library", "infrastructure"] as const;
export type ProofClass = (typeof PROOF_CLASSES)[number];
export const PROOF_STATES = ["draft", "submitted", "invalidated"] as const;
export type ProofState = (typeof PROOF_STATES)[number];

export const EVIDENCE_KINDS = [
  "screenshot", "request", "response", "command", "stdout", "stderr", "artifact",
  "status", "configuration", "health", "negative_case",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const OUTBOX_TOPICS = [
  "boss.assignment.created", "boss.assignment.cancelled", "boss.assignment.checkpoint",
  "boss.assignment.submitted", "boss.assignment.rejected", "boss.review.requested",
  "boss.review.submitted", "boss.proof.submitted", "boss.worker.health", "boss.worker.blocked",
  "boss.worker.failed", "boss.worker.notice", "boss.worker.notice_delivery_failed",
  "boss.decision.required", "boss.authority.reconcile",
] as const;
export type OutboxTopic = (typeof OUTBOX_TOPICS)[number];
export const OUTBOX_STATES = ["pending", "claimed", "dispatched", "acknowledged", "failed", "fenced"] as const;
export type OutboxState = (typeof OUTBOX_STATES)[number];

export const WATCHDOG_KINDS = ["response", "progress", "checkpoint", "deadline"] as const;
export type WatchdogKind = (typeof WATCHDOG_KINDS)[number];
export const WATCHDOG_STATES = ["armed", "satisfied", "fired", "cancelled", "fenced"] as const;
export type WatchdogState = (typeof WATCHDOG_STATES)[number];

export const AUTHORITY_TARGET_KINDS = ["boss", "participant", "controller", "credential", "subscriber"] as const;
export type AuthorityTargetKind = (typeof AUTHORITY_TARGET_KINDS)[number];
export const AUTHORITY_BROKER_STATES = ["unprepared", "prepared", "committed", "aborted"] as const;
export type AuthorityBrokerState = (typeof AUTHORITY_BROKER_STATES)[number];
export const AUTHORITY_PROJECTION_STATES = [
  "intent_recorded", "broker_prepared", "projected", "reconciled", "aborted", "poisoned",
] as const;
export type AuthorityProjectionState = (typeof AUTHORITY_PROJECTION_STATES)[number];

export const AUDIT_ACTOR_TYPES = ["system", "controller", "boss", "manager", "participant", "migration"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
export const AUDIT_ENTITY_TYPES = [
  "store", "run", "goal_revision", "participant", "assignment", "approval", "proof_manifest",
  "evidence_ref", "outbox_item", "watchdog", "authority_transition",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
export const AUDIT_ACTIONS = [
  "store.created", "store.updated", "store.migrated", "store.quarantined", "run.state_changed",
  "goal.revised", "participant.changed", "assignment.changed", "approval.changed", "proof.changed",
  "outbox.changed", "watchdog.changed", "authority.projected", "authority.reconciled",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_OUTCOMES = ["success", "denied", "failed"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export interface BossRunV1 {
  version: typeof BOSS_RUN_VERSION;
  bossRunId: string;
  controllerPrincipalId: string;
  currentGoalRevisionId: string;
  state: BossRunState;
  bossBindingEpoch: number;
  bossAuthorityTransitionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BossGoalRevisionV1 {
  version: typeof BOSS_GOAL_REVISION_VERSION;
  goalRevisionId: string;
  bossRunId: string;
  revision: number;
  parentGoalRevisionId: string | null;
  objective: string;
  acceptanceCriteria: string[];
  createdByParticipantId: string;
  state: GoalRevisionState;
  createdAt: string;
}

export interface BossParticipantV1 {
  version: typeof BOSS_PARTICIPANT_VERSION;
  participantId: string;
  bossRunId: string;
  role: BossParticipantRole;
  communicationProfile: BossParticipantRole;
  bindingEpoch: number;
  bindingState: BossParticipantBindingState;
  sessionId: string | null;
  authorityTransitionId: string | null;
  assignedManagerParticipantId: string | null;
  state: BossParticipantState;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BossAssignmentV1 {
  version: typeof BOSS_ASSIGNMENT_VERSION;
  assignmentId: string;
  bossRunId: string;
  goalRevisionId: string;
  managerParticipantId: string;
  assigneeParticipantId: string;
  idempotencyKey: string;
  title: string;
  state: AssignmentState;
  attempt: number;
  watchdogGeneration: number;
  sourceWriter: boolean;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  submittedAt: string | null;
  terminalAt: string | null;
  resultMessageId: string | null;
}

export interface BossApprovalV1 {
  version: typeof BOSS_APPROVAL_VERSION;
  approvalId: string;
  bossRunId: string;
  goalRevisionId: string;
  proofManifestId: string;
  state: ApprovalState;
  decidedByParticipantId: string | null;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface BossProofManifestV1 {
  version: typeof BOSS_PROOF_MANIFEST_VERSION;
  proofManifestId: string;
  bossRunId: string;
  goalRevisionId: string;
  producerParticipantId: string;
  proofClass: ProofClass;
  state: ProofState;
  evidenceRefIds: string[];
  sourceRevision: string;
  baseRevision: string;
  integrationRevision: string;
  profileDigest: string;
  configDigest: string;
  createdAt: string;
  submittedAt: string | null;
  invalidatedAt: string | null;
  invalidationReason: string | null;
}

export interface BossEvidenceRefV1 {
  version: typeof BOSS_EVIDENCE_REF_VERSION;
  evidenceRefId: string;
  bossRunId: string;
  proofManifestId: string;
  producerParticipantId: string;
  kind: EvidenceKind;
  sha256: string;
  storageRef: string;
  mediaType: string;
  sizeBytes: number;
  redacted: boolean;
  userTestPath: string | null;
  sourceRevision: string;
  baseRevision: string;
  integrationRevision: string;
  profileDigest: string;
  configDigest: string;
  capturedAt: string;
}

export type OutboxEntityType = Exclude<AuditEntityType, "store" | "evidence_ref">;
export interface BossOutboxItemV1 {
  version: typeof BOSS_OUTBOX_ITEM_VERSION;
  outboxItemId: string;
  bossRunId: string;
  topic: OutboxTopic;
  entityType: OutboxEntityType;
  entityId: string;
  messageId: string;
  idempotencyKey: string;
  payloadDigest: string;
  state: OutboxState;
  attempt: number;
  controllerGeneration: number;
  authorityTransitionId: string;
  availableAt: string;
  claimedAt: string | null;
  dispatchedAt: string | null;
  acknowledgedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BossWatchdogV1 {
  version: typeof BOSS_WATCHDOG_VERSION;
  watchdogId: string;
  bossRunId: string;
  assignmentId: string;
  generation: number;
  kind: WatchdogKind;
  state: WatchdogState;
  dueAt: string;
  lastProgressAt: string | null;
  firedAt: string | null;
  controllerGeneration: number;
  authorityTransitionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BossAuthorityTransitionProjectionV1 {
  version: typeof BOSS_AUTHORITY_PROJECTION_VERSION;
  authorityTransitionId: string;
  bossRunId: string;
  operation: AuthorityTransitionOperation;
  targetKind: AuthorityTargetKind;
  targetId: string;
  idempotencyKey: string;
  expectedBrokerRevision: number;
  brokerRevision: number | null;
  priorControllerGeneration: number | null;
  resultingControllerGeneration: number | null;
  priorBindingEpoch: number | null;
  resultingBindingEpoch: number | null;
  brokerState: AuthorityBrokerState;
  projectionState: AuthorityProjectionState;
  prepareTokenDigest: string | null;
  createdAt: string;
  preparedAt: string | null;
  committedAt: string | null;
  reconciledAt: string | null;
  abortedAt: string | null;
  abortReason: string | null;
}

export interface BossAuditEntryV1 {
  version: typeof BOSS_AUDIT_ENTRY_VERSION;
  auditEntryId: string;
  bossRunId: string;
  sequence: number;
  actorType: AuditActorType;
  actorId: string | null;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  outcome: AuditOutcome;
  detailsDigest: string;
  previousEntryDigest: string | null;
  entryDigest: string;
  occurredAt: string;
}

export interface BossControllerStateV1 {
  version: typeof BOSS_CONTROLLER_STORE_VERSION;
  requiredFeatures: [typeof BOSS_REQUIRED_FEATURE];
  storeId: string;
  revision: number;
  controllerGeneration: number;
  controllerAuthorityTransitionId: string;
  run: BossRunV1;
  goalRevisions: BossGoalRevisionV1[];
  participants: BossParticipantV1[];
  assignments: BossAssignmentV1[];
  approvals: BossApprovalV1[];
  proofManifests: BossProofManifestV1[];
  evidenceRefs: BossEvidenceRefV1[];
  outbox: BossOutboxItemV1[];
  watchdogs: BossWatchdogV1[];
  authorityTransitions: BossAuthorityTransitionProjectionV1[];
  audit: BossAuditEntryV1[];
  createdAt: string;
  updatedAt: string;
}

export type BossEntityKind =
  | "run" | "goalRevisions" | "participants" | "assignments" | "approvals" | "proofManifests"
  | "evidenceRefs" | "outbox" | "watchdogs" | "authorityTransitions" | "audit";

export type BossEntityByKind = {
  run: BossRunV1;
  goalRevisions: BossGoalRevisionV1;
  participants: BossParticipantV1;
  assignments: BossAssignmentV1;
  approvals: BossApprovalV1;
  proofManifests: BossProofManifestV1;
  evidenceRefs: BossEvidenceRefV1;
  outbox: BossOutboxItemV1;
  watchdogs: BossWatchdogV1;
  authorityTransitions: BossAuthorityTransitionProjectionV1;
  audit: BossAuditEntryV1;
};

export class BossValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "BossValidationError";
    this.path = path;
  }
}

export class BossSchemaVersionError extends BossValidationError {
  readonly observedVersion: unknown;
  readonly expectedVersion: string;
  readonly direction: "newer" | "older" | "foreign";
  constructor(path: string, observedVersion: unknown, expectedVersion: string) {
    const observedMatch = typeof observedVersion === "string" ? /^(.*\.v)(\d+)$/.exec(observedVersion) : null;
    const expectedMatch = /^(.*\.v)(\d+)$/.exec(expectedVersion);
    const direction = observedMatch && expectedMatch && observedMatch[1] === expectedMatch[1]
      ? (Number(observedMatch[2]) > Number(expectedMatch[2]) ? "newer" : "older")
      : "foreign";
    super(path, `unsupported ${direction} schema version ${String(observedVersion)}; expected ${expectedVersion}`);
    this.name = "BossSchemaVersionError";
    this.observedVersion = observedVersion;
    this.expectedVersion = expectedVersion;
    this.direction = direction;
  }
}

export class BossUnsupportedFeatureError extends BossValidationError {
  readonly feature: string;
  constructor(path: string, feature: string) {
    super(path, `unsupported active feature ${feature}; refusing downgrade`);
    this.name = "BossUnsupportedFeatureError";
    this.feature = feature;
  }
}

type DataRecord = Record<string, unknown>;

function ownRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): DataRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value)) {
    throw new BossValidationError(path, "must be a non-proxy plain object");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new BossValidationError(path, "must not use a custom or inherited prototype");
  }
  const allowed = new Set([...required, ...optional]);
  const result: DataRecord = Object.create(null) as DataRecord;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new BossValidationError(path, "symbol properties are not supported");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new BossValidationError(`${path}.${key}`, "must be an enumerable own data property");
    }
    if (!allowed.has(key)) throw new BossValidationError(`${path}.${key}`, "is not supported");
    result[key] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.hasOwn(result, key)) throw new BossValidationError(`${path}.${key}`, "is required");
  }
  for (const key in value) {
    if (!Object.hasOwn(value, key)) throw new BossValidationError(`${path}.${key}`, "inherited properties are not supported");
  }
  return result;
}

function denseArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new BossValidationError(path, "must be a non-proxy plain array");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) throw new BossValidationError(path, "has an invalid length");
  const length = lengthDescriptor.value as number;
  const result: unknown[] = [];
  const seen = new Set<number>();
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
      throw new BossValidationError(path, "array symbols and non-index properties are not supported");
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= length) throw new BossValidationError(`${path}.${key}`, "is not a valid array index");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new BossValidationError(`${path}[${index}]`, "must be an enumerable own data property");
    }
    seen.add(index);
  }
  if (seen.size !== length) {
    for (let index = 0; index < length; index += 1) {
      if (!seen.has(index)) throw new BossValidationError(`${path}[${index}]`, "sparse array holes are not supported");
    }
  }
  for (let index = 0; index < length; index += 1) {
    result.push(Object.getOwnPropertyDescriptor(value, String(index))!.value);
  }
  return result;
}

function wellFormed(value: string, path: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new BossValidationError(path, "contains an unpaired high surrogate");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new BossValidationError(path, "contains an unpaired low surrogate");
    }
  }
  return value;
}

function string(value: unknown, path: string, maximum = 32_768): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new BossValidationError(path, `must be a non-empty string no longer than ${maximum} characters`);
  }
  return wellFormed(value, path);
}

function nullableString(value: unknown, path: string, maximum = 32_768): string | null {
  return value === null ? null : string(value, path, maximum);
}

function id(value: unknown, path: string): string {
  const parsed = string(value, path, 128);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/.test(parsed)) {
    throw new BossValidationError(path, "must be a bounded ASCII identifier");
  }
  return parsed;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || (value as number) < minimum) {
    throw new BossValidationError(path, `must be a safe integer >= ${minimum}`);
  }
  return value as number;
}

function nullableInteger(value: unknown, path: string, minimum = 0): number | null {
  return value === null ? null : integer(value, path, minimum);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new BossValidationError(path, "must be a boolean");
  return value;
}

function enumeration<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new BossValidationError(path, `must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function timestamp(value: unknown, path: string): string {
  const parsed = string(value, path, 24);
  const millis = Date.parse(parsed);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed) || Number.isNaN(millis) || new Date(millis).toISOString() !== parsed) {
    throw new BossValidationError(path, "must be a canonical UTC ISO-8601 timestamp");
  }
  return parsed;
}

function nullableTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : timestamp(value, path);
}

function digest(value: unknown, path: string): string {
  const parsed = string(value, path, 64);
  if (!/^[a-f0-9]{64}$/.test(parsed)) throw new BossValidationError(path, "must be a lowercase SHA-256 digest");
  return parsed;
}

function revision(value: unknown, path: string): string {
  const parsed = string(value, path, 64);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(parsed)) throw new BossValidationError(path, "must be a lowercase 40- or 64-hex revision");
  return parsed;
}

function literalVersion(value: unknown, expected: string, path: string): void {
  if (value !== expected) throw new BossSchemaVersionError(path, value, expected);
}

function ordered(start: string, end: string, path: string): void {
  if (Date.parse(end) < Date.parse(start)) throw new BossValidationError(path, "must not precede the related creation timestamp");
}

function nullableId(value: unknown, path: string): string | null {
  return value === null ? null : id(value, path);
}

function stringArray(value: unknown, path: string, allowEmpty = true): string[] {
  const parsed = denseArray(value, path).map((entry, index) => string(entry, `${path}[${index}]`, 4_096));
  if (!allowEmpty && parsed.length === 0) throw new BossValidationError(path, "must not be empty");
  return parsed;
}

function idArray(value: unknown, path: string): string[] {
  const parsed = denseArray(value, path).map((entry, index) => id(entry, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) throw new BossValidationError(path, "must not contain duplicate identifiers");
  return parsed;
}

function parseRun(value: unknown, path: string): BossRunV1 {
  const v = ownRecord(value, ["version", "bossRunId", "controllerPrincipalId", "currentGoalRevisionId", "state", "bossBindingEpoch", "bossAuthorityTransitionId", "createdAt", "updatedAt"], [], path);
  literalVersion(v.version, BOSS_RUN_VERSION, `${path}.version`);
  const run: BossRunV1 = {
    version: BOSS_RUN_VERSION,
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    controllerPrincipalId: id(v.controllerPrincipalId, `${path}.controllerPrincipalId`),
    currentGoalRevisionId: id(v.currentGoalRevisionId, `${path}.currentGoalRevisionId`),
    state: enumeration(v.state, BOSS_RUN_STATES, `${path}.state`),
    bossBindingEpoch: integer(v.bossBindingEpoch, `${path}.bossBindingEpoch`),
    bossAuthorityTransitionId: nullableId(v.bossAuthorityTransitionId, `${path}.bossAuthorityTransitionId`),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`),
  };
  ordered(run.createdAt, run.updatedAt, `${path}.updatedAt`);
  if ((run.bossBindingEpoch === 0) !== (run.bossAuthorityTransitionId === null)) {
    throw new BossValidationError(path, "bossBindingEpoch zero requires a null authority transition and a positive epoch requires one");
  }
  if (run.state === "active" && run.bossBindingEpoch === 0) throw new BossValidationError(`${path}.bossBindingEpoch`, "active runs require an authenticated Boss binding");
  return run;
}

export function parseBossRunV1(value: unknown): BossRunV1 { return parseRun(value, "$"); }

function parseGoal(value: unknown, path: string): BossGoalRevisionV1 {
  const v = ownRecord(value, ["version", "goalRevisionId", "bossRunId", "revision", "parentGoalRevisionId", "objective", "acceptanceCriteria", "createdByParticipantId", "state", "createdAt"], [], path);
  literalVersion(v.version, BOSS_GOAL_REVISION_VERSION, `${path}.version`);
  const result: BossGoalRevisionV1 = {
    version: BOSS_GOAL_REVISION_VERSION,
    goalRevisionId: id(v.goalRevisionId, `${path}.goalRevisionId`),
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    revision: integer(v.revision, `${path}.revision`, 1),
    parentGoalRevisionId: nullableId(v.parentGoalRevisionId, `${path}.parentGoalRevisionId`),
    objective: string(v.objective, `${path}.objective`),
    acceptanceCriteria: stringArray(v.acceptanceCriteria, `${path}.acceptanceCriteria`, false),
    createdByParticipantId: id(v.createdByParticipantId, `${path}.createdByParticipantId`),
    state: enumeration(v.state, GOAL_REVISION_STATES, `${path}.state`),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
  };
  if ((result.revision === 1) !== (result.parentGoalRevisionId === null)) {
    throw new BossValidationError(`${path}.parentGoalRevisionId`, "is null exactly for revision 1");
  }
  return result;
}

export function parseBossGoalRevisionV1(value: unknown): BossGoalRevisionV1 { return parseGoal(value, "$"); }

function parseParticipant(value: unknown, path: string): BossParticipantV1 {
  const v = ownRecord(value, ["version", "participantId", "bossRunId", "role", "communicationProfile", "bindingEpoch", "bindingState", "sessionId", "authorityTransitionId", "assignedManagerParticipantId", "state", "reason", "createdAt", "updatedAt"], [], path);
  literalVersion(v.version, BOSS_PARTICIPANT_VERSION, `${path}.version`);
  const role = enumeration(v.role, BOSS_PARTICIPANT_ROLES, `${path}.role`) as BossParticipantRole;
  const profile = enumeration(v.communicationProfile, BOSS_PARTICIPANT_ROLES, `${path}.communicationProfile`) as BossParticipantRole;
  const result: BossParticipantV1 = {
    version: BOSS_PARTICIPANT_VERSION,
    participantId: id(v.participantId, `${path}.participantId`),
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    role,
    communicationProfile: profile,
    bindingEpoch: integer(v.bindingEpoch, `${path}.bindingEpoch`),
    bindingState: enumeration(v.bindingState, BOSS_BINDING_STATES, `${path}.bindingState`),
    sessionId: nullableId(v.sessionId, `${path}.sessionId`),
    authorityTransitionId: nullableId(v.authorityTransitionId, `${path}.authorityTransitionId`),
    assignedManagerParticipantId: nullableId(v.assignedManagerParticipantId, `${path}.assignedManagerParticipantId`),
    state: enumeration(v.state, BOSS_PARTICIPANT_STATES, `${path}.state`) as BossParticipantState,
    reason: nullableString(v.reason, `${path}.reason`, 4_096),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`),
  };
  if (result.role !== result.communicationProfile) throw new BossValidationError(`${path}.communicationProfile`, "must match role");
  const workerLike = role === "worker" || role === "scout";
  if (workerLike !== (result.assignedManagerParticipantId !== null)) throw new BossValidationError(`${path}.assignedManagerParticipantId`, "is required exactly for Worker and Scout participants");
  if (result.bindingState === "pending") {
    if (result.bindingEpoch !== 0 || result.sessionId !== null || result.authorityTransitionId !== null) throw new BossValidationError(path, "pending binding must have epoch zero and no session/authority transition");
  } else if (result.bindingEpoch < 1 || result.authorityTransitionId === null) {
    throw new BossValidationError(path, "non-pending binding requires a positive epoch and authority transition");
  } else if (result.bindingState === "active" && result.sessionId === null) {
    throw new BossValidationError(`${path}.sessionId`, "active binding requires a session");
  }
  if (["blocked", "failed", "lost", "unreachable"].includes(result.state) && result.reason === null) throw new BossValidationError(`${path}.reason`, `${result.state} requires a reason`);
  ordered(result.createdAt, result.updatedAt, `${path}.updatedAt`);
  return result;
}

export function parseBossParticipantV1(value: unknown): BossParticipantV1 { return parseParticipant(value, "$"); }

function parseAssignment(value: unknown, path: string): BossAssignmentV1 {
  const keys = ["version", "assignmentId", "bossRunId", "goalRevisionId", "managerParticipantId", "assigneeParticipantId", "idempotencyKey", "title", "state", "attempt", "watchdogGeneration", "sourceWriter", "createdAt", "updatedAt", "acceptedAt", "submittedAt", "terminalAt", "resultMessageId"] as const;
  const v = ownRecord(value, keys, [], path);
  literalVersion(v.version, BOSS_ASSIGNMENT_VERSION, `${path}.version`);
  const result: BossAssignmentV1 = {
    version: BOSS_ASSIGNMENT_VERSION,
    assignmentId: id(v.assignmentId, `${path}.assignmentId`),
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    goalRevisionId: id(v.goalRevisionId, `${path}.goalRevisionId`),
    managerParticipantId: id(v.managerParticipantId, `${path}.managerParticipantId`),
    assigneeParticipantId: id(v.assigneeParticipantId, `${path}.assigneeParticipantId`),
    idempotencyKey: id(v.idempotencyKey, `${path}.idempotencyKey`),
    title: string(v.title, `${path}.title`, 4_096),
    state: enumeration(v.state, ASSIGNMENT_STATES, `${path}.state`),
    attempt: integer(v.attempt, `${path}.attempt`, 1),
    watchdogGeneration: integer(v.watchdogGeneration, `${path}.watchdogGeneration`, 1),
    sourceWriter: boolean(v.sourceWriter, `${path}.sourceWriter`),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`),
    acceptedAt: nullableTimestamp(v.acceptedAt, `${path}.acceptedAt`),
    submittedAt: nullableTimestamp(v.submittedAt, `${path}.submittedAt`),
    terminalAt: nullableTimestamp(v.terminalAt, `${path}.terminalAt`),
    resultMessageId: nullableId(v.resultMessageId, `${path}.resultMessageId`),
  };
  ordered(result.createdAt, result.updatedAt, `${path}.updatedAt`);
  for (const [name, valueAt] of [["acceptedAt", result.acceptedAt], ["submittedAt", result.submittedAt], ["terminalAt", result.terminalAt]] as const) if (valueAt !== null) ordered(result.createdAt, valueAt, `${path}.${name}`);
  const terminal = ["submitted", "rejected", "cancelled", "failed"].includes(result.state);
  if (terminal !== (result.terminalAt !== null)) throw new BossValidationError(`${path}.terminalAt`, "is required exactly for terminal assignment states");
  if (result.state === "submitted") {
    if (result.submittedAt === null || result.resultMessageId === null) throw new BossValidationError(path, "submitted state requires submittedAt and resultMessageId");
  } else if (result.submittedAt !== null || result.resultMessageId !== null) {
    throw new BossValidationError(path, "submission fields are forbidden before submitted state");
  }
  if (["accepted", "working", "submitted"].includes(result.state) && result.acceptedAt === null) throw new BossValidationError(`${path}.acceptedAt`, `${result.state} requires acceptedAt`);
  return result;
}

export function parseBossAssignmentV1(value: unknown): BossAssignmentV1 { return parseAssignment(value, "$"); }

function parseApproval(value: unknown, path: string): BossApprovalV1 {
  const v = ownRecord(value, ["version", "approvalId", "bossRunId", "goalRevisionId", "proofManifestId", "state", "decidedByParticipantId", "reason", "createdAt", "decidedAt"], [], path);
  literalVersion(v.version, BOSS_APPROVAL_VERSION, `${path}.version`);
  const result: BossApprovalV1 = {
    version: BOSS_APPROVAL_VERSION,
    approvalId: id(v.approvalId, `${path}.approvalId`),
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    goalRevisionId: id(v.goalRevisionId, `${path}.goalRevisionId`),
    proofManifestId: id(v.proofManifestId, `${path}.proofManifestId`),
    state: enumeration(v.state, APPROVAL_STATES, `${path}.state`),
    decidedByParticipantId: nullableId(v.decidedByParticipantId, `${path}.decidedByParticipantId`),
    reason: nullableString(v.reason, `${path}.reason`, 4_096),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
    decidedAt: nullableTimestamp(v.decidedAt, `${path}.decidedAt`),
  };
  if (result.state === "pending") {
    if (result.decidedAt !== null || result.decidedByParticipantId !== null) throw new BossValidationError(path, "pending approval has no decision fields");
  } else if (result.decidedAt === null || result.decidedByParticipantId === null) {
    throw new BossValidationError(path, "every terminal approval requires decidedAt and decidedByParticipantId");
  }
  if (result.decidedAt !== null) ordered(result.createdAt, result.decidedAt, `${path}.decidedAt`);
  if (["rejected", "invalidated"].includes(result.state) && result.reason === null) throw new BossValidationError(`${path}.reason`, `${result.state} requires a reason`);
  return result;
}

export function parseBossApprovalV1(value: unknown): BossApprovalV1 { return parseApproval(value, "$"); }

function parseProof(value: unknown, path: string): BossProofManifestV1 {
  const keys = ["version", "proofManifestId", "bossRunId", "goalRevisionId", "producerParticipantId", "proofClass", "state", "evidenceRefIds", "sourceRevision", "baseRevision", "integrationRevision", "profileDigest", "configDigest", "createdAt", "submittedAt", "invalidatedAt", "invalidationReason"] as const;
  const v = ownRecord(value, keys, [], path);
  literalVersion(v.version, BOSS_PROOF_MANIFEST_VERSION, `${path}.version`);
  const result: BossProofManifestV1 = {
    version: BOSS_PROOF_MANIFEST_VERSION,
    proofManifestId: id(v.proofManifestId, `${path}.proofManifestId`),
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    goalRevisionId: id(v.goalRevisionId, `${path}.goalRevisionId`),
    producerParticipantId: id(v.producerParticipantId, `${path}.producerParticipantId`),
    proofClass: enumeration(v.proofClass, PROOF_CLASSES, `${path}.proofClass`),
    state: enumeration(v.state, PROOF_STATES, `${path}.state`),
    evidenceRefIds: idArray(v.evidenceRefIds, `${path}.evidenceRefIds`),
    sourceRevision: revision(v.sourceRevision, `${path}.sourceRevision`),
    baseRevision: revision(v.baseRevision, `${path}.baseRevision`),
    integrationRevision: revision(v.integrationRevision, `${path}.integrationRevision`),
    profileDigest: digest(v.profileDigest, `${path}.profileDigest`),
    configDigest: digest(v.configDigest, `${path}.configDigest`),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
    submittedAt: nullableTimestamp(v.submittedAt, `${path}.submittedAt`),
    invalidatedAt: nullableTimestamp(v.invalidatedAt, `${path}.invalidatedAt`),
    invalidationReason: nullableString(v.invalidationReason, `${path}.invalidationReason`, 4_096),
  };
  if (result.state === "draft" && (result.submittedAt !== null || result.invalidatedAt !== null || result.invalidationReason !== null)) throw new BossValidationError(path, "draft proof has no terminal timestamps or reason");
  if (result.state === "submitted" && (result.submittedAt === null || result.invalidatedAt !== null || result.invalidationReason !== null)) throw new BossValidationError(path, "submitted proof requires only submittedAt");
  if (result.state === "invalidated" && (result.invalidatedAt === null || result.invalidationReason === null)) throw new BossValidationError(path, "invalidated proof requires invalidatedAt and reason");
  if (result.state === "submitted" && result.evidenceRefIds.length === 0) throw new BossValidationError(`${path}.evidenceRefIds`, "submitted proof must contain evidence");
  if (result.submittedAt !== null) ordered(result.createdAt, result.submittedAt, `${path}.submittedAt`);
  if (result.invalidatedAt !== null) ordered(result.createdAt, result.invalidatedAt, `${path}.invalidatedAt`);
  return result;
}

export function parseBossProofManifestV1(value: unknown): BossProofManifestV1 { return parseProof(value, "$"); }

function parseEvidence(value: unknown, path: string): BossEvidenceRefV1 {
  const keys = ["version", "evidenceRefId", "bossRunId", "proofManifestId", "producerParticipantId", "kind", "sha256", "storageRef", "mediaType", "sizeBytes", "redacted", "userTestPath", "sourceRevision", "baseRevision", "integrationRevision", "profileDigest", "configDigest", "capturedAt"] as const;
  const v = ownRecord(value, keys, [], path);
  literalVersion(v.version, BOSS_EVIDENCE_REF_VERSION, `${path}.version`);
  const sha256 = digest(v.sha256, `${path}.sha256`);
  const mediaType = string(v.mediaType, `${path}.mediaType`, 128);
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;[ -~]+)?$/.test(mediaType)) throw new BossValidationError(`${path}.mediaType`, "must be a valid lowercase media type");
  const storageRef = string(v.storageRef, `${path}.storageRef`, 80);
  if (storageRef !== `sha256:${sha256}`) throw new BossValidationError(`${path}.storageRef`, "must be the content-addressed sha256 reference");
  const redacted = boolean(v.redacted, `${path}.redacted`);
  if (!redacted) throw new BossValidationError(`${path}.redacted`, "evidence must be redacted before persistence");
  return {
    version: BOSS_EVIDENCE_REF_VERSION,
    evidenceRefId: id(v.evidenceRefId, `${path}.evidenceRefId`),
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    proofManifestId: id(v.proofManifestId, `${path}.proofManifestId`),
    producerParticipantId: id(v.producerParticipantId, `${path}.producerParticipantId`),
    kind: enumeration(v.kind, EVIDENCE_KINDS, `${path}.kind`),
    sha256,
    storageRef,
    mediaType,
    sizeBytes: integer(v.sizeBytes, `${path}.sizeBytes`, 1),
    redacted,
    userTestPath: nullableString(v.userTestPath, `${path}.userTestPath`, 4_096),
    sourceRevision: revision(v.sourceRevision, `${path}.sourceRevision`),
    baseRevision: revision(v.baseRevision, `${path}.baseRevision`),
    integrationRevision: revision(v.integrationRevision, `${path}.integrationRevision`),
    profileDigest: digest(v.profileDigest, `${path}.profileDigest`),
    configDigest: digest(v.configDigest, `${path}.configDigest`),
    capturedAt: timestamp(v.capturedAt, `${path}.capturedAt`),
  };
}

export function parseBossEvidenceRefV1(value: unknown): BossEvidenceRefV1 { return parseEvidence(value, "$"); }

const OUTBOX_ENTITY_TYPES = AUDIT_ENTITY_TYPES.filter((value): value is OutboxEntityType => value !== "store" && value !== "evidence_ref");
function parseOutbox(value: unknown, path: string): BossOutboxItemV1 {
  const keys = ["version", "outboxItemId", "bossRunId", "topic", "entityType", "entityId", "messageId", "idempotencyKey", "payloadDigest", "state", "attempt", "controllerGeneration", "authorityTransitionId", "availableAt", "claimedAt", "dispatchedAt", "acknowledgedAt", "lastError", "createdAt", "updatedAt"] as const;
  const v = ownRecord(value, keys, [], path);
  literalVersion(v.version, BOSS_OUTBOX_ITEM_VERSION, `${path}.version`);
  const result: BossOutboxItemV1 = {
    version: BOSS_OUTBOX_ITEM_VERSION,
    outboxItemId: id(v.outboxItemId, `${path}.outboxItemId`),
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    topic: enumeration(v.topic, OUTBOX_TOPICS, `${path}.topic`),
    entityType: enumeration(v.entityType, OUTBOX_ENTITY_TYPES, `${path}.entityType`),
    entityId: id(v.entityId, `${path}.entityId`),
    messageId: id(v.messageId, `${path}.messageId`),
    idempotencyKey: id(v.idempotencyKey, `${path}.idempotencyKey`),
    payloadDigest: digest(v.payloadDigest, `${path}.payloadDigest`),
    state: enumeration(v.state, OUTBOX_STATES, `${path}.state`),
    attempt: integer(v.attempt, `${path}.attempt`),
    controllerGeneration: integer(v.controllerGeneration, `${path}.controllerGeneration`, 1),
    authorityTransitionId: id(v.authorityTransitionId, `${path}.authorityTransitionId`),
    availableAt: timestamp(v.availableAt, `${path}.availableAt`),
    claimedAt: nullableTimestamp(v.claimedAt, `${path}.claimedAt`),
    dispatchedAt: nullableTimestamp(v.dispatchedAt, `${path}.dispatchedAt`),
    acknowledgedAt: nullableTimestamp(v.acknowledgedAt, `${path}.acknowledgedAt`),
    lastError: nullableString(v.lastError, `${path}.lastError`, 4_096),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`),
  };
  ordered(result.createdAt, result.updatedAt, `${path}.updatedAt`);
  if (["claimed", "dispatched", "acknowledged"].includes(result.state) && result.claimedAt === null) throw new BossValidationError(`${path}.claimedAt`, `${result.state} requires a claim timestamp`);
  if (["dispatched", "acknowledged"].includes(result.state) && result.dispatchedAt === null) throw new BossValidationError(`${path}.dispatchedAt`, `${result.state} requires a dispatch timestamp`);
  if ((result.state === "acknowledged") !== (result.acknowledgedAt !== null)) throw new BossValidationError(`${path}.acknowledgedAt`, "is required exactly for acknowledged state");
  if ((result.state === "failed") !== (result.lastError !== null)) throw new BossValidationError(`${path}.lastError`, "is required exactly for failed state");
  return result;
}

export function parseBossOutboxItemV1(value: unknown): BossOutboxItemV1 { return parseOutbox(value, "$"); }

function parseWatchdog(value: unknown, path: string): BossWatchdogV1 {
  const keys = ["version", "watchdogId", "bossRunId", "assignmentId", "generation", "kind", "state", "dueAt", "lastProgressAt", "firedAt", "controllerGeneration", "authorityTransitionId", "createdAt", "updatedAt"] as const;
  const v = ownRecord(value, keys, [], path);
  literalVersion(v.version, BOSS_WATCHDOG_VERSION, `${path}.version`);
  const result: BossWatchdogV1 = {
    version: BOSS_WATCHDOG_VERSION,
    watchdogId: id(v.watchdogId, `${path}.watchdogId`),
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    assignmentId: id(v.assignmentId, `${path}.assignmentId`),
    generation: integer(v.generation, `${path}.generation`, 1),
    kind: enumeration(v.kind, WATCHDOG_KINDS, `${path}.kind`),
    state: enumeration(v.state, WATCHDOG_STATES, `${path}.state`),
    dueAt: timestamp(v.dueAt, `${path}.dueAt`),
    lastProgressAt: nullableTimestamp(v.lastProgressAt, `${path}.lastProgressAt`),
    firedAt: nullableTimestamp(v.firedAt, `${path}.firedAt`),
    controllerGeneration: integer(v.controllerGeneration, `${path}.controllerGeneration`, 1),
    authorityTransitionId: id(v.authorityTransitionId, `${path}.authorityTransitionId`),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`),
  };
  ordered(result.createdAt, result.updatedAt, `${path}.updatedAt`);
  ordered(result.createdAt, result.dueAt, `${path}.dueAt`);
  if ((result.state === "fired") !== (result.firedAt !== null)) throw new BossValidationError(`${path}.firedAt`, "is required exactly for fired state");
  return result;
}

export function parseBossWatchdogV1(value: unknown): BossWatchdogV1 { return parseWatchdog(value, "$"); }

function parseAuthority(value: unknown, path: string): BossAuthorityTransitionProjectionV1 {
  const keys = ["version", "authorityTransitionId", "bossRunId", "operation", "targetKind", "targetId", "idempotencyKey", "expectedBrokerRevision", "brokerRevision", "priorControllerGeneration", "resultingControllerGeneration", "priorBindingEpoch", "resultingBindingEpoch", "brokerState", "projectionState", "prepareTokenDigest", "createdAt", "preparedAt", "committedAt", "reconciledAt", "abortedAt", "abortReason"] as const;
  const v = ownRecord(value, keys, [], path);
  literalVersion(v.version, BOSS_AUTHORITY_PROJECTION_VERSION, `${path}.version`);
  const result: BossAuthorityTransitionProjectionV1 = {
    version: BOSS_AUTHORITY_PROJECTION_VERSION,
    authorityTransitionId: id(v.authorityTransitionId, `${path}.authorityTransitionId`),
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    operation: enumeration(v.operation, AUTHORITY_TRANSITION_OPERATIONS, `${path}.operation`) as AuthorityTransitionOperation,
    targetKind: enumeration(v.targetKind, AUTHORITY_TARGET_KINDS, `${path}.targetKind`),
    targetId: id(v.targetId, `${path}.targetId`),
    idempotencyKey: id(v.idempotencyKey, `${path}.idempotencyKey`),
    expectedBrokerRevision: integer(v.expectedBrokerRevision, `${path}.expectedBrokerRevision`),
    brokerRevision: nullableInteger(v.brokerRevision, `${path}.brokerRevision`, 1),
    priorControllerGeneration: nullableInteger(v.priorControllerGeneration, `${path}.priorControllerGeneration`),
    resultingControllerGeneration: nullableInteger(v.resultingControllerGeneration, `${path}.resultingControllerGeneration`, 1),
    priorBindingEpoch: nullableInteger(v.priorBindingEpoch, `${path}.priorBindingEpoch`),
    resultingBindingEpoch: nullableInteger(v.resultingBindingEpoch, `${path}.resultingBindingEpoch`, 1),
    brokerState: enumeration(v.brokerState, AUTHORITY_BROKER_STATES, `${path}.brokerState`),
    projectionState: enumeration(v.projectionState, AUTHORITY_PROJECTION_STATES, `${path}.projectionState`),
    prepareTokenDigest: v.prepareTokenDigest === null ? null : digest(v.prepareTokenDigest, `${path}.prepareTokenDigest`),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
    preparedAt: nullableTimestamp(v.preparedAt, `${path}.preparedAt`),
    committedAt: nullableTimestamp(v.committedAt, `${path}.committedAt`),
    reconciledAt: nullableTimestamp(v.reconciledAt, `${path}.reconciledAt`),
    abortedAt: nullableTimestamp(v.abortedAt, `${path}.abortedAt`),
    abortReason: nullableString(v.abortReason, `${path}.abortReason`, 4_096),
  };
  const controller = result.operation === "controller_takeover";
  if (controller !== (result.targetKind === "controller")) throw new BossValidationError(`${path}.targetKind`, "controller_takeover is the only controller-target transition");
  if (controller) {
    if (result.priorControllerGeneration === null || result.resultingControllerGeneration !== result.priorControllerGeneration + 1 || result.priorBindingEpoch !== null || result.resultingBindingEpoch !== null) throw new BossValidationError(path, "controller takeover must increment only controllerGeneration by one");
  } else if (result.priorControllerGeneration !== null || result.resultingControllerGeneration !== null) {
    throw new BossValidationError(path, "non-controller transitions cannot project controllerGeneration");
  }
  if (result.targetKind === "participant" && !["bind_participant", "rebind_participant", "revoke_participant", "replace_participant", "replace_manager"].includes(result.operation)) throw new BossValidationError(`${path}.operation`, "does not match participant target");
  if (result.targetKind === "boss" && !["bind_boss", "rebind_boss", "revoke_boss"].includes(result.operation)) throw new BossValidationError(`${path}.operation`, "does not match Boss target");
  if (result.targetKind === "subscriber" && result.operation !== "rebind_subscriber") throw new BossValidationError(`${path}.operation`, "does not match subscriber target");
  if (result.targetKind === "credential" && result.operation !== "rotate_credential") throw new BossValidationError(`${path}.operation`, "does not match credential target");
  if (["boss", "participant", "subscriber"].includes(result.targetKind)) {
    if (result.priorBindingEpoch === null || result.resultingBindingEpoch === null || result.resultingBindingEpoch !== result.priorBindingEpoch + 1) throw new BossValidationError(path, "binding transition must increment its epoch by one");
  } else if (result.priorBindingEpoch !== null || result.resultingBindingEpoch !== null) throw new BossValidationError(path, "this target cannot project a binding epoch");
  if (result.brokerState === "unprepared") {
    if (result.brokerRevision !== null || result.prepareTokenDigest !== null || result.preparedAt !== null) throw new BossValidationError(path, "unprepared transition cannot contain broker prepare fields");
  } else if (result.brokerRevision === null || result.prepareTokenDigest === null || result.preparedAt === null || result.brokerRevision <= result.expectedBrokerRevision) {
    throw new BossValidationError(path, "prepared or terminal transition requires a later broker revision, prepare digest, and preparedAt");
  }
  if (result.brokerState === "committed" && result.committedAt === null) throw new BossValidationError(`${path}.committedAt`, "committed broker state requires committedAt");
  if (result.brokerState !== "committed" && result.committedAt !== null) throw new BossValidationError(`${path}.committedAt`, "is only allowed for committed broker state");
  if (result.projectionState === "reconciled" && (result.brokerState !== "committed" || result.reconciledAt === null)) throw new BossValidationError(path, "reconciled projection requires broker commit and reconciledAt");
  if (result.projectionState !== "reconciled" && result.reconciledAt !== null) throw new BossValidationError(`${path}.reconciledAt`, "is only allowed for reconciled projection");
  if (result.brokerState === "aborted" && (result.abortedAt === null || result.abortReason === null || result.projectionState !== "aborted")) throw new BossValidationError(path, "aborted broker state requires an aborted projection, timestamp, and reason");
  if (result.projectionState === "aborted" && result.brokerState !== "aborted") throw new BossValidationError(`${path}.projectionState`, "aborted projection requires an aborted broker transition");
  if (result.brokerState !== "aborted" && (result.abortedAt !== null || result.abortReason !== null)) throw new BossValidationError(path, "abort fields are only allowed for aborted state");
  for (const [name, valueAt] of [["preparedAt", result.preparedAt], ["committedAt", result.committedAt], ["reconciledAt", result.reconciledAt], ["abortedAt", result.abortedAt]] as const) if (valueAt !== null) ordered(result.createdAt, valueAt, `${path}.${name}`);
  if (result.preparedAt !== null && result.committedAt !== null) ordered(result.preparedAt, result.committedAt, `${path}.committedAt`);
  if (result.committedAt !== null && result.reconciledAt !== null) ordered(result.committedAt, result.reconciledAt, `${path}.reconciledAt`);
  return result;
}

export function parseBossAuthorityTransitionProjectionV1(value: unknown): BossAuthorityTransitionProjectionV1 { return parseAuthority(value, "$"); }

function auditPayload(entry: Omit<BossAuditEntryV1, "entryDigest">): unknown { return entry; }

export function canonicalBossJson(value: unknown): string {
  const normalize = (input: unknown, path: string): unknown => {
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "string") return wellFormed(input, path);
    if (typeof input === "number") return integer(input, path, Number.MIN_SAFE_INTEGER);
    if (Array.isArray(input)) return denseArray(input, path).map((entry, index) => normalize(entry, `${path}[${index}]`));
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new BossValidationError(path, "must be a canonical JSON value");
    const record = ownRecord(input, Reflect.ownKeys(input).filter((key): key is string => typeof key === "string"), [], path);
    const normalized: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) normalized[key] = normalize(record[key], `${path}.${key}`);
    return normalized;
  };
  return JSON.stringify(normalize(value, "$"));
}

export function sha256BossValue(domain: string, value: unknown): string {
  if (!/^[!-~]+$/.test(domain)) throw new BossValidationError("$.domain", "must be printable ASCII without spaces");
  return createHash("sha256").update(`${domain}:${Buffer.byteLength(domain)}:`).update(canonicalBossJson(value)).digest("hex");
}

export function computeBossAuditEntryDigest(entry: Omit<BossAuditEntryV1, "entryDigest">): string {
  return sha256BossValue("orc-boss-audit-entry-v1", auditPayload(entry));
}

function parseAudit(value: unknown, path: string): BossAuditEntryV1 {
  const keys = ["version", "auditEntryId", "bossRunId", "sequence", "actorType", "actorId", "entityType", "entityId", "action", "outcome", "detailsDigest", "previousEntryDigest", "entryDigest", "occurredAt"] as const;
  const v = ownRecord(value, keys, [], path);
  literalVersion(v.version, BOSS_AUDIT_ENTRY_VERSION, `${path}.version`);
  const result: BossAuditEntryV1 = {
    version: BOSS_AUDIT_ENTRY_VERSION,
    auditEntryId: id(v.auditEntryId, `${path}.auditEntryId`),
    bossRunId: id(v.bossRunId, `${path}.bossRunId`),
    sequence: integer(v.sequence, `${path}.sequence`, 1),
    actorType: enumeration(v.actorType, AUDIT_ACTOR_TYPES, `${path}.actorType`),
    actorId: nullableId(v.actorId, `${path}.actorId`),
    entityType: enumeration(v.entityType, AUDIT_ENTITY_TYPES, `${path}.entityType`),
    entityId: id(v.entityId, `${path}.entityId`),
    action: enumeration(v.action, AUDIT_ACTIONS, `${path}.action`),
    outcome: enumeration(v.outcome, AUDIT_OUTCOMES, `${path}.outcome`),
    detailsDigest: digest(v.detailsDigest, `${path}.detailsDigest`),
    previousEntryDigest: v.previousEntryDigest === null ? null : digest(v.previousEntryDigest, `${path}.previousEntryDigest`),
    entryDigest: digest(v.entryDigest, `${path}.entryDigest`),
    occurredAt: timestamp(v.occurredAt, `${path}.occurredAt`),
  };
  const { entryDigest, ...unsigned } = result;
  if (computeBossAuditEntryDigest(unsigned) !== entryDigest) throw new BossValidationError(`${path}.entryDigest`, "does not match the canonical audit entry");
  return result;
}

export function parseBossAuditEntryV1(value: unknown): BossAuditEntryV1 { return parseAudit(value, "$"); }

function uniqueBy<T>(values: T[], select: (value: T) => string, path: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const value of values) {
    const key = select(value);
    if (map.has(key)) throw new BossValidationError(path, `duplicate identifier ${key}`);
    map.set(key, value);
  }
  return map;
}

function entityExists(state: BossControllerStateV1, type: AuditEntityType, entityId: string): boolean {
  switch (type) {
    case "store": return state.storeId === entityId;
    case "run": return state.run.bossRunId === entityId;
    case "goal_revision": return state.goalRevisions.some((value) => value.goalRevisionId === entityId);
    case "participant": return state.participants.some((value) => value.participantId === entityId);
    case "assignment": return state.assignments.some((value) => value.assignmentId === entityId);
    case "approval": return state.approvals.some((value) => value.approvalId === entityId);
    case "proof_manifest": return state.proofManifests.some((value) => value.proofManifestId === entityId);
    case "evidence_ref": return state.evidenceRefs.some((value) => value.evidenceRefId === entityId);
    case "outbox_item": return state.outbox.some((value) => value.outboxItemId === entityId);
    case "watchdog": return state.watchdogs.some((value) => value.watchdogId === entityId);
    case "authority_transition": return state.authorityTransitions.some((value) => value.authorityTransitionId === entityId);
  }
}

function validateCrossEntity(state: BossControllerStateV1): void {
  const runId = state.run.bossRunId;
  const entityArrays: readonly (readonly { bossRunId: string }[])[] = [state.goalRevisions, state.participants, state.assignments, state.approvals, state.proofManifests, state.evidenceRefs, state.outbox, state.watchdogs, state.authorityTransitions, state.audit];
  for (const collection of entityArrays) for (const entity of collection) if (entity.bossRunId !== runId) throw new BossValidationError("$", "every entity must belong to the store Boss run");

  const goals = uniqueBy(state.goalRevisions, (value) => value.goalRevisionId, "$.goalRevisions");
  const participants = uniqueBy(state.participants, (value) => value.participantId, "$.participants");
  const assignments = uniqueBy(state.assignments, (value) => value.assignmentId, "$.assignments");
  const proofs = uniqueBy(state.proofManifests, (value) => value.proofManifestId, "$.proofManifests");
  const evidence = uniqueBy(state.evidenceRefs, (value) => value.evidenceRefId, "$.evidenceRefs");
  const transitions = uniqueBy(state.authorityTransitions, (value) => value.authorityTransitionId, "$.authorityTransitions");
  uniqueBy(state.approvals, (value) => value.approvalId, "$.approvals");
  uniqueBy(state.outbox, (value) => value.outboxItemId, "$.outbox");
  uniqueBy(state.outbox, (value) => value.messageId, "$.outbox.messageId");
  uniqueBy(state.watchdogs, (value) => value.watchdogId, "$.watchdogs");
  uniqueBy(state.audit, (value) => value.auditEntryId, "$.audit");

  const orderedGoals = [...state.goalRevisions].sort((left, right) => left.revision - right.revision);
  if (orderedGoals.length === 0) throw new BossValidationError("$.goalRevisions", "must contain the current goal");
  for (let index = 0; index < orderedGoals.length; index += 1) {
    const goal = orderedGoals[index];
    if (goal.revision !== index + 1) throw new BossValidationError("$.goalRevisions", "revision numbers must be contiguous from one");
    if (index > 0 && goal.parentGoalRevisionId !== orderedGoals[index - 1].goalRevisionId) throw new BossValidationError("$.goalRevisions", "each revision must point to its immediate predecessor");
    const creator = participants.get(goal.createdByParticipantId);
    if (creator?.role !== "boss") throw new BossValidationError("$.goalRevisions", "goal revisions must be created by the Boss participant");
    if ((goal.goalRevisionId === state.run.currentGoalRevisionId) !== (goal.state === "current")) throw new BossValidationError("$.goalRevisions", "exactly the run currentGoalRevisionId must be current");
  }
  if (!goals.has(state.run.currentGoalRevisionId)) throw new BossValidationError("$.run.currentGoalRevisionId", "does not reference a goal revision");

  for (const role of ["manager", "adversary"] as const) {
    const candidates = state.participants.filter((value) => value.role === role && value.bindingState !== "revoked" && value.bindingState !== "replaced");
    if (candidates.length > 1) throw new BossValidationError("$.participants", `at most one current ${role} is allowed`);
    if (["active", "awaiting_approval"].includes(state.run.state) && (candidates.length !== 1 || candidates[0].bindingState !== "active")) throw new BossValidationError("$.participants", `run state ${state.run.state} requires one active ${role}`);
  }
  for (const participant of state.participants) {
    if (participant.assignedManagerParticipantId !== null && participants.get(participant.assignedManagerParticipantId)?.role !== "manager") throw new BossValidationError("$.participants", "Worker/Scout manager reference must identify a Manager");
    if (participant.bindingState !== "pending") {
      const transition = transitions.get(participant.authorityTransitionId!);
      if (transition?.targetKind !== "participant" || transition.targetId !== participant.participantId || transition.brokerState !== "committed" || transition.projectionState !== "reconciled" || transition.resultingBindingEpoch !== participant.bindingEpoch) throw new BossValidationError("$.participants", "bound participant must reference its reconciled committed authority transition and epoch");
    }
  }

  if (state.run.bossAuthorityTransitionId !== null) {
    const transition = transitions.get(state.run.bossAuthorityTransitionId);
    if (transition?.targetKind !== "boss" || transition.targetId !== runId || transition.brokerState !== "committed" || transition.projectionState !== "reconciled" || transition.resultingBindingEpoch !== state.run.bossBindingEpoch) throw new BossValidationError("$.run.bossAuthorityTransitionId", "must reference the reconciled committed Boss binding transition");
  }

  for (const assignment of state.assignments) {
    if (!goals.has(assignment.goalRevisionId)) throw new BossValidationError("$.assignments", "assignment references an unknown goal revision");
    const manager = participants.get(assignment.managerParticipantId);
    const assignee = participants.get(assignment.assigneeParticipantId);
    if (manager?.role !== "manager" || manager.bindingState !== "active" || !assignee || assignee.bindingState !== "active" || !["worker", "scout"].includes(assignee.role) || assignee.assignedManagerParticipantId !== manager.participantId) throw new BossValidationError("$.assignments", "assignment must follow an active Manager-to-assigned Worker/Scout edge");
    const matching = state.watchdogs.filter((value) => value.assignmentId === assignment.assignmentId && value.generation === assignment.watchdogGeneration);
    if (matching.length !== 1) throw new BossValidationError("$.watchdogs", "each assignment must have exactly one current watchdog generation");
  }
  const activeWriter = state.assignments.filter((value) => value.sourceWriter && !["submitted", "rejected", "cancelled", "failed"].includes(value.state));
  if (activeWriter.length > 1) throw new BossValidationError("$.assignments", "only one nonterminal source-writing assignment is allowed");

  for (const watchdog of state.watchdogs) {
    if (!assignments.has(watchdog.assignmentId)) throw new BossValidationError("$.watchdogs", "watchdog references an unknown assignment");
    if (["armed"].includes(watchdog.state) && (watchdog.controllerGeneration !== state.controllerGeneration || watchdog.authorityTransitionId !== state.controllerAuthorityTransitionId)) throw new BossValidationError("$.watchdogs", "armed watchdog must be fenced by the current Controller authority");
  }

  for (const manifest of state.proofManifests) {
    if (!goals.has(manifest.goalRevisionId) || !participants.has(manifest.producerParticipantId)) throw new BossValidationError("$.proofManifests", "proof references an unknown goal or producer");
    for (const evidenceId of manifest.evidenceRefIds) {
      const item = evidence.get(evidenceId);
      if (!item || item.proofManifestId !== manifest.proofManifestId || item.producerParticipantId !== manifest.producerParticipantId || item.sourceRevision !== manifest.sourceRevision || item.baseRevision !== manifest.baseRevision || item.integrationRevision !== manifest.integrationRevision || item.profileDigest !== manifest.profileDigest || item.configDigest !== manifest.configDigest) throw new BossValidationError("$.proofManifests", "evidence reference must exist and exactly match its revision/config/producer binding");
    }
  }
  for (const item of state.evidenceRefs) {
    const manifest = proofs.get(item.proofManifestId);
    if (!manifest || !manifest.evidenceRefIds.includes(item.evidenceRefId)) throw new BossValidationError("$.evidenceRefs", "evidence must be listed by its proof manifest");
  }

  for (const approval of state.approvals) {
    const manifest = proofs.get(approval.proofManifestId);
    if (!manifest || manifest.goalRevisionId !== approval.goalRevisionId) throw new BossValidationError("$.approvals", "approval must reference proof for the same goal revision");
    if (approval.state === "approved" && manifest.state !== "submitted") throw new BossValidationError("$.approvals", "only submitted proof can be approved");
    if (approval.decidedByParticipantId !== null && participants.get(approval.decidedByParticipantId)?.role !== "boss") throw new BossValidationError("$.approvals", "approval decisions require the Boss participant");
  }

  const currentAuthority = transitions.get(state.controllerAuthorityTransitionId);
  if (currentAuthority?.operation !== "controller_takeover" || currentAuthority.targetKind !== "controller" || currentAuthority.targetId !== state.run.controllerPrincipalId || currentAuthority.brokerState !== "committed" || currentAuthority.projectionState !== "reconciled" || currentAuthority.resultingControllerGeneration !== state.controllerGeneration) throw new BossValidationError("$.controllerAuthorityTransitionId", "must reference the reconciled committed Controller takeover for the current generation");

  for (const item of state.outbox) {
    if (!entityExists(state, item.entityType, item.entityId)) throw new BossValidationError("$.outbox", "outbox item references an unknown entity");
    if (["pending", "claimed"].includes(item.state) && (item.controllerGeneration !== state.controllerGeneration || item.authorityTransitionId !== state.controllerAuthorityTransitionId)) throw new BossValidationError("$.outbox", "mutable outbox item must be fenced by the current Controller authority");
  }

  for (let index = 0; index < state.audit.length; index += 1) {
    const entry = state.audit[index];
    if (entry.sequence !== index + 1) throw new BossValidationError(`$.audit[${index}].sequence`, "must be contiguous and ordered");
    const expectedPrevious = index === 0 ? null : state.audit[index - 1].entryDigest;
    if (entry.previousEntryDigest !== expectedPrevious) throw new BossValidationError(`$.audit[${index}].previousEntryDigest`, "does not continue the audit hash chain");
    if (!entityExists(state, entry.entityType, entry.entityId)) throw new BossValidationError(`$.audit[${index}].entityId`, "references an unknown entity");
  }
  if (state.audit.length === 0 || state.audit[0].action !== "store.created") throw new BossValidationError("$.audit", "must begin with store.created");
}

export function parseBossControllerState(value: unknown): BossControllerStateV1 {
  const keys = ["version", "requiredFeatures", "storeId", "revision", "controllerGeneration", "controllerAuthorityTransitionId", "run", "goalRevisions", "participants", "assignments", "approvals", "proofManifests", "evidenceRefs", "outbox", "watchdogs", "authorityTransitions", "audit", "createdAt", "updatedAt"] as const;
  const v = ownRecord(value, keys, [], "$");
  literalVersion(v.version, BOSS_CONTROLLER_STORE_VERSION, "$.version");
  const features = denseArray(v.requiredFeatures, "$.requiredFeatures");
  for (let index = 0; index < features.length; index += 1) {
    const feature = string(features[index], `$.requiredFeatures[${index}]`, 128);
    if (feature !== BOSS_REQUIRED_FEATURE) throw new BossUnsupportedFeatureError(`$.requiredFeatures[${index}]`, feature);
  }
  if (features.length !== 1) throw new BossValidationError("$.requiredFeatures", `must contain exactly ${BOSS_REQUIRED_FEATURE}`);
  const state: BossControllerStateV1 = {
    version: BOSS_CONTROLLER_STORE_VERSION,
    requiredFeatures: [BOSS_REQUIRED_FEATURE],
    storeId: id(v.storeId, "$.storeId"),
    revision: integer(v.revision, "$.revision", 1),
    controllerGeneration: integer(v.controllerGeneration, "$.controllerGeneration", 1),
    controllerAuthorityTransitionId: id(v.controllerAuthorityTransitionId, "$.controllerAuthorityTransitionId"),
    run: parseRun(v.run, "$.run"),
    goalRevisions: denseArray(v.goalRevisions, "$.goalRevisions").map((entry, index) => parseGoal(entry, `$.goalRevisions[${index}]`)),
    participants: denseArray(v.participants, "$.participants").map((entry, index) => parseParticipant(entry, `$.participants[${index}]`)),
    assignments: denseArray(v.assignments, "$.assignments").map((entry, index) => parseAssignment(entry, `$.assignments[${index}]`)),
    approvals: denseArray(v.approvals, "$.approvals").map((entry, index) => parseApproval(entry, `$.approvals[${index}]`)),
    proofManifests: denseArray(v.proofManifests, "$.proofManifests").map((entry, index) => parseProof(entry, `$.proofManifests[${index}]`)),
    evidenceRefs: denseArray(v.evidenceRefs, "$.evidenceRefs").map((entry, index) => parseEvidence(entry, `$.evidenceRefs[${index}]`)),
    outbox: denseArray(v.outbox, "$.outbox").map((entry, index) => parseOutbox(entry, `$.outbox[${index}]`)),
    watchdogs: denseArray(v.watchdogs, "$.watchdogs").map((entry, index) => parseWatchdog(entry, `$.watchdogs[${index}]`)),
    authorityTransitions: denseArray(v.authorityTransitions, "$.authorityTransitions").map((entry, index) => parseAuthority(entry, `$.authorityTransitions[${index}]`)),
    audit: denseArray(v.audit, "$.audit").map((entry, index) => parseAudit(entry, `$.audit[${index}]`)),
    createdAt: timestamp(v.createdAt, "$.createdAt"),
    updatedAt: timestamp(v.updatedAt, "$.updatedAt"),
  };
  ordered(state.createdAt, state.updatedAt, "$.updatedAt");
  if (state.run.createdAt !== state.createdAt) throw new BossValidationError("$.run.createdAt", "must match the store creation timestamp");
  validateCrossEntity(state);
  return state;
}

export function detachedBossSnapshot<T>(value: T): T {
  return JSON.parse(canonicalBossJson(value)) as T;
}

export function bossEntityId(kind: BossEntityKind, entity: BossEntityByKind[BossEntityKind]): string {
  switch (kind) {
    case "run": return (entity as BossRunV1).bossRunId;
    case "goalRevisions": return (entity as BossGoalRevisionV1).goalRevisionId;
    case "participants": return (entity as BossParticipantV1).participantId;
    case "assignments": return (entity as BossAssignmentV1).assignmentId;
    case "approvals": return (entity as BossApprovalV1).approvalId;
    case "proofManifests": return (entity as BossProofManifestV1).proofManifestId;
    case "evidenceRefs": return (entity as BossEvidenceRefV1).evidenceRefId;
    case "outbox": return (entity as BossOutboxItemV1).outboxItemId;
    case "watchdogs": return (entity as BossWatchdogV1).watchdogId;
    case "authorityTransitions": return (entity as BossAuthorityTransitionProjectionV1).authorityTransitionId;
    case "audit": return (entity as BossAuditEntryV1).auditEntryId;
  }
}
