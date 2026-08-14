import assert from "node:assert/strict";
import { generateKeyPairSync, KeyObject, sign } from "node:crypto";
import test from "node:test";
import {
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
  type AuthorityTransitionRecord,
  type AuthorityTransitionRequest,
  type BrokerIdentityRecord,
} from "@ctliz/agent-intercom-core/boss";
import { canonicalJson } from "@ctliz/agent-intercom-core/canonical";
import {
  BossAuthorityQueryError,
  createBossAuthorityQueryClient,
  isBossAuthorityQueryClient,
  type BossAuthorityQueryErrorCode,
  type BossAuthorityQueryTrust,
} from "../src/boss-authority-client.ts";

const OWNER_UID = 1000;
const BROKER_UID = 995;
const CONTROLLER_UID = 994;
const BROKER_PID = 4321;
const BROKER_GENERATION = 4;
const TRANSITION_ID = "authority-transition-query-1";
const DIGEST = "a".repeat(64);
const NOW = "2026-07-29T12:00:00.000Z";

type Fixture = {
  identity: BrokerIdentityRecord;
  identityPrivateKey: KeyObject;
  providerPrivateKey: KeyObject;
  request: AuthorityTransitionRequest;
  transition: AuthorityTransitionRecord;
  observedPeer: Record<string, unknown>;
  trust: BossAuthorityQueryTrust;
};

function fixture(): Fixture {
  const identityKeys = generateKeyPairSync("ed25519");
  const providerKeys = generateKeyPairSync("ed25519");
  const identityPublicKey = identityKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const providerPublicKey = providerKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
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
    attestedAt: NOW,
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
    bootInstance: "broker-boot-query-1",
    processId: BROKER_PID,
    brokerGeneration: BROKER_GENERATION,
    publicEndpoint: `/run/agent-intercom/${OWNER_UID}/public.sock`,
    authorityEndpoint: `/run/agent-intercom/${OWNER_UID}/authority.sock`,
    identityKeyId: "identity-key-1",
    signature: "",
  };
  identity.signature = sign(null, brokerIdentitySigningBytes(identity), identityKeys.privateKey).toString("base64");
  const request = {
    version: AUTHORITY_REQUEST_VERSION,
    operation: "query",
    requestId: "authority-query-request-1",
    idempotencyKey: "authority-query-idempotency-1",
    authorityTransitionId: TRANSITION_ID,
    // Query correlation does not invent equality with the record's prepare revision.
    expectedBrokerRevision: 99,
    payload: {},
  } as unknown as AuthorityTransitionRequest;
  const transition = {
    version: AUTHORITY_TRANSITION_VERSION,
    authorityTransitionId: TRANSITION_ID,
    expectedBrokerRevision: 6,
    brokerRevision: 7,
    operation: "controller_takeover",
    target: { bossRunId: "boss-run-query-1", controllerPrincipalId: "controller-query-1" },
    prior: { controllerGeneration: 1 },
    proposed: { controllerGeneration: 2 },
    idempotencyKey: "authority-prepare-idempotency-1",
    state: "committed",
    prepareToken: "authority-prepare-token-1",
    preparedAt: NOW,
    committedAt: "2026-07-29T12:00:01.000Z",
  } as unknown as AuthorityTransitionRecord;
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
      trustedIdentityKeys: { "identity-key-1": identityPublicKey },
      trustedProviderKeys: { "provider-key-1": providerPublicKey },
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
  return {
    identity: identity as BrokerIdentityRecord,
    identityPrivateKey: identityKeys.privateKey,
    providerPrivateKey: providerKeys.privateKey,
    request,
    transition,
    observedPeer,
    trust,
  };
}

function transportResult(values: Fixture, responseData: unknown = values.transition): Record<string, unknown> {
  return {
    brokerIdentity: values.identity,
    responseData,
    kernelObservedPeer: values.observedPeer,
  };
}

function resignIdentity(identity: BrokerIdentityRecord, privateKey: KeyObject): void {
  identity.signature = sign(null, brokerIdentitySigningBytes(identity), privateKey).toString("base64");
}

async function rejectsCode(value: Promise<unknown>, code: BossAuthorityQueryErrorCode): Promise<void> {
  await assert.rejects(
    value,
    (error: unknown) => error instanceof BossAuthorityQueryError && error.code === code,
  );
}

