import { isProxy } from "node:util/types";
import {
  parseAuthorityTransitionEvent,
  parseAuthorityTransitionRecord,
  type AuthorityTransitionEpochs,
  type AuthorityTransitionEvent,
  type AuthorityTransitionOperation,
  type AuthorityTransitionRecord,
} from "@ctliz/agent-intercom-core/boss";
import {
  BOSS_AUDIT_ENTRY_VERSION,
  BOSS_AUTHORITY_PROJECTION_VERSION,
  canonicalBossJson,
  computeBossAuditEntryDigest,
  parseBossAuthorityTransitionProjectionV1,
  sha256BossValue,
  type AuthorityTargetKind,
  type BossAuditEntryV1,
  type BossAuthorityTransitionProjectionV1,
  type BossControllerStateV1,
} from "./boss-types.ts";

export const BOSS_AUTHORITY_RECONCILIATION_AUDIT_DOMAIN = "orc-boss-authority-reconciliation-v1" as const;
export const BOSS_AUTHORITY_PREPARE_TOKEN_DOMAIN = "orc-boss-prepare-token-v1" as const;

export type BossAuthorityReconciliationErrorCode =
  | "invalid_evidence"
  | "unsupported_transition_state"
  | "unsupported_operation"
  | "evidence_mismatch"
  | "run_mismatch"
  | "target_mismatch"
  | "controller_mismatch"
  | "generation_mismatch"
  | "stale_broker_revision"
  | "duplicate_conflict"
  | "chronology_mismatch";

export class BossAuthorityReconciliationError extends Error {
  readonly code: BossAuthorityReconciliationErrorCode;

  constructor(code: BossAuthorityReconciliationErrorCode, message: string, cause?: unknown) {
    super(message, { cause: cause instanceof Error ? cause : undefined });
    this.name = "BossAuthorityReconciliationError";
    this.code = code;
  }
}

/** The deliberately small BossStore surface used by the dormant reconciler. */
export interface BossAuthorityReconciliationStore {
  read(): Promise<BossControllerStateV1>;
  transaction(
    expectedRevision: number,
    mutate: (draft: BossControllerStateV1) => void | Promise<void>,
  ): Promise<BossControllerStateV1>;
}

export interface BossAuthorityReconcilerOptions {
  /** Supplies the reconciliation/audit time. It must not precede durable evidence or store history. */
  now?: () => string;
  /** Optional deterministic ID policy for the appended authority audit entry. */
  auditEntryId?: (context: {
    transition: AuthorityTransitionRecord;
    event: AuthorityTransitionEvent;
    projection: BossAuthorityTransitionProjectionV1;
    detailsDigest: string;
  }) => string;
}

export interface BossAuthorityReconciliationResult {
  status: "reconciled" | "already_reconciled";
  projection: BossAuthorityTransitionProjectionV1;
  state: BossControllerStateV1;
}

type TargetProjection = { targetKind: AuthorityTargetKind; targetId: string };

function fail(code: BossAuthorityReconciliationErrorCode, message: string, cause?: unknown): never {
  throw new BossAuthorityReconciliationError(code, message, cause);
}

/* Reject accessors, proxies, inherited fields, symbols, sparse arrays, and exotic objects before
 * Core's parsers touch caller-controlled evidence. Core then enforces every exact wire key. */
function assertOwnDataTree(value: unknown, path = "$", seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (isProxy(value)) fail("invalid_evidence", `${path} must not be a Proxy`);
  if (seen.has(value)) fail("invalid_evidence", `${path} must not contain cycles or aliases`);
  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail("invalid_evidence", `${path} must be a plain array`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
        fail("invalid_evidence", `${path} contains a non-index array property`);
      }
      const index = Number(key);
      const descriptor = descriptors[key]!;
      if (index >= value.length || !descriptor.enumerable || !("value" in descriptor)) {
        fail("invalid_evidence", `${path}[${index}] must be an enumerable own data property`);
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor)) fail("invalid_evidence", `${path}[${index}] is sparse`);
      assertOwnDataTree(descriptor.value, `${path}[${index}]`, seen);
    }
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid_evidence", `${path} must be a plain data object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail("invalid_evidence", `${path} must not contain symbol properties`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      fail("invalid_evidence", `${path}.${key} must be an enumerable own data property`);
    }
    assertOwnDataTree(descriptor.value, `${path}.${key}`, seen);
  }
}

