import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AUTHORITY_EVENT_VERSION,
  AUTHORITY_TRANSITION_VERSION,
  type AuthorityTransitionEpochs,
  type AuthorityTransitionEvent,
  type AuthorityTransitionRecord,
} from "@dataforxyz/agent-intercom-core/boss";
import {
  BossAuthorityReconciliationError,
  reconcileCommittedBossAuthorityTransition,
} from "../src/boss-authority-reconciler.ts";
import { BossStore, BossStoreConflictError } from "../src/boss-store.ts";
import {
  BOSS_AUDIT_ENTRY_VERSION,
  BOSS_AUTHORITY_PROJECTION_VERSION,
  BOSS_CONTROLLER_STORE_VERSION,
  BOSS_GOAL_REVISION_VERSION,
  BOSS_PARTICIPANT_VERSION,
  BOSS_REQUIRED_FEATURE,
  BOSS_RUN_VERSION,
  computeBossAuditEntryDigest,
  sha256BossValue,
  type BossAuditEntryV1,
  type BossAuthorityTransitionProjectionV1,
  type BossControllerStateV1,
} from "../src/boss-types.ts";

const CREATED = "2026-01-02T03:04:05.000Z";
const PREPARED = "2026-01-02T03:04:06.000Z";
const COMMITTED = "2026-01-02T03:04:07.000Z";
const RECONCILED = "2026-01-02T03:04:08.000Z";
const TOKEN = "protected-prepare-token-2";
const DIGEST = "a".repeat(64);

function auditEntry(overrides: Partial<Omit<BossAuditEntryV1, "entryDigest">> = {}): BossAuditEntryV1 {
  const unsigned: Omit<BossAuditEntryV1, "entryDigest"> = {
    version: BOSS_AUDIT_ENTRY_VERSION,
    auditEntryId: "audit-store-1",
    bossRunId: "boss-run-1",
    sequence: 1,
    actorType: "system",
    actorId: null,
    entityType: "store",
    entityId: "boss-store-1",
    action: "store.created",
    outcome: "success",
    detailsDigest: DIGEST,
    previousEntryDigest: null,
    occurredAt: CREATED,
    ...overrides,
  };
  return { ...unsigned, entryDigest: computeBossAuditEntryDigest(unsigned) };
}

function initialTakeover(): BossAuthorityTransitionProjectionV1 {
  return {
    version: BOSS_AUTHORITY_PROJECTION_VERSION,
    authorityTransitionId: "authority-controller-1",
    bossRunId: "boss-run-1",
    operation: "controller_takeover",
    targetKind: "controller",
    targetId: "controller-1",
    idempotencyKey: "authority-controller-key-1",
    expectedBrokerRevision: 0,
    brokerRevision: 1,
    priorControllerGeneration: 0,
    resultingControllerGeneration: 1,
    priorBindingEpoch: null,
    resultingBindingEpoch: null,
    brokerState: "committed",
    projectionState: "reconciled",
    prepareTokenDigest: DIGEST,
    createdAt: CREATED,
    preparedAt: CREATED,
    committedAt: CREATED,
    reconciledAt: CREATED,
    abortedAt: null,
    abortReason: null,
  };
}