test("is dormant and query-only, detaches the request, and returns exact correlated Core evidence", async () => {
  const values = fixture();
  let calls = 0;
  let received: AuthorityTransitionRequest | undefined;
  let observedThis: unknown = "not-called";
  const client = createBossAuthorityQueryClient({
    queryProtectedAuthority(this: unknown, request) {
      calls += 1;
      observedThis = this;
      received = request;
      assert.equal(Object.isFrozen(request), true);
      assert.equal(Object.isFrozen(request.payload), true);
      return transportResult(values);
    },
  }, values.trust);

  assert.equal(calls, 0);
  assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(client)).sort(), ["constructor", "query"]);
  assert.equal("prepare" in client, false);
  assert.equal("commit" in client, false);
  assert.equal("abort" in client, false);

  const result = await client.query(values.request);
  assert.equal(calls, 1);
  assert.equal(observedThis, undefined);
  assert.notEqual(received, values.request);
  assert.notEqual(received!.payload, values.request.payload);
  assert.equal(result.requestId, values.request.requestId);
  assert.equal(result.authorityTransitionId, TRANSITION_ID);
  assert.equal(result.brokerRevision, values.transition.brokerRevision);
  assert.deepEqual(result.transition, values.transition);
  assert.notEqual(result.transition, values.transition);
  assert.notEqual(result.brokerIdentity, values.identity);
});

test("recognizes only module-created query clients without a forgeable public brand", () => {
  const values = fixture();
  const client = createBossAuthorityQueryClient({
    queryProtectedAuthority: () => transportResult(values),
  }, values.trust);

  assert.equal(isBossAuthorityQueryClient(client), true);
  assert.equal(isBossAuthorityQueryClient({ query: client.query }), false);
  assert.equal(isBossAuthorityQueryClient(Object.create(Object.getPrototypeOf(client))), false);
  assert.equal(isBossAuthorityQueryClient(new Proxy(client, {})), false);
  assert.deepEqual(Reflect.ownKeys(client), []);
  assert.equal(Object.isFrozen(client), true);
  assert.equal(Object.isFrozen(Object.getPrototypeOf(client)), true);
});

test("accepts exact object, JSON text, and Uint8Array response data without retries", async () => {
  const values = fixture();
  const encodings: unknown[] = [
    values.transition,
    canonicalJson(values.transition),
    new TextEncoder().encode(canonicalJson(values.transition)),
  ];
  let calls = 0;
  const client = createBossAuthorityQueryClient({
    queryProtectedAuthority() {
      const responseData = encodings[calls++]!;
      return transportResult(values, responseData);
    },
  }, values.trust);
  for (let index = 0; index < encodings.length; index += 1) {
    assert.equal((await client.query(values.request)).brokerRevision, 7);
  }
  assert.equal(calls, 3);
});

test("snapshots response graphs before returning them", async () => {
  const values = fixture();
  const raw = transportResult(values);
  const client = createBossAuthorityQueryClient({ queryProtectedAuthority: () => raw }, values.trust);
  const result = await client.query(values.request);

  (values.transition as unknown as { brokerRevision: number }).brokerRevision = 123;
  values.identity.bootInstance = "mutated-after-response";
  (values.observedPeer as { clientUid: number }).clientUid = 0;
  assert.equal(result.transition.brokerRevision, 7);
  assert.equal(result.brokerIdentity.bootInstance, "broker-boot-query-1");
});

test("rejects non-query and hostile own-data request boundaries before transport", async () => {
  const cases: unknown[] = [];
  const prepared = structuredClone(fixture().request) as Record<string, unknown>;
  prepared.operation = "prepare";
  prepared.payload = { requestedOperation: "controller_takeover", target: { controllerPrincipalId: "x" }, prior: { controllerGeneration: 1 } };
  cases.push(prepared);

  const accessor = structuredClone(fixture().request) as Record<string, unknown>;
  Object.defineProperty(accessor, "requestId", { enumerable: true, get: () => "accessor" });
  cases.push(accessor);
  cases.push(Object.assign(Object.create({ inherited: true }), fixture().request));
  cases.push(new Proxy(fixture().request, {}));
  const symbol = structuredClone(fixture().request) as Record<PropertyKey, unknown>;
  symbol[Symbol("hostile")] = true;
  cases.push(symbol);
  const cycle = structuredClone(fixture().request) as Record<string, unknown>;
  (cycle.payload as Record<string, unknown>).cycle = cycle;
  cases.push(cycle);

  for (const value of cases) {
    let calls = 0;
    const values = fixture();
    const client = createBossAuthorityQueryClient({
      queryProtectedAuthority() {
        calls += 1;
        return transportResult(values);
      },
    }, values.trust);
    await rejectsCode(client.query(value as AuthorityTransitionRequest), "invalid_request");
    assert.equal(calls, 0);
  }
});