function parseEvidence(
  transitionValue: unknown,
  eventValue: unknown,
): { transition: AuthorityTransitionRecord; event: AuthorityTransitionEvent } {
  try {
    assertOwnDataTree(transitionValue, "$transition");
    assertOwnDataTree(eventValue, "$event");
    // The Core parsers return their argument. Canonical cloning prevents a caller from changing
    // accepted evidence while the CAS transaction is awaiting the store lock.
    const transition = parseAuthorityTransitionRecord(JSON.parse(canonicalBossJson(transitionValue)));
    const event = parseAuthorityTransitionEvent(JSON.parse(canonicalBossJson(eventValue)));
    return { transition, event };
  } catch (error) {
    if (error instanceof BossAuthorityReconciliationError) throw error;
    return fail("invalid_evidence", "authority transition evidence is not an exact Core contract", error);
  }
}

function same(left: unknown, right: unknown): boolean {
  return canonicalBossJson(left) === canonicalBossJson(right);
}

function assertMatchingEvidence(transition: AuthorityTransitionRecord, event: AuthorityTransitionEvent): void {
  if (transition.state !== "committed") {
    fail("unsupported_transition_state", `authority transition state ${transition.state} has no authoritative committed event projection`);
  }
  if (
    transition.authorityTransitionId !== event.authorityTransitionId
    || transition.brokerRevision !== event.brokerRevision
    || transition.operation !== event.operation
    || transition.committedAt !== event.occurredAt
    || !same(transition.target, event.target)
    || !same(transition.prior, event.prior)
    || !same(transition.proposed, event.resulting)
  ) {
    fail("evidence_mismatch", "broker record and committed authority event do not describe the same exact transition");
  }
}

function targetProjection(operation: AuthorityTransitionOperation, transition: AuthorityTransitionRecord): TargetProjection {
  switch (operation) {
    case "bind_boss":
    case "rebind_boss":
    case "revoke_boss":
      return { targetKind: "boss", targetId: transition.target.bossRunId! };
    case "bind_participant":
    case "rebind_participant":
    case "revoke_participant":
    case "replace_participant":
    case "replace_manager":
      return { targetKind: "participant", targetId: transition.target.participantId! };
    case "rebind_subscriber":
      return { targetKind: "subscriber", targetId: transition.target.subscriberPrincipalId! };
    case "controller_takeover":
      return { targetKind: "controller", targetId: transition.target.controllerPrincipalId! };
    case "rotate_credential":
      return { targetKind: "credential", targetId: transition.target.credentialId! };
  }
}

function bindingEpochs(operation: AuthorityTransitionOperation, prior: AuthorityTransitionEpochs, resulting: AuthorityTransitionEpochs): [number | null, number | null] {
  if (operation === "bind_boss" || operation === "rebind_boss" || operation === "revoke_boss") {
    return [prior.bossBindingEpoch!, resulting.bossBindingEpoch!];
  }
  if (operation === "rebind_subscriber") {
    return [prior.subscriberBindingEpoch!, resulting.subscriberBindingEpoch!];
  }
  if (["bind_participant", "rebind_participant", "revoke_participant", "replace_participant", "replace_manager"].includes(operation)) {
    return [prior.participantBindingEpoch!, resulting.participantBindingEpoch!];
  }
  // BossAuthorityTransitionProjectionV1 intentionally carries neither credential epochs nor a
  // generic generation slot. Core evidence remains bound into the audit details digest.
  return [null, null];
}

function assertTargetEntity(state: BossControllerStateV1, transition: AuthorityTransitionRecord): void {
  if (["rebind_subscriber", "rotate_credential", "replace_participant", "replace_manager"].includes(transition.operation)) {
    fail("unsupported_operation", `${transition.operation} has no exact atomic run-owned Controller entity projection`);
  }
  const priorEpoch = transition.prior.participantBindingEpoch;
  if (["bind_participant", "rebind_participant", "revoke_participant", "replace_participant", "replace_manager"].includes(transition.operation)) {
    const participant = state.participants.find((item) => item.participantId === transition.target.participantId);
    if (!participant || participant.bossRunId !== state.run.bossRunId || participant.bindingEpoch !== priorEpoch) {
      fail("target_mismatch", "participant authority evidence must target an exact current run participant at its prior epoch");
    }
    if (transition.operation === "bind_participant" && (participant.bindingState !== "pending" || participant.authorityTransitionId !== null)) {
      fail("target_mismatch", "initial participant binding requires the exact pending unbound participant");
    }
  }
  if (["bind_boss", "rebind_boss", "revoke_boss"].includes(transition.operation)
    && transition.prior.bossBindingEpoch !== state.run.bossBindingEpoch) {
    fail("target_mismatch", "Boss authority evidence must start at the run's exact current Boss binding epoch");
  }
}

