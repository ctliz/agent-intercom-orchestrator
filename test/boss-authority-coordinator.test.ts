import assert from "node:assert/strict";
import { hasFlock } from "./utils.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AUTHORITY_EVENT_VERSION,
  AUTHORITY_REQUEST_VERSION,
  AUTHORITY_TRANSITION_VERSION,
  BOSS_CAPABILITY_FEATURE_DIGEST,
  BOSS_CONTROL_ENVELOPE_VERSION,
  BOSS_RUN_FEATURE,
  BOSS_RUN_FEATURE_SEMANTICS_HASH,
  BOSS_RUN_FEATURE_VERSION,
  BOSS_RUN_PROTOCOL_FEATURE_CONTRACT_HASH,
  BROKER_FEATURE_ATTESTATION_VERSION,
  BROKER_IDENTITY_RECORD_VERSION,
  BROKER_PEER_EXPECTATION_VERSION,
  BROKER_PROVIDER_ATTESTATION_VERSION,
  brokerFeatureSetHash,
  brokerIdentitySigningBytes,
  brokerProviderAttestationSigningBytes,
  type AuthorityTransitionEvent,
  type AuthorityTransitionRecord,
  type AuthorityTransitionRequest,
  type BrokerIdentityRecord,
} from "@ctliz/agent-intercom-core/boss";
import {
  BossAuthorityQueryError,
  createBossAuthorityQueryClient,
  type BossAuthorityQueryClient,
  type BossAuthorityQueryTrust,
} from "../src/boss-authority-client.ts";
import {
  BossAuthorityCoordinatorError,
  createBossAuthorityCoordinator,
  type BossAuthorityCoordinatorDependencies,
  type BossCommittedAuthorityEventSelector,
} from "../src/boss-authority-coordinator.ts";
import { BossAuthorityReconciliationError } from "../src/boss-authority-reconciler.ts";
import { BossStore } from "../src/boss-store.ts";
import {
  BOSS_AUDIT_ENTRY_VERSION,
  BOSS_AUTHORITY_PROJECTION_VERSION,
  BOSS_CONTROLLER_STORE_VERSION,
  BOSS_GOAL_REVISION_VERSION,
  BOSS_PARTICIPANT_VERSION,
  BOSS_REQUIRED_FEATURE,
  BOSS_RUN_VERSION,
  computeBossAuditEntryDigest,
  type BossAuditEntryV1,
  type BossAuthorityTransitionProjectionV1,
  type BossControllerStateV1,
} from "../src/boss-types.ts";

const OWNER_UID = 1000;
const BROKER_UID = 995;
const CONTROLLER_UID = 994;
const BROKER_PID = 4321;
const BROKER_GENERATION = 4;
const CREATED = "2026-01-02T03:04:05.000Z";
const PREPARED = "2026-01-02T03:04:06.000Z";
const COMMITTED = "2026-01-02T03:04:07.000Z";
const DIGEST = "a".repeat(64);

type AuthorityFixture = {
  request: AuthorityTransitionRequest;
  transition: AuthorityTransitionRecord;
  event: AuthorityTransitionEvent;
  identity: BrokerIdentityRecord;
  observedPeer: Record<string, unknown>;
  trust: BossAuthorityQueryTrust;
};