function baseState(): BossControllerStateV1 {
  return {
    version: BOSS_CONTROLLER_STORE_VERSION,
    requiredFeatures: [BOSS_REQUIRED_FEATURE],
    storeId: "boss-store-1",
    revision: 1,
    controllerGeneration: 1,
    controllerAuthorityTransitionId: "authority-controller-1",
    run: {
      version: BOSS_RUN_VERSION,
      bossRunId: "boss-run-1",
      controllerPrincipalId: "controller-1",
      currentGoalRevisionId: "goal-revision-1",
      state: "paused",
      bossBindingEpoch: 0,
      bossAuthorityTransitionId: null,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    goalRevisions: [{
      version: BOSS_GOAL_REVISION_VERSION,
      goalRevisionId: "goal-revision-1",
      bossRunId: "boss-run-1",
      revision: 1,
      parentGoalRevisionId: null,
      objective: "Test the dormant reconciler",
      acceptanceCriteria: ["Fail closed"],
      createdByParticipantId: "boss-1",
      state: "current",
      createdAt: CREATED,
    }],
    participants: [{
      version: BOSS_PARTICIPANT_VERSION,
      participantId: "boss-1",
      bossRunId: "boss-run-1",
      role: "boss",
      communicationProfile: "boss",
      bindingEpoch: 0,
      bindingState: "pending",
      sessionId: null,
      authorityTransitionId: null,
      assignedManagerParticipantId: null,
      state: "paused",
      reason: null,
      createdAt: CREATED,
      updatedAt: CREATED,
    }],
    assignments: [], approvals: [], proofManifests: [], evidenceRefs: [], outbox: [], watchdogs: [],
    authorityTransitions: [initialTakeover()],
    audit: [auditEntry()],
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

function evidence(): { transition: AuthorityTransitionRecord; event: AuthorityTransitionEvent } {
  const transition = {
    version: AUTHORITY_TRANSITION_VERSION,
    authorityTransitionId: "authority-controller-2",
    expectedBrokerRevision: 1,
    brokerRevision: 2,
    operation: "controller_takeover",
    target: { bossRunId: "boss-run-1", controllerPrincipalId: "controller-1" },
    prior: { controllerGeneration: 1 },
    proposed: { controllerGeneration: 2 },
    idempotencyKey: "authority-controller-key-2",
    state: "committed",
    prepareToken: TOKEN,
    preparedAt: PREPARED,
    committedAt: COMMITTED,
  } as unknown as AuthorityTransitionRecord;
  const event = {
    version: AUTHORITY_EVENT_VERSION,
    eventId: "authority-event-controller-2",
    bossRunId: "boss-run-1",
    authorityTransitionId: transition.authorityTransitionId,
    brokerRevision: transition.brokerRevision,
    operation: transition.operation,
    state: "committed",
    target: transition.target,
    prior: transition.prior,
    resulting: transition.proposed,
    occurredAt: COMMITTED,
  } as unknown as AuthorityTransitionEvent;
  return { transition, event };
}

async function fixture(context: test.TestContext): Promise<BossStore> {
  const root = await mkdtemp(join(tmpdir(), "boss-authority-reconciler-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = new BossStore(join(root, "controller.json"), { now: () => RECONCILED });
  await store.create(baseState());
  return store;
}

test("persists an exact committed takeover, chained audit, and generation advance before return", async (context) => {
  const store = await fixture(context);
  const { transition, event } = evidence();
  const result = await reconcileCommittedBossAuthorityTransition(store, transition, event, { now: () => RECONCILED });

  assert.equal(result.status, "reconciled");
  assert.equal(result.state.revision, 2);
  assert.equal(result.state.controllerGeneration, 2);
  assert.equal(result.state.controllerAuthorityTransitionId, transition.authorityTransitionId);
  assert.equal(result.projection.prepareTokenDigest, sha256BossValue("orc-boss-prepare-token-v1", TOKEN));
  assert.equal(result.projection.reconciledAt, RECONCILED);
  const durable = await store.read();
  assert.deepEqual(durable, result.state);
  assert.equal(durable.audit.length, 2);
  assert.equal(durable.audit[1].previousEntryDigest, durable.audit[0].entryDigest);
  assert.equal(durable.audit[1].entityId, transition.authorityTransitionId);
  assert.equal(durable.audit[1].action, "authority.reconciled");
});

test("exact replay is idempotent and appends neither revision nor audit", async (context) => {
  const store = await fixture(context);
  const { transition, event } = evidence();
  await reconcileCommittedBossAuthorityTransition(store, transition, event, { now: () => RECONCILED });
  const replay = await reconcileCommittedBossAuthorityTransition(store, transition, event, { now: () => "2026-01-02T03:05:00.000Z" });
  assert.equal(replay.status, "already_reconciled");
  assert.equal(replay.state.revision, 2);
  assert.equal(replay.state.audit.length, 2);
});

test("projects a committed participant binding without assigning Controller generation", async (context) => {
  const store = await fixture(context);
  const transition = {
    version: AUTHORITY_TRANSITION_VERSION,
    authorityTransitionId: "authority-boss-bind-1",
    expectedBrokerRevision: 1,
    brokerRevision: 2,
    operation: "bind_participant",
    target: { bossRunId: "boss-run-1", participantId: "boss-1" },
    prior: { participantBindingEpoch: 0, controllerGeneration: 1 },
    proposed: { participantBindingEpoch: 1, controllerGeneration: 1 },
    idempotencyKey: "authority-boss-bind-key-1",
    state: "committed",
    prepareToken: "participant-token-1",
    preparedAt: PREPARED,
    committedAt: COMMITTED,
  };
  const event = {
    version: AUTHORITY_EVENT_VERSION,
    eventId: "authority-event-boss-bind-1",
    bossRunId: "boss-run-1",
    authorityTransitionId: transition.authorityTransitionId,
    brokerRevision: transition.brokerRevision,
    operation: transition.operation,
    state: "committed",
    target: { ...transition.target },
    prior: { ...transition.prior },
    resulting: { ...transition.proposed },
    occurredAt: COMMITTED,
  };
  const unfenced = structuredClone({ transition, event });
  delete (unfenced.transition.prior as Partial<AuthorityTransitionEpochs>).controllerGeneration;
  delete (unfenced.transition.proposed as Partial<AuthorityTransitionEpochs>).controllerGeneration;
  delete (unfenced.event.prior as Partial<AuthorityTransitionEpochs>).controllerGeneration;
  delete (unfenced.event.resulting as Partial<AuthorityTransitionEpochs>).controllerGeneration;
  await assert.rejects(
    reconcileCommittedBossAuthorityTransition(store, unfenced.transition, unfenced.event, { now: () => RECONCILED }),
    (error: unknown) => error instanceof BossAuthorityReconciliationError && error.code === "generation_mismatch",
  );
  const ghost = structuredClone({ transition, event });
  ghost.transition.target.participantId = "ghost";
  ghost.event.target.participantId = "ghost";
  await assert.rejects(
    reconcileCommittedBossAuthorityTransition(store, ghost.transition, ghost.event, { now: () => RECONCILED }),
    (error: unknown) => error instanceof BossAuthorityReconciliationError && error.code === "target_mismatch",
  );

  const result = await reconcileCommittedBossAuthorityTransition(store, transition, event, { now: () => RECONCILED });
  assert.equal(result.projection.targetKind, "participant");
  assert.equal(result.projection.targetId, "boss-1");
  assert.equal(result.projection.priorBindingEpoch, 0);
  assert.equal(result.projection.resultingBindingEpoch, 1);
  assert.equal(result.state.controllerGeneration, 1);
  assert.equal(result.state.controllerAuthorityTransitionId, "authority-controller-1");
});

test("subscriber, credential, and replacement transitions remain explicitly unsupported without atomic run-owned projections", async (context) => {
  const store = await fixture(context);
  const unsupported = [
    {
      operation: "rebind_subscriber",
      target: { subscriberPrincipalId: "subscriber-1" },
      prior: { subscriberBindingEpoch: 1, controllerGeneration: 1 },
      proposed: { subscriberBindingEpoch: 2, controllerGeneration: 1 },
      bossRunId: undefined,
    },
    {
      operation: "rotate_credential",
      target: { bossRunId: "boss-run-1", participantId: "boss-1", credentialId: "credential-1" },
      prior: { participantBindingEpoch: 1, controllerGeneration: 1 },
      proposed: { participantBindingEpoch: 2, controllerGeneration: 1 },
      bossRunId: "boss-run-1",
    },
    {
      operation: "replace_participant",
      target: { bossRunId: "boss-run-1", participantId: "boss-1", replacementParticipantId: "replacement-1" },
      prior: { participantBindingEpoch: 1, controllerGeneration: 1 },
      proposed: { participantBindingEpoch: 2, controllerGeneration: 1 },
      bossRunId: "boss-run-1",
    },
    {
      operation: "replace_manager",
      target: { bossRunId: "boss-run-1", participantId: "manager-1", replacementParticipantId: "manager-2" },
      prior: { participantBindingEpoch: 1, controllerGeneration: 1 },
      proposed: { participantBindingEpoch: 2, controllerGeneration: 1 },
      bossRunId: "boss-run-1",
    },
  ] as const;
  for (const [index, item] of unsupported.entries()) {
    const transition = {
      version: AUTHORITY_TRANSITION_VERSION,
      authorityTransitionId: `authority-unsupported-${index}`,
      expectedBrokerRevision: 1,
      brokerRevision: 2 + index,
      operation: item.operation,
      target: item.target,
      prior: item.prior,
      proposed: item.proposed,
      idempotencyKey: `authority-unsupported-key-${index}`,
      state: "committed",
      prepareToken: `unsupported-token-${index}`,
      preparedAt: PREPARED,
      committedAt: COMMITTED,
    };
    const event = {
      version: AUTHORITY_EVENT_VERSION,
      eventId: `authority-event-unsupported-${index}`,
      ...(item.bossRunId === undefined ? {} : { bossRunId: item.bossRunId }),
      authorityTransitionId: transition.authorityTransitionId,
      brokerRevision: transition.brokerRevision,
      operation: transition.operation,
      state: "committed",
      target: { ...transition.target },
      prior: { ...transition.prior },
      resulting: { ...transition.proposed },
      occurredAt: COMMITTED,
    };
    await assert.rejects(
      reconcileCommittedBossAuthorityTransition(store, transition, event, { now: () => RECONCILED }),
      (error: unknown) => error instanceof BossAuthorityReconciliationError && error.code === "unsupported_operation",
    );
  }
});

test("record/event substitution, wrong run/controller/generation, and stale revision fail closed", async (context) => {
  const store = await fixture(context);
  const cases: Array<[string, (transition: any, event: any) => void, string]> = [
    ["substitution", (_transition, event) => { event.target = { ...event.target, controllerPrincipalId: "controller-2" }; }, "evidence_mismatch"],
    ["run", (transition, event) => { transition.target.bossRunId = "boss-run-2"; event.target.bossRunId = "boss-run-2"; event.bossRunId = "boss-run-2"; }, "run_mismatch"],
    ["controller", (transition, event) => { transition.target.controllerPrincipalId = "controller-2"; event.target.controllerPrincipalId = "controller-2"; }, "controller_mismatch"],
    ["generation", (transition, event) => { transition.prior.controllerGeneration = 2; transition.proposed.controllerGeneration = 3; event.prior.controllerGeneration = 2; event.resulting.controllerGeneration = 3; }, "generation_mismatch"],
    ["revision", (transition, event) => { transition.authorityTransitionId = "authority-controller-stale"; event.authorityTransitionId = transition.authorityTransitionId; transition.expectedBrokerRevision = 0; transition.brokerRevision = 1; event.brokerRevision = 1; }, "duplicate_conflict"],
  ];
  for (const [name, mutate, code] of cases) {
    const value = structuredClone(evidence());
    mutate(value.transition, value.event);
    await assert.rejects(
      reconcileCommittedBossAuthorityTransition(store, value.transition, value.event, { now: () => RECONCILED }),
      (error: unknown) => error instanceof BossAuthorityReconciliationError && error.code === code,
      name,
    );
  }
  assert.equal((await store.read()).revision, 1);
});

test("replay rejects other transition IDs that collide on idempotency key or broker revision", async (context) => {
  const store = await fixture(context);
  const { transition, event } = evidence();
  const committed = await reconcileCommittedBossAuthorityTransition(store, transition, event, { now: () => RECONCILED });
  for (const field of ["idempotencyKey", "brokerRevision"] as const) {
    const colliding = structuredClone(committed.state);
    const duplicate = structuredClone(committed.projection);
    duplicate.authorityTransitionId = `authority-collision-${field}`;
    if (field === "idempotencyKey") duplicate.brokerRevision = 99;
    else duplicate.idempotencyKey = "authority-collision-key";
    colliding.authorityTransitions.push(duplicate);
    const collisionStore = {
      read: async () => structuredClone(colliding),
      transaction: async () => { throw new Error("replay must not transact"); },
    };
    await assert.rejects(
      reconcileCommittedBossAuthorityTransition(collisionStore, transition, event, { now: () => RECONCILED }),
      (error: unknown) => error instanceof BossAuthorityReconciliationError && error.code === "duplicate_conflict",
      field,
    );
  }
});

test("chronology fences against the maximum durable audit occurrence, not only the final sequence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "boss-authority-chronology-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const state = baseState();
  const first = state.audit[0];
  const late = auditEntry({
    auditEntryId: "audit-late-sequence-2",
    sequence: 2,
    previousEntryDigest: first.entryDigest,
    action: "store.updated",
    occurredAt: "2026-01-02T03:05:00.000Z",
  });
  const final = auditEntry({
    auditEntryId: "audit-early-sequence-3",
    sequence: 3,
    previousEntryDigest: late.entryDigest,
    action: "store.updated",
    occurredAt: "2026-01-02T03:04:06.000Z",
  });
  state.audit.push(late, final);
  const store = new BossStore(join(root, "controller.json"), { now: () => RECONCILED });
  await store.create(state);
  const { transition, event } = evidence();
  await assert.rejects(
    reconcileCommittedBossAuthorityTransition(store, transition, event, { now: () => RECONCILED }),
    (error: unknown) => error instanceof BossAuthorityReconciliationError && error.code === "chronology_mismatch",
  );
});

test("prepared/aborted records and invalid chronology are explicitly unavailable", async (context) => {
  const store = await fixture(context);
  const aborted = structuredClone(evidence());
  aborted.transition.state = "aborted";
  delete (aborted.transition as Partial<AuthorityTransitionRecord>).committedAt;
  aborted.transition.abortedAt = COMMITTED;
  aborted.transition.abortReason = "broker proved no commit";
  await assert.rejects(
    reconcileCommittedBossAuthorityTransition(store, aborted.transition, aborted.event, { now: () => RECONCILED }),
    (error: unknown) => error instanceof BossAuthorityReconciliationError && error.code === "unsupported_transition_state",
  );
  const committed = evidence();
  await assert.rejects(
    reconcileCommittedBossAuthorityTransition(store, committed.transition, committed.event, { now: () => PREPARED }),
    (error: unknown) => error instanceof BossAuthorityReconciliationError && error.code === "chronology_mismatch",
  );
  assert.equal((await store.read()).revision, 1);
});

test("unknown fields, accessors, proxies, and sparse data are rejected before Core parsing", async (context) => {
  const store = await fixture(context);
  const unknown = structuredClone(evidence());
  (unknown.event as unknown as Record<string, unknown>).socketPath = "/guessed/authority.sock";
  const accessor = structuredClone(evidence());
  Object.defineProperty(accessor.transition.target, "bossRunId", { enumerable: true, get: () => "boss-run-1" });
  const proxied = evidence();
  const sparse = structuredClone(evidence());
  const sparseValue = new Array(1);
  (sparse.event.target as unknown as Record<string, unknown>).bossRunId = sparseValue;
  const inheritedArray = structuredClone(evidence());
  const inheritedValue: unknown[] = [];
  Object.setPrototypeOf(inheritedValue, { attacker: true });
  (inheritedArray.event.target as unknown as Record<string, unknown>).bossRunId = inheritedValue;
  const nonIndex = structuredClone(evidence());
  const nonIndexValue: unknown[] = [];
  Object.defineProperty(nonIndexValue, "4294967295", { enumerable: true, value: true });
  (nonIndex.event.target as unknown as Record<string, unknown>).bossRunId = nonIndexValue;

  for (const value of [unknown, accessor, { ...proxied, event: new Proxy(proxied.event, {}) }, sparse, inheritedArray, nonIndex]) {
    await assert.rejects(
      reconcileCommittedBossAuthorityTransition(store, value.transition, value.event, { now: () => RECONCILED }),
      (error: unknown) => error instanceof BossAuthorityReconciliationError && error.code === "invalid_evidence",
    );
  }
  assert.equal((await store.read()).revision, 1);
});

test("audit ID callbacks receive detached evidence and cannot mutate the durable projection after its digest", async (context) => {
  const store = await fixture(context);
  const { transition, event } = evidence();
  const result = await reconcileCommittedBossAuthorityTransition(store, transition, event, {
    now: () => RECONCILED,
    auditEntryId: ({ transition: callbackTransition, event: callbackEvent, projection }) => {
      projection.targetId = "mutated-controller";
      callbackTransition.target.controllerPrincipalId = "mutated-controller";
      callbackEvent.target.controllerPrincipalId = "mutated-controller";
      return "audit-detached-callback";
    },
  });
  assert.equal(result.projection.targetId, "controller-1");
  assert.equal(result.state.audit.at(-1)?.auditEntryId, "audit-detached-callback");
});

test("a persist-then-throw ambiguity reconciles only the exact durable projection and audit", async (context) => {
  const store = await fixture(context);
  const { transition, event } = evidence();
  const ambiguousStore = {
    read: () => store.read(),
    transaction: async (expectedRevision: number, mutate: (draft: BossControllerStateV1) => void | Promise<void>) => {
      await store.transaction(expectedRevision, mutate);
      throw new Error("transport failed after commit");
    },
  };
  const result = await reconcileCommittedBossAuthorityTransition(ambiguousStore, transition, event, { now: () => RECONCILED });
  assert.equal(result.status, "already_reconciled");
  assert.equal(result.projection.authorityTransitionId, transition.authorityTransitionId);
  assert.equal(result.state.revision, 2);
  assert.equal(result.state.audit.at(-1)?.action, "authority.reconciled");
});

test("a stale BossStore CAS propagates conflict and never reports reconciliation", async (context) => {
  const store = await fixture(context);
  const { transition, event } = evidence();
  let raced = false;
  const racingStore = {
    read: () => store.read(),
    transaction: async (expectedRevision: number, mutate: (draft: BossControllerStateV1) => void | Promise<void>) => {
      if (!raced) {
        raced = true;
        await store.transaction(expectedRevision, (draft) => {
          const previous = draft.audit.at(-1)!;
          draft.audit.push(auditEntry({
            auditEntryId: "audit-racing-update",
            sequence: previous.sequence + 1,
            previousEntryDigest: previous.entryDigest,
            action: "store.updated",
            occurredAt: RECONCILED,
          }));
        });
      }
      return store.transaction(expectedRevision, mutate);
    },
  };
  await assert.rejects(
    reconcileCommittedBossAuthorityTransition(racingStore, transition, event, { now: () => RECONCILED }),
    BossStoreConflictError,
  );
  const durable = await store.read();
  assert.equal(durable.revision, 2);
  assert.equal(durable.authorityTransitions.length, 1);
});