function assertStoreAuthority(
  state: BossControllerStateV1,
  transition: AuthorityTransitionRecord,
  event: AuthorityTransitionEvent,
  replay: boolean,
): void {
  if (["rebind_subscriber", "rotate_credential", "replace_participant", "replace_manager"].includes(transition.operation)) {
    fail("unsupported_operation", `${transition.operation} has no exact atomic run-owned Controller entity projection`);
  }
  if (transition.target.bossRunId !== state.run.bossRunId || event.bossRunId !== state.run.bossRunId) {
    fail("run_mismatch", "authority evidence must name the exact Boss run owned by the store");
  }

  if (!replay) assertTargetEntity(state, transition);

  const before = transition.prior.controllerGeneration;
  const after = transition.proposed.controllerGeneration;
  if (transition.operation === "controller_takeover") {
    if (transition.target.controllerPrincipalId !== state.run.controllerPrincipalId) {
      fail("controller_mismatch", "Controller takeover targets a different Controller principal");
    }
    if (!replay && (before !== state.controllerGeneration || after !== state.controllerGeneration + 1)) {
      fail("generation_mismatch", "Controller takeover must advance exactly the current store generation");
    }
  } else if (!replay) {
    if (before !== state.controllerGeneration || after !== state.controllerGeneration) {
      fail("generation_mismatch", "non-takeover evidence must carry the unchanged current Controller generation fence");
    }
  }
}

function projectionFor(
  transition: AuthorityTransitionRecord,
  reconciledAt: string,
): BossAuthorityTransitionProjectionV1 {
  const target = targetProjection(transition.operation, transition);
  const [priorBindingEpoch, resultingBindingEpoch] = bindingEpochs(transition.operation, transition.prior, transition.proposed);
  try {
    return parseBossAuthorityTransitionProjectionV1({
      version: BOSS_AUTHORITY_PROJECTION_VERSION,
      authorityTransitionId: transition.authorityTransitionId,
      bossRunId: transition.target.bossRunId,
      operation: transition.operation,
      ...target,
      idempotencyKey: transition.idempotencyKey,
      expectedBrokerRevision: transition.expectedBrokerRevision,
      brokerRevision: transition.brokerRevision,
      priorControllerGeneration: transition.operation === "controller_takeover" ? transition.prior.controllerGeneration : null,
      resultingControllerGeneration: transition.operation === "controller_takeover" ? transition.proposed.controllerGeneration : null,
      priorBindingEpoch,
      resultingBindingEpoch,
      brokerState: "committed",
      projectionState: "reconciled",
      prepareTokenDigest: sha256BossValue(BOSS_AUTHORITY_PREPARE_TOKEN_DOMAIN, transition.prepareToken),
      createdAt: transition.preparedAt,
      preparedAt: transition.preparedAt,
      committedAt: transition.committedAt,
      reconciledAt,
      abortedAt: null,
      abortReason: null,
    });
  } catch (error) {
    return fail("chronology_mismatch", "committed authority evidence cannot form a valid reconciled projection", error);
  }
}

function reconciliationDetailsDigest(
  transition: AuthorityTransitionRecord,
  event: AuthorityTransitionEvent,
  projection: BossAuthorityTransitionProjectionV1,
): string {
  return sha256BossValue(BOSS_AUTHORITY_RECONCILIATION_AUDIT_DOMAIN, {
    brokerEvent: event,
    brokerTransition: transition,
    controllerProjection: projection,
  });
}