test("rejects hostile configuration, dependency, custom-array, and callback alias boundaries", async () => {
  const values = fixture();
  assert.throws(
    () => createBossAuthorityQueryClient(Object.create({ queryProtectedAuthority() {} }), values.trust),
    (error: unknown) => error instanceof BossAuthorityQueryError && error.code === "invalid_configuration",
  );
  const accessorDependency = {};
  Object.defineProperty(accessorDependency, "queryProtectedAuthority", { enumerable: true, get: () => () => undefined });
  assert.throws(
    () => createBossAuthorityQueryClient(accessorDependency as never, values.trust),
    (error: unknown) => error instanceof BossAuthorityQueryError && error.code === "invalid_configuration",
  );
  const cyclicTrust = structuredClone(values.trust) as BossAuthorityQueryTrust & { cycle?: unknown };
  cyclicTrust.cycle = cyclicTrust;
  assert.throws(
    () => createBossAuthorityQueryClient({ queryProtectedAuthority() {} }, cyclicTrust),
    (error: unknown) => error instanceof BossAuthorityQueryError && error.code === "invalid_configuration",
  );

  let transportRequest: AuthorityTransitionRequest | undefined;
  const aliasClient = createBossAuthorityQueryClient({
    queryProtectedAuthority(request) {
      transportRequest = request;
      return {
        brokerIdentity: values.identity,
        responseData: request,
        kernelObservedPeer: values.observedPeer,
      };
    },
  }, values.trust);
  await rejectsCode(aliasClient.query(values.request), "invalid_transport_result");
  assert.ok(transportRequest);

  class CustomFeatures extends Array<unknown> {}
  const customIdentity = structuredClone(values.identity) as unknown as BrokerIdentityRecord;
  customIdentity.features = new CustomFeatures(...customIdentity.features) as never;
  const customClient = createBossAuthorityQueryClient({
    queryProtectedAuthority: () => ({
      brokerIdentity: customIdentity,
      responseData: values.transition,
      kernelObservedPeer: values.observedPeer,
    }),
  }, values.trust);
  await rejectsCode(customClient.query(values.request), "invalid_transport_result");
});

test("rejects signed coordinated broker and peer substitution against independent caller pins", async () => {
  const values = fixture();
  const substitutedIdentity = structuredClone(values.identity) as BrokerIdentityRecord;
  substitutedIdentity.protectedServiceUid = 991;
  substitutedIdentity.processId = 9001;
  resignIdentity(substitutedIdentity, values.identityPrivateKey);
  const substitutedPeer = { ...values.observedPeer, brokerServiceUid: 991, brokerProcessId: 9001 };
  const client = createBossAuthorityQueryClient({
    queryProtectedAuthority: () => ({
      brokerIdentity: substitutedIdentity,
      responseData: values.transition,
      kernelObservedPeer: substitutedPeer,
    }),
  }, values.trust);
  await rejectsCode(client.query(values.request), "broker_identity_mismatch");
});

test("returns deterministic provider, boot, generation, peer, and transition mismatch codes", async () => {
  {
    const values = fixture();
    values.identity.owningProviderPackage = "@hostile/substitute-provider";
    resignIdentity(values.identity, values.identityPrivateKey);
    const client = createBossAuthorityQueryClient({ queryProtectedAuthority: () => transportResult(values) }, values.trust);
    await rejectsCode(client.query(values.request), "broker_provider_mismatch");
  }
  {
    const values = fixture();
    values.identity.bootInstance = "different-signed-boot";
    resignIdentity(values.identity, values.identityPrivateKey);
    const client = createBossAuthorityQueryClient({ queryProtectedAuthority: () => transportResult(values) }, values.trust);
    await rejectsCode(client.query(values.request), "broker_boot_mismatch");
  }
  {
    const values = fixture();
    (values.identity as unknown as { brokerGeneration: number }).brokerGeneration += 1;
    resignIdentity(values.identity, values.identityPrivateKey);
    const client = createBossAuthorityQueryClient({ queryProtectedAuthority: () => transportResult(values) }, values.trust);
    await rejectsCode(client.query(values.request), "broker_generation_mismatch");
  }
  for (const patch of [
    { clientUid: OWNER_UID },
    { serviceCapabilityPresented: false },
    { brokerProcessId: BROKER_PID + 1 },
    { endpointClass: "public" },
  ]) {
    const values = fixture();
    Object.assign(values.observedPeer, patch);
    const client = createBossAuthorityQueryClient({ queryProtectedAuthority: () => transportResult(values) }, values.trust);
    await rejectsCode(client.query(values.request), "authority_peer_mismatch");
  }
  {
    const values = fixture();
    values.transition.authorityTransitionId = "coordinated-wrong-transition";
    const client = createBossAuthorityQueryClient({ queryProtectedAuthority: () => transportResult(values) }, values.trust);
    await rejectsCode(client.query(values.request), "transition_mismatch");
  }
  {
    const values = fixture();
    (values.transition as unknown as { brokerRevision: number }).brokerRevision = values.request.expectedBrokerRevision + 1;
    const client = createBossAuthorityQueryClient({ queryProtectedAuthority: () => transportResult(values) }, values.trust);
    await rejectsCode(client.query(values.request), "transition_mismatch");
  }
});