function authorityFixture(): AuthorityFixture {
  const identityKeys = generateKeyPairSync("ed25519");
  const providerKeys = generateKeyPairSync("ed25519");
  const providerAttestation = {
    version: BROKER_PROVIDER_ATTESTATION_VERSION,
    providerPackage: "@ctliz/agent-intercom-pi",
    providerVersion: "1.0.0",
    providerDigest: DIGEST,
    artifactPath: "/usr/lib/agent-intercom/providers/agent-intercom-pi/provider.mjs",
    artifactOwnerUid: 0,
    artifactOwnerGid: 0,
    artifactMode: "0555",
    userWritable: false as const,
    attestedAt: CREATED,
    attestationKeyId: "provider-key-1",
    signature: "",
  };
  providerAttestation.signature = sign(
    null,
    brokerProviderAttestationSigningBytes(providerAttestation),
    providerKeys.privateKey,
  ).toString("base64");
  const features = [{
    version: BROKER_FEATURE_ATTESTATION_VERSION,
    feature: BOSS_RUN_FEATURE,
    featureVersion: BOSS_RUN_FEATURE_VERSION,
    semanticsHash: BOSS_RUN_FEATURE_SEMANTICS_HASH,
    controlEnvelopeVersion: BOSS_CONTROL_ENVELOPE_VERSION,
    capabilityDigest: BOSS_CAPABILITY_FEATURE_DIGEST,
  }];
  const identity = {
    version: BROKER_IDENTITY_RECORD_VERSION,
    owningProviderPackage: providerAttestation.providerPackage,
    providerDigest: providerAttestation.providerDigest,
    providerVersion: providerAttestation.providerVersion,
    baseProtocolVersion: 4,
    features,
    protocolFeatureContractHash: BOSS_RUN_PROTOCOL_FEATURE_CONTRACT_HASH,
    featureSetHash: brokerFeatureSetHash(features),
    controlEnvelopeVersion: BOSS_CONTROL_ENVELOPE_VERSION,
    capabilityDigest: BOSS_CAPABILITY_FEATURE_DIGEST,
    protectedServiceUid: BROKER_UID,
    ownerUid: OWNER_UID,
    bootInstance: "broker-boot-coordinator-1",
    processId: BROKER_PID,
    brokerGeneration: BROKER_GENERATION,
    publicEndpoint: `/run/agent-intercom/${OWNER_UID}/public.sock`,
    authorityEndpoint: `/run/agent-intercom/${OWNER_UID}/authority.sock`,
    identityKeyId: "identity-key-1",
    signature: "",
  };
  identity.signature = sign(null, brokerIdentitySigningBytes(identity), identityKeys.privateKey).toString("base64");
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
    prepareToken: "protected-prepare-token-2",
    preparedAt: PREPARED,
    committedAt: COMMITTED,
  } as unknown as AuthorityTransitionRecord;
  const request = {
    version: AUTHORITY_REQUEST_VERSION,
    operation: "query",
    requestId: "authority-query-request-1",
    idempotencyKey: "authority-query-key-1",
    authorityTransitionId: transition.authorityTransitionId,
    expectedBrokerRevision: 99,
    payload: {},
  } as unknown as AuthorityTransitionRequest;
  const event = {
    version: AUTHORITY_EVENT_VERSION,
    eventId: "authority-event-controller-2",
    bossRunId: "boss-run-1",
    authorityTransitionId: transition.authorityTransitionId,
    brokerRevision: transition.brokerRevision,
    operation: transition.operation,
    state: "committed",
    target: structuredClone(transition.target),
    prior: structuredClone(transition.prior),
    resulting: structuredClone(transition.proposed),
    occurredAt: COMMITTED,
  } as unknown as AuthorityTransitionEvent;
  const observedPeer = {
    kernelPeerCredentialsPresent: true,
    endpointClass: "authority",
    brokerServiceUid: BROKER_UID,
    brokerProcessId: BROKER_PID,
    clientUid: CONTROLLER_UID,
    serviceCapabilityPresented: true,
  };
  const trust = {
    identityVerification: {
      expectedProviderPackage: providerAttestation.providerPackage,
      expectedProviderVersion: providerAttestation.providerVersion,
      expectedProviderDigest: providerAttestation.providerDigest,
      expectedProviderArtifactRoot: "/usr/lib/agent-intercom/providers/",
      expectedProviderArtifactOwnerUid: 0,
      expectedProviderArtifactOwnerGid: 0,
      expectedProviderArtifactMode: "0555",
      expectedOwnerUid: OWNER_UID,
      expectedBrokerServiceUid: BROKER_UID,
      expectedBootInstance: identity.bootInstance,
      minimumBrokerGeneration: BROKER_GENERATION,
      expectedPublicEndpoint: identity.publicEndpoint,
      expectedAuthorityEndpoint: identity.authorityEndpoint,
      trustedIdentityKeys: {
        "identity-key-1": identityKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      },
      trustedProviderKeys: {
        "provider-key-1": providerKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      },
      providerAttestation,
    },
    authorityPeerExpectation: {
      version: BROKER_PEER_EXPECTATION_VERSION,
      endpointClass: "authority",
      ownerUid: OWNER_UID,
      expectedBrokerServiceUid: BROKER_UID,
      expectedBrokerProcessId: BROKER_PID,
      expectedClientUid: CONTROLLER_UID,
      expectedControllerUid: CONTROLLER_UID,
      requiresKernelPeerCredentials: true,
      requiresServiceCapability: true,
    },
    expectedBrokerGeneration: BROKER_GENERATION,
  } as unknown as BossAuthorityQueryTrust;
  return { request, transition, event, identity: identity as BrokerIdentityRecord, observedPeer, trust };
}