function assertIdempotentAudit(
  state: BossControllerStateV1,
  projection: BossAuthorityTransitionProjectionV1,
  detailsDigest: string,
): void {
  const entries = state.audit.filter((entry) =>
    entry.entityType === "authority_transition"
    && entry.entityId === projection.authorityTransitionId
    && entry.action === "authority.reconciled");
  if (entries.length !== 1) fail("duplicate_conflict", "reconciled authority projection lacks one exact authority audit entry");
  const entry = entries[0];
  if (entry.bossRunId !== projection.bossRunId
    || entry.actorType !== "controller"
    || entry.actorId !== state.run.controllerPrincipalId
    || entry.outcome !== "success"
    || entry.detailsDigest !== detailsDigest
    || entry.occurredAt !== projection.reconciledAt) {
    fail("duplicate_conflict", "reconciled authority projection audit conflicts with the supplied broker evidence");
  }
}

function assertNoIdentityCollisions(state: BossControllerStateV1, transition: AuthorityTransitionRecord): void {
  if (state.authorityTransitions.some((item) => item.authorityTransitionId !== transition.authorityTransitionId
    && (item.idempotencyKey === transition.idempotencyKey || item.brokerRevision === transition.brokerRevision))) {
    fail("duplicate_conflict", "another authority transition already uses this idempotency key or broker revision");
  }
}

function defaultAuditEntryId(detailsDigest: string): string {
  return `authority-audit-${detailsDigest}`;
}

function appendAudit(
  state: BossControllerStateV1,
  transition: AuthorityTransitionRecord,
  event: AuthorityTransitionEvent,
  projection: BossAuthorityTransitionProjectionV1,
  detailsDigest: string,
  idFactory?: BossAuthorityReconcilerOptions["auditEntryId"],
): void {
  const previous = state.audit.at(-1)!;
  const callbackContext = JSON.parse(canonicalBossJson({ transition, event, projection, detailsDigest })) as {
    transition: AuthorityTransitionRecord;
    event: AuthorityTransitionEvent;
    projection: BossAuthorityTransitionProjectionV1;
    detailsDigest: string;
  };
  const auditEntryId = idFactory?.(callbackContext) ?? defaultAuditEntryId(detailsDigest);
  if (state.audit.some((entry) => entry.auditEntryId === auditEntryId)) {
    fail("duplicate_conflict", `authority audit identifier ${auditEntryId} is already present`);
  }
  const unsigned: Omit<BossAuditEntryV1, "entryDigest"> = {
    version: BOSS_AUDIT_ENTRY_VERSION,
    auditEntryId,
    bossRunId: state.run.bossRunId,
    sequence: previous.sequence + 1,
    actorType: "controller",
    actorId: state.run.controllerPrincipalId,
    entityType: "authority_transition",
    entityId: projection.authorityTransitionId,
    action: "authority.reconciled",
    outcome: "success",
    detailsDigest,
    previousEntryDigest: previous.entryDigest,
    occurredAt: projection.reconciledAt!,
  };
  state.audit.push({ ...unsigned, entryDigest: computeBossAuditEntryDigest(unsigned) });
}

/**
 * Reconciles one exact committed Core authority record/event pair into BossStore. The function
 * does no broker discovery, socket selection, service activation, participant work, or retries.
 * A CAS conflict is returned by BossStore and must be resolved by re-querying authoritative data.
 */