test("maps thrown and empty transports to unavailable, never retries, and permits one in-flight query", async () => {
  const thrown = fixture();
  let thrownCalls = 0;
  const thrownClient = createBossAuthorityQueryClient({
    queryProtectedAuthority() {
      thrownCalls += 1;
      throw new Error("offline");
    },
  }, thrown.trust);
  await rejectsCode(thrownClient.query(thrown.request), "transport_unavailable");
  assert.equal(thrownCalls, 1);

  const empty = fixture();
  const emptyClient = createBossAuthorityQueryClient({ queryProtectedAuthority: () => undefined }, empty.trust);
  await rejectsCode(emptyClient.query(empty.request), "transport_unavailable");

  const concurrent = fixture();
  let release!: (value: unknown) => void;
  let calls = 0;
  const pending = new Promise<unknown>((resolve) => { release = resolve; });
  const client = createBossAuthorityQueryClient({
    queryProtectedAuthority() {
      calls += 1;
      return pending;
    },
  }, concurrent.trust);
  const first = client.query(concurrent.request);
  await rejectsCode(client.query(concurrent.request), "query_in_flight");
  assert.equal(calls, 1);
  release(transportResult(concurrent));
  assert.equal((await first).brokerRevision, 7);
});

test("normalizes deep and fake-KeyObject configuration traps without invoking accessors", () => {
  const fakeKey = Object.create(KeyObject.prototype);
  Object.defineProperty(fakeKey, "type", { enumerable: true, get: () => { throw new Error("descriptor-trap"); } });
  const fakeValues = fixture();
  fakeValues.trust.identityVerification.trustedIdentityKeys = { "broker-identity-key-1": fakeKey };
  assert.throws(
    () => createBossAuthorityQueryClient({ queryProtectedAuthority: () => undefined }, fakeValues.trust),
    (error: unknown) => error instanceof BossAuthorityQueryError && error.code === "invalid_configuration",
  );

  let deep: Record<string, unknown> = {};
  for (let index = 0; index < 20_000; index += 1) deep = { next: deep };
  const deepValues = fixture();
  deepValues.trust.identityVerification.providerAttestation = deep;
  assert.throws(
    () => createBossAuthorityQueryClient({ queryProtectedAuthority: () => undefined }, deepValues.trust),
    (error: unknown) => error instanceof BossAuthorityQueryError && error.code === "invalid_configuration",
  );
});

test("rejects own __proto__ data fields across requests, trust, objects, canonical JSON, and bytes", async () => {
  const requestValues = fixture();
  Object.defineProperty(requestValues.request, "__proto__", { enumerable: true, value: "hostile" });
  const requestClient = createBossAuthorityQueryClient({ queryProtectedAuthority: () => { throw new Error("must not run"); } }, requestValues.trust);
  await rejectsCode(requestClient.query(requestValues.request), "invalid_request");

  const trustValues = fixture();
  Object.defineProperty(trustValues.trust, "__proto__", { enumerable: true, value: "hostile" });
  assert.throws(
    () => createBossAuthorityQueryClient({ queryProtectedAuthority: () => undefined }, trustValues.trust),
    (error: unknown) => error instanceof BossAuthorityQueryError && error.code === "invalid_configuration",
  );

  const responseValues = fixture();
  Object.defineProperty(responseValues.transition, "__proto__", { enumerable: true, value: "hostile" });
  for (const responseData of [
    responseValues.transition,
    canonicalJson(responseValues.transition),
    new TextEncoder().encode(canonicalJson(responseValues.transition)),
  ]) {
    const client = createBossAuthorityQueryClient({
      queryProtectedAuthority: () => transportResult(responseValues, responseData),
    }, responseValues.trust);
    await rejectsCode(client.query(responseValues.request), "invalid_transport_result");
  }
});

test("rejects transport-supplied verification context and malformed or unavailable responses", async () => {
  const values = fixture();
  const extraContextClient = createBossAuthorityQueryClient({
    queryProtectedAuthority: () => ({
      ...transportResult(values),
      identityVerification: values.trust.identityVerification,
    }),
  }, values.trust);
  await rejectsCode(extraContextClient.query(values.request), "invalid_transport_result");

  const canonical = canonicalJson(values.transition);
  const duplicateKeyJson = canonical.replace('"brokerRevision":7', '"brokerRevision":6,"brokerRevision":7');
  for (const responseData of [
    "not-json",
    JSON.stringify(values.transition),
    duplicateKeyJson,
    new TextEncoder().encode(duplicateKeyJson),
    new Uint8Array([0xff]),
    { ...values.transition, extra: true },
  ]) {
    const next = fixture();
    const client = createBossAuthorityQueryClient({
      queryProtectedAuthority: () => transportResult(next, responseData),
    }, next.trust);
    await rejectsCode(client.query(next.request), "invalid_transport_result");
  }
});