function queryClient(
  values: AuthorityFixture,
  transport: (request: AuthorityTransitionRequest) => unknown = () => ({
    brokerIdentity: values.identity,
    responseData: values.transition,
    kernelObservedPeer: values.observedPeer,
  }),
): BossAuthorityQueryClient {
  return createBossAuthorityQueryClient({ queryProtectedAuthority: transport }, values.trust);
}

function auditEntry(): BossAuditEntryV1 {
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
      objective: "Test the authority coordinator",
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
    assignments: [],
    approvals: [],
    proofManifests: [],
    evidenceRefs: [],
    outbox: [],
    watchdogs: [],
    authorityTransitions: [initialTakeover()],
    audit: [auditEntry()],
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

async function storeFixture(context: test.TestContext): Promise<BossStore> {
  const root = await mkdtemp(join(tmpdir(), "boss-authority-coordinator-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = new BossStore(join(root, "controller.json"));
  await store.create(baseState());
  return store;
}

function dependencies(
  client: BossAuthorityQueryClient,
  store: BossStore,
  readCommittedAuthorityEvent: BossAuthorityCoordinatorDependencies["readCommittedAuthorityEvent"],
): BossAuthorityCoordinatorDependencies {
  return { queryClient: client, readCommittedAuthorityEvent, store };
}

async function rejectsCode(
  promise: Promise<unknown>,
  code: BossAuthorityCoordinatorError["code"],
  sourceCode?: string,
): Promise<BossAuthorityCoordinatorError> {
  let observed: BossAuthorityCoordinatorError | undefined;
  await assert.rejects(promise, (error: unknown) => {
    if (error instanceof BossAuthorityCoordinatorError
      && error.code === code
      && (sourceCode === undefined || error.sourceCode === sourceCode)) {
      observed = error;
      return true;
    }
    return false;
  });
  return observed!;
}

test("uses signed peer-verified query evidence and durably reconciles exact replay", { skip: !hasFlock() }, async (context) => {
  const values = authorityFixture();
  const store = await storeFixture(context);
  let queryCalls = 0;
  let eventCalls = 0;
  let selected: BossCommittedAuthorityEventSelector | undefined;
  const client = queryClient(values, function (this: unknown, request) {
    queryCalls += 1;
    assert.equal(this, undefined);
    assert.equal(Object.isFrozen(request), true);
    return {
      brokerIdentity: values.identity,
      responseData: values.transition,
      kernelObservedPeer: values.observedPeer,
    };
  });
  const coordinator = createBossAuthorityCoordinator(dependencies(client, store, function (this: unknown, selector) {
    eventCalls += 1;
    assert.equal(this, undefined);
    selected = selector;
    assert.equal(Object.isFrozen(selector), true);
    return values.event;
  }));

  assert.equal(queryCalls, 0);
  assert.equal(eventCalls, 0);
  const result = await coordinator.reconcile(values.request);
  assert.equal(result.status, "reconciled");
  assert.equal(result.state.revision, 2);
  assert.equal(result.state.controllerGeneration, 2);
  assert.equal(result.state.audit.length, 2);
  assert.equal(result.state.audit[1]?.action, "authority.reconciled");
  assert.deepEqual(selected, {
    authorityTransitionId: values.transition.authorityTransitionId,
    brokerRevision: 2,
    operation: "controller_takeover",
    bossRunId: "boss-run-1",
  });
  assert.deepEqual(await store.read(), result.state);

  const replay = await coordinator.reconcile(values.request);
  assert.equal(replay.status, "already_reconciled");
  assert.equal(replay.state.revision, 2);
  assert.equal(replay.state.audit.length, 2);
  assert.equal(queryCalls, 2);
  assert.equal(eventCalls, 2);
});

test("rejects forged clients, non-concrete stores, hostile dependency records, and reconcile hooks", { skip: !hasFlock() }, async (context) => {
  const values = authorityFixture();
  const store = await storeFixture(context);
  const client = queryClient(values);
  const valid = dependencies(client, store, () => values.event);
  let accessorInvoked = false;
  let forgedQueryCalls = 0;
  let reconcileSentinelCalls = 0;
  const accessor = { ...valid } as Record<string, unknown>;
  Object.defineProperty(accessor, "queryClient", {
    enumerable: true,
    get() { accessorInvoked = true; return client; },
  });
  const symbol = { ...valid } as Record<PropertyKey, unknown>;
  symbol[Symbol("hidden")] = true;
  class SubclassStore extends BossStore {}
  const subclassStore = new SubclassStore(join(tmpdir(), "boss-subclass-store.json"));
  const forgedStore = Object.create(BossStore.prototype);
  Object.defineProperties(forgedStore, Object.getOwnPropertyDescriptors(store));
  const forgedClient = {
    async query() {
      forgedQueryCalls += 1;
      return {
        requestId: values.request.requestId,
        authorityTransitionId: values.transition.authorityTransitionId,
        brokerRevision: values.transition.brokerRevision,
        brokerIdentity: values.identity,
        transition: values.transition,
      };
    },
  };
  const candidates: unknown[] = [
    new Proxy(valid, {}),
    accessor,
    Object.create(valid),
    { ...valid, extra: true },
    symbol,
    { ...valid, readCommittedAuthorityEvent: new Proxy(valid.readCommittedAuthorityEvent, {}) },
    { ...valid, queryClient: forgedClient },
    { ...valid, queryClient: new Proxy(client, {}) },
    { ...valid, store: Object.create(BossStore.prototype) },
    { ...valid, store: forgedStore },
    { ...valid, store: subclassStore },
    { ...valid, store: new Proxy(store, {}) },
    {
      ...valid,
      reconcileCommittedAuthorityTransition: async () => {
        reconcileSentinelCalls += 1;
        return { status: "arbitrary-reconcile-sentinel" };
      },
    },
  ];

  for (const candidate of candidates) {
    assert.throws(
      () => createBossAuthorityCoordinator(candidate as BossAuthorityCoordinatorDependencies),
      (error: unknown) => error instanceof BossAuthorityCoordinatorError && error.code === "invalid_configuration",
    );
  }
  assert.equal(accessorInvoked, false);
  assert.equal(forgedQueryCalls, 0);
  assert.equal(reconcileSentinelCalls, 0);
  assert.equal((await store.read()).revision, 1);
});

test("rejects non-query and hostile query inputs before signed transport or event access", { skip: !hasFlock() }, async (context) => {
  const values = authorityFixture();
  const store = await storeFixture(context);
  let transportCalls = 0;
  let eventCalls = 0;
  const client = queryClient(values, () => {
    transportCalls += 1;
    throw new Error("must not run");
  });
  const coordinator = createBossAuthorityCoordinator(dependencies(client, store, () => {
    eventCalls += 1;
    return values.event;
  }));

  await rejectsCode(
    coordinator.reconcile({ ...values.request, operation: "prepare" } as AuthorityTransitionRequest),
    "invalid_request",
  );
  const accessor = structuredClone(values.request) as Record<string, unknown>;
  let accessorInvoked = false;
  Object.defineProperty(accessor, "payload", {
    enumerable: true,
    get() { accessorInvoked = true; return {}; },
  });
  await rejectsCode(coordinator.reconcile(accessor as AuthorityTransitionRequest), "invalid_request");
  const prototypeKey = structuredClone(values.request);
  Object.defineProperty(prototypeKey, "__proto__", { enumerable: true, value: "hostile" });
  await rejectsCode(coordinator.reconcile(prototypeKey), "invalid_request");

  assert.equal(accessorInvoked, false);
  assert.equal(transportCalls, 0);
  assert.equal(eventCalls, 0);
  assert.equal((await store.read()).revision, 1);
});

test("rejects unavailable and hostile events without any durable mutation", { skip: !hasFlock() }, async (context) => {
  const values = authorityFixture();
  const store = await storeFixture(context);
  const client = queryClient(values);
  const malformed = { ...structuredClone(values.event), extra: true };
  const substituted = { ...structuredClone(values.event), authorityTransitionId: "authority-substitute" };
  const prototypeKey = structuredClone(values.event);
  Object.defineProperty(prototypeKey, "__proto__", { enumerable: true, value: "hostile" });
  let accessorInvoked = false;
  const accessor = structuredClone(values.event) as unknown as Record<string, unknown>;
  Object.defineProperty(accessor, "target", {
    enumerable: true,
    get() { accessorInvoked = true; return values.event.target; },
  });
  const cases: Array<[unknown, BossAuthorityCoordinatorError["code"]]> = [
    [undefined, "event_unavailable"],
    [malformed, "invalid_event"],
    [substituted, "event_mismatch"],
    [prototypeKey, "invalid_event"],
    [accessor, "invalid_event"],
  ];

  for (const [eventValue, code] of cases) {
    const coordinator = createBossAuthorityCoordinator(dependencies(client, store, () => eventValue));
    await rejectsCode(coordinator.reconcile(values.request), code);
    const durable = await store.read();
    assert.equal(durable.revision, 1);
    assert.equal(durable.audit.length, 1);
    assert.equal(durable.authorityTransitions.length, 1);
  }
  assert.equal(accessorInvoked, false);
});

test("detaches accepted event evidence before callback-owned TOCTOU mutation", { skip: !hasFlock() }, async (context) => {
  const values = authorityFixture();
  const store = await storeFixture(context);
  const rawEvent = structuredClone(values.event);
  const coordinator = createBossAuthorityCoordinator(dependencies(queryClient(values), store, () => {
    setTimeout(() => {
      (rawEvent as unknown as { brokerRevision: number }).brokerRevision = 500;
    }, 0);
    return rawEvent;
  }));

  const result = await coordinator.reconcile(values.request);
  assert.equal(result.status, "reconciled");
  assert.equal(result.projection.brokerRevision, 2);
  assert.equal((await store.read()).authorityTransitions[1]?.brokerRevision, 2);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(rawEvent.brokerRevision, 500);
});

test("preserves accepted typed query and reconciliation source codes", { skip: !hasFlock() }, async (context) => {
  const queryValues = authorityFixture();
  queryValues.observedPeer.clientUid = OWNER_UID;
  const queryStore = new BossStore(join(tmpdir(), "boss-query-error-store.json"));
  const queryCoordinator = createBossAuthorityCoordinator(dependencies(
    queryClient(queryValues),
    queryStore,
    () => queryValues.event,
  ));
  const queryFailure = await rejectsCode(
    queryCoordinator.reconcile(queryValues.request),
    "query_failed",
    "authority_peer_mismatch",
  );
  assert.ok(queryFailure.cause instanceof BossAuthorityQueryError);

  const reconcileValues = authorityFixture();
  (reconcileValues.transition.prior as unknown as { controllerGeneration: number }).controllerGeneration = 2;
  (reconcileValues.transition.proposed as unknown as { controllerGeneration: number }).controllerGeneration = 3;
  reconcileValues.event.prior = structuredClone(reconcileValues.transition.prior);
  reconcileValues.event.resulting = structuredClone(reconcileValues.transition.proposed);
  const store = await storeFixture(context);
  const reconcileCoordinator = createBossAuthorityCoordinator(dependencies(
    queryClient(reconcileValues),
    store,
    () => reconcileValues.event,
  ));
  const reconciliationFailure = await rejectsCode(
    reconcileCoordinator.reconcile(reconcileValues.request),
    "reconciliation_failed",
    "generation_mismatch",
  );
  assert.ok(reconciliationFailure.cause instanceof BossAuthorityReconciliationError);
  assert.equal((await store.read()).revision, 1);
});

test("remains absent from production extension wiring and exposes no mutation protocol", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /boss-authority-coordinator/);
  const module = await import("../src/boss-authority-coordinator.ts");
  assert.equal("prepare" in module, false);
  assert.equal("commit" in module, false);
  assert.equal("abort" in module, false);
});