export async function reconcileCommittedBossAuthorityTransition(
  store: BossAuthorityReconciliationStore,
  transitionValue: unknown,
  eventValue: unknown,
  options: BossAuthorityReconcilerOptions = {},
): Promise<BossAuthorityReconciliationResult> {
  const { transition, event } = parseEvidence(transitionValue, eventValue);
  assertMatchingEvidence(transition, event);
  const observed = await store.read();
  const existing = observed.authorityTransitions.find((item) => item.authorityTransitionId === transition.authorityTransitionId);
  assertStoreAuthority(observed, transition, event, existing !== undefined);
  assertNoIdentityCollisions(observed, transition);
  if (existing) {
    const expected = projectionFor(transition, existing.reconciledAt ?? transition.committedAt!);
    if (!same(existing, expected)) fail("duplicate_conflict", "authority transition identifier already names different projection content");
    assertIdempotentAudit(observed, existing, reconciliationDetailsDigest(transition, event, existing));
    return { status: "already_reconciled", projection: existing, state: observed };
  }

  if (observed.authorityTransitions.some((item) => item.idempotencyKey === transition.idempotencyKey)) {
    fail("duplicate_conflict", "authority idempotency key is already bound to another transition");
  }
  if (observed.authorityTransitions.some((item) => item.brokerRevision === transition.brokerRevision)) {
    fail("duplicate_conflict", "broker revision is already bound to another authority transition");
  }
  const latestBrokerRevision = Math.max(0, ...observed.authorityTransitions.map((item) => item.brokerRevision ?? 0));
  if (transition.brokerRevision <= latestBrokerRevision) {
    fail("stale_broker_revision", "new authority projection must advance the observed broker revision chronology");
  }

  const reconciledAt = options.now?.() ?? new Date().toISOString();
  const latestAuditMillis = Math.max(Date.parse(observed.createdAt), ...observed.audit.map((entry) => Date.parse(entry.occurredAt)));
  if (Date.parse(reconciledAt) < Date.parse(transition.committedAt!)
    || Date.parse(reconciledAt) < Date.parse(observed.updatedAt)
    || Date.parse(reconciledAt) < latestAuditMillis) {
    fail("chronology_mismatch", "reconciliation time must not precede the broker commit or durable store history");
  }
  const projection = projectionFor(transition, reconciledAt);
  const detailsDigest = reconciliationDetailsDigest(transition, event, projection);

  let persisted: BossControllerStateV1;
  try {
    persisted = await store.transaction(observed.revision, (draft) => {
      // BossStore's CAS guarantees this draft is the same revision observed above. Repeat the
      // authority fence inside the mutation so dependency substitutes cannot bypass it silently.
      assertStoreAuthority(draft, transition, event, false);
      if (draft.authorityTransitions.some((item) =>
        item.authorityTransitionId === transition.authorityTransitionId
        || item.idempotencyKey === transition.idempotencyKey
        || item.brokerRevision === transition.brokerRevision)) {
        fail("duplicate_conflict", "authority identity became conflicting inside the CAS transaction");
      }
      const draftProjection = parseBossAuthorityTransitionProjectionV1(JSON.parse(canonicalBossJson(projection)));
      draft.authorityTransitions.push(draftProjection);
      if (transition.operation === "controller_takeover") {
        draft.controllerGeneration = transition.proposed.controllerGeneration!;
        draft.controllerAuthorityTransitionId = transition.authorityTransitionId;
      }
      appendAudit(draft, transition, event, projection, detailsDigest, options.auditEntryId);
    });
  } catch (error) {
    // A transport/dependency may report failure after the durable transaction committed. Re-query
    // instead of retrying blindly; only the exact projection plus exact audit resolves ambiguity.
    let reconciled: BossControllerStateV1;
    try {
      reconciled = await store.read();
    } catch {
      throw error;
    }
    const reconciledProjection = reconciled.authorityTransitions.find(
      (item) => item.authorityTransitionId === transition.authorityTransitionId,
    );
    assertNoIdentityCollisions(reconciled, transition);
    if (reconciledProjection && same(reconciledProjection, projection)) {
      assertIdempotentAudit(reconciled, reconciledProjection, detailsDigest);
      return { status: "already_reconciled", projection: reconciledProjection, state: reconciled };
    }
    throw error;
  }

  const durable = await store.read();
  const durableProjection = durable.authorityTransitions.find((item) => item.authorityTransitionId === transition.authorityTransitionId);
  assertNoIdentityCollisions(durable, transition);
  if (durable.storeId !== persisted.storeId || durable.revision < persisted.revision
    || !durableProjection || !same(durableProjection, projection)) {
    fail("duplicate_conflict", "BossStore read-back did not contain the exact persisted authority projection");
  }
  assertIdempotentAudit(durable, durableProjection, detailsDigest);
  return { status: "reconciled", projection: durableProjection, state: durable };
}

/** Convenience dependency-injected wrapper; production does not instantiate it yet. */
export class BossAuthorityReconciler {
  readonly store: BossAuthorityReconciliationStore;
  private readonly options: BossAuthorityReconcilerOptions;

  constructor(store: BossAuthorityReconciliationStore, options: BossAuthorityReconcilerOptions = {}) {
    this.store = store;
    this.options = options;
  }

  reconcile(transition: unknown, event: unknown): Promise<BossAuthorityReconciliationResult> {
    return reconcileCommittedBossAuthorityTransition(this.store, transition, event, this.options);
  }
}
