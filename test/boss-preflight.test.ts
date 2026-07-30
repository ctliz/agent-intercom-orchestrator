import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  AUTHORITY_EVENT_VERSION,
  AUTHORITY_TRANSITION_VERSION,
  BOSS_CAPABILITY_FEATURE_DIGEST,
  BOSS_CONTROL_ENVELOPE_VERSION,
  BOSS_RUN_AUTHORITY_IDENTITY_VERSION,
  BOSS_RUN_FEATURE,
  BOSS_RUN_FEATURE_CONTRACT,
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
} from "@dataforxyz/agent-intercom-core/boss";
import { BOSS_AUTHORITY_PROJECTION_VERSION } from "../src/boss-types.ts";
import { sha256BossValue } from "../src/boss-types.ts";
import {
  BOSS_ADAPTER_INVENTORY_EVIDENCE_VERSION,
  BOSS_AUTHORITY_TRANSITION_EVIDENCE_VERSION,
  BOSS_CONTROLLER_EVIDENCE_VERSION,
  BOSS_MANAGER_CREDENTIAL_ATTESTATION_VERSION,
  BOSS_MANAGER_INVENTORY_ATTESTATION_VERSION,
  BOSS_PREFLIGHT_ADAPTERS,
  BOSS_PREFLIGHT_EXPECTATIONS_VERSION,
  BOSS_PREFLIGHT_RESULT_VERSION,
  runBossProtectedPreflight,
  type BossPreflightDependencies,
  type BossPreflightExpectations,
} from "../src/boss-preflight.ts";

const NOW = "2026-07-29T12:00:00.000Z";
const LATER = "2026-07-29T12:00:01.000Z";
const DIGEST = "a".repeat(64);
const TOOL_DIGEST = "b".repeat(64);
const RESOURCE_DIGEST = "c".repeat(64);
const CAPABILITY_DIGEST = "d".repeat(64);
const OWNER_UID = 1000;
const BROKER_UID = 995;
const CONTROLLER_UID = 994;
const BROKER_PID = 4321;
const BROKER_GENERATION = 4;
const CONTROLLER_GENERATION = 2;
const BROKER_REVISION = 7;
const BOSS_RUN_ID = "boss-run-preflight-1";
const CONTROLLER_ID = "controller-preflight-1";
const MANAGER_ID = "manager-preflight-1";
const TRANSITION_ID = "authority-controller-preflight-1";
const PREPARE_TOKEN = "prepare-token-preflight-1";

type Evidence = {
  broker: Record<string, unknown>;
  brokerVerificationContext: Record<string, unknown>;
  controller: Record<string, unknown>;
  transition: Record<string, unknown>;
  inventory: Record<string, unknown>;
};

function signedEvidence(ownerUid = OWNER_UID, bossBindingEpoch = 1): Evidence {
  const identityKeys = generateKeyPairSync("ed25519");
  const providerKeys = generateKeyPairSync("ed25519");
  const identityPublicKey = identityKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const providerPublicKey = providerKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const providerAttestation = {
    version: BROKER_PROVIDER_ATTESTATION_VERSION,
    providerPackage: "@dataforxyz/agent-intercom-pi",
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
  providerAttestation.signature = sign(null, brokerProviderAttestationSigningBytes(providerAttestation), providerKeys.privateKey).toString("base64");
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
    baseProtocolVersion: 3,
    features,
    protocolFeatureContractHash: BOSS_RUN_PROTOCOL_FEATURE_CONTRACT_HASH,
    featureSetHash: brokerFeatureSetHash(features),
    controlEnvelopeVersion: BOSS_CONTROL_ENVELOPE_VERSION,
    capabilityDigest: BOSS_CAPABILITY_FEATURE_DIGEST,
    protectedServiceUid: BROKER_UID,
    ownerUid,
    bootInstance: "broker-boot-preflight-1",
    processId: BROKER_PID,
    brokerGeneration: BROKER_GENERATION,
    publicEndpoint: `/run/agent-intercom/${ownerUid}/public.sock`,
    authorityEndpoint: `/run/agent-intercom/${ownerUid}/authority.sock`,
    identityKeyId: "identity-key-1",
    signature: "",
  };
  identity.signature = sign(null, brokerIdentitySigningBytes(identity), identityKeys.privateKey).toString("base64");
  const broker = { identity };
  const brokerVerificationContext = {
      expectedProviderPackage: providerAttestation.providerPackage,
      expectedProviderVersion: providerAttestation.providerVersion,
      expectedProviderDigest: providerAttestation.providerDigest,
      expectedProviderArtifactRoot: "/usr/lib/agent-intercom/providers/",
      expectedProviderArtifactOwnerUid: 0,
      expectedProviderArtifactOwnerGid: 0,
      expectedProviderArtifactMode: "0555",
      expectedOwnerUid: ownerUid,
      expectedBrokerServiceUid: BROKER_UID,
      expectedBootInstance: identity.bootInstance,
      minimumBrokerGeneration: BROKER_GENERATION,
      expectedPublicEndpoint: identity.publicEndpoint,
      expectedAuthorityEndpoint: identity.authorityEndpoint,
      trustedIdentityKeys: { "identity-key-1": identityPublicKey },
      trustedProviderKeys: { "provider-key-1": providerPublicKey },
      providerAttestation,
  };
  const authorityIdentity = {
    version: BOSS_RUN_AUTHORITY_IDENTITY_VERSION,
    controllerPrincipalId: CONTROLLER_ID,
    bossRunId: BOSS_RUN_ID,
    controllerGeneration: CONTROLLER_GENERATION,
    authorityTransitionRevision: BROKER_REVISION,
    bossBindingEpoch,
  };
  const controller = {
    version: BOSS_CONTROLLER_EVIDENCE_VERSION,
    interactiveOwnerUid: ownerUid,
    controllerServiceUid: CONTROLLER_UID,
    authorityIdentity,
    brokerGeneration: BROKER_GENERATION,
    brokerBootInstance: identity.bootInstance,
    authorityPeerExpectation: {
      version: BROKER_PEER_EXPECTATION_VERSION,
      endpointClass: "authority",
      ownerUid,
      expectedBrokerServiceUid: BROKER_UID,
      expectedBrokerProcessId: BROKER_PID,
      expectedClientUid: CONTROLLER_UID,
      expectedControllerUid: CONTROLLER_UID,
      requiresKernelPeerCredentials: true,
      requiresServiceCapability: true,
    },
    observedAuthorityPeer: {
      kernelPeerCredentialsPresent: true,
      endpointClass: "authority",
      brokerServiceUid: BROKER_UID,
      brokerProcessId: BROKER_PID,
      clientUid: CONTROLLER_UID,
      serviceCapabilityPresented: true,
    },
    managerCredential: {
      version: BOSS_MANAGER_CREDENTIAL_ATTESTATION_VERSION,
      credentialId: "manager-credential-preflight-1",
      bossRunId: BOSS_RUN_ID,
      managerParticipantId: MANAGER_ID,
      controllerPrincipalId: CONTROLLER_ID,
      controllerGeneration: CONTROLLER_GENERATION,
      bindingEpoch: bossBindingEpoch,
      scope: "manager",
      state: "active",
      authorityTransitionId: "authority-manager-preflight-1",
      brokerGeneration: BROKER_GENERATION,
      brokerBootInstance: identity.bootInstance,
    },
  };
  const brokerTransition = {
    version: AUTHORITY_TRANSITION_VERSION,
    authorityTransitionId: TRANSITION_ID,
    expectedBrokerRevision: BROKER_REVISION - 1,
    brokerRevision: BROKER_REVISION,
    operation: "controller_takeover",
    target: { bossRunId: BOSS_RUN_ID, controllerPrincipalId: CONTROLLER_ID },
    prior: { controllerGeneration: CONTROLLER_GENERATION - 1 },
    proposed: { controllerGeneration: CONTROLLER_GENERATION },
    idempotencyKey: "controller-takeover-preflight-1",
    state: "committed",
    prepareToken: PREPARE_TOKEN,
    preparedAt: NOW,
    committedAt: LATER,
  };
  const brokerEvent = {
    version: AUTHORITY_EVENT_VERSION,
    eventId: "authority-event-preflight-1",
    bossRunId: BOSS_RUN_ID,
    authorityTransitionId: TRANSITION_ID,
    brokerRevision: BROKER_REVISION,
    operation: "controller_takeover",
    state: "committed",
    target: { bossRunId: BOSS_RUN_ID, controllerPrincipalId: CONTROLLER_ID },
    prior: { controllerGeneration: CONTROLLER_GENERATION - 1 },
    resulting: { controllerGeneration: CONTROLLER_GENERATION },
    occurredAt: LATER,
  };
  const controllerProjection = {
    version: BOSS_AUTHORITY_PROJECTION_VERSION,
    authorityTransitionId: TRANSITION_ID,
    bossRunId: BOSS_RUN_ID,
    operation: "controller_takeover",
    targetKind: "controller",
    targetId: CONTROLLER_ID,
    idempotencyKey: brokerTransition.idempotencyKey,
    expectedBrokerRevision: BROKER_REVISION - 1,
    brokerRevision: BROKER_REVISION,
    priorControllerGeneration: CONTROLLER_GENERATION - 1,
    resultingControllerGeneration: CONTROLLER_GENERATION,
    priorBindingEpoch: null,
    resultingBindingEpoch: null,
    brokerState: "committed",
    projectionState: "reconciled",
    prepareTokenDigest: sha256BossValue("orc-boss-prepare-token-v1", PREPARE_TOKEN),
    createdAt: NOW,
    preparedAt: NOW,
    committedAt: LATER,
    reconciledAt: LATER,
    abortedAt: null,
    abortReason: null,
  };
  const transition = {
    version: BOSS_AUTHORITY_TRANSITION_EVIDENCE_VERSION,
    brokerTransition,
    brokerEvent,
    controllerProjection,
  };
  const adapters = BOSS_PREFLIGHT_ADAPTERS.map(({ id, packageName }) => ({
    id,
    packageName,
    packageVersion: "1.0.0",
    releaseId: "boss-release-preflight-1",
    featureContract: { ...BOSS_RUN_FEATURE_CONTRACT },
    protocolFeatureContractHash: BOSS_RUN_PROTOCOL_FEATURE_CONTRACT_HASH,
    capabilityDigest: BOSS_CAPABILITY_FEATURE_DIGEST,
  }));
  const canonicalAdapters = [...adapters].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const inventory = {
    version: BOSS_ADAPTER_INVENTORY_EVIDENCE_VERSION,
    adapters,
    managerInventory: {
      version: BOSS_MANAGER_INVENTORY_ATTESTATION_VERSION,
      bossRunId: BOSS_RUN_ID,
      managerParticipantId: MANAGER_ID,
      controllerPrincipalId: CONTROLLER_ID,
      controllerGeneration: CONTROLLER_GENERATION,
      authorityTransitionId: TRANSITION_ID,
      brokerGeneration: BROKER_GENERATION,
      brokerBootInstance: identity.bootInstance,
      adapterReleaseId: adapters[0]!.releaseId,
      adapterInventoryDigest: sha256BossValue("orc-boss-adapter-inventory-v1", canonicalAdapters),
      corePackageVersion: "0.1.0",
      sdkPackageVersion: "0.82.1",
      harness: "pi",
      model: "codex/gpt-5.6-sol",
      effort: "high",
      permissionProfile: "manager-restricted",
      fallback: false,
      toolManifestDigest: TOOL_DIGEST,
      resourceProfileDigest: RESOURCE_DIGEST,
      capabilityDigest: CAPABILITY_DIGEST,
      status: "verified",
      verifiedAt: LATER,
    },
  };
  return { broker, brokerVerificationContext, controller, transition, inventory };
}

function expectations(evidence: Evidence): BossPreflightExpectations {
  return {
    version: BOSS_PREFLIGHT_EXPECTATIONS_VERSION,
    brokerVerificationContext: evidence.brokerVerificationContext as unknown as BossPreflightExpectations["brokerVerificationContext"],
    adapters: BOSS_PREFLIGHT_ADAPTERS.map(({ id, packageName }) => ({ id, packageName, packageVersion: "1.0.0", releaseId: "boss-release-preflight-1" })),
    authority: {
      interactiveOwnerUid: OWNER_UID,
      controllerServiceUid: CONTROLLER_UID,
      bossRunId: BOSS_RUN_ID,
      managerParticipantId: MANAGER_ID,
      controllerPrincipalId: CONTROLLER_ID,
      controllerGeneration: CONTROLLER_GENERATION,
      bossBindingEpoch: 1,
      brokerGeneration: BROKER_GENERATION,
      brokerBootInstance: "broker-boot-preflight-1",
      managerCredentialAuthorityTransitionId: "authority-manager-preflight-1",
      controllerAuthorityTransitionId: TRANSITION_ID,
    },
    manager: {
      corePackageVersion: "0.1.0",
      sdkPackageVersion: "0.82.1",
      toolManifestDigest: TOOL_DIGEST,
      resourceProfileDigest: RESOURCE_DIGEST,
      capabilityDigest: CAPABILITY_DIGEST,
      verifiedNotBefore: NOW,
      verifiedNotAfter: LATER,
    },
  };
}

function dependencies(evidence: Evidence): BossPreflightDependencies {
  return {
    getProtectedBrokerEvidence: () => evidence.broker,
    getControllerAuthorityEvidence: () => evidence.controller,
    getAuthorityTransitionEvidence: () => evidence.transition,
    getAdapterInventoryEvidence: () => evidence.inventory,
  };
}

function copy(): Evidence {
  return structuredClone(signedEvidence());
}

async function codes(evidence: Evidence): Promise<string[]> {
  return (await runBossProtectedPreflight(dependencies(evidence), expectations(evidence))).checks.map((check) => check.code);
}

test("production preflight remains dormant and fails all four prerequisites closed", async () => {
  const result = await runBossProtectedPreflight();
  assert.equal(result.version, BOSS_PREFLIGHT_RESULT_VERSION);
  assert.equal(result.ready, false);
  assert.deepEqual(result.checks.map((check) => check.code), [
    "BOSS_PREFLIGHT_BROKER_EVIDENCE_UNAVAILABLE",
    "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_UNAVAILABLE",
    "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_UNAVAILABLE",
    "BOSS_PREFLIGHT_INVENTORY_EXPECTATIONS_UNAVAILABLE",
  ]);
  assert.ok(result.checks.every((check) => !check.ready && check.remediation.length > 0));
});

test("all-ready requires exact injected authoritative evidence", async () => {
  const evidence = signedEvidence();
  const result = await runBossProtectedPreflight(dependencies(evidence), expectations(evidence));
  assert.equal(result.ready, true);
  assert.deepEqual(result.checks.map((check) => [check.ready, check.code, check.remediation]), [
    [true, "BOSS_PREFLIGHT_READY", null],
    [true, "BOSS_PREFLIGHT_READY", null],
    [true, "BOSS_PREFLIGHT_READY", null],
    [true, "BOSS_PREFLIGHT_READY", null],
  ]);
});

test("trust roots are parsed before readers and reject malformed, aliased, private, or modified keys", async () => {
  const evidence = signedEvidence();
  const trusted = expectations(evidence);
  trusted.brokerVerificationContext.trustedIdentityKeys = {
    "identity-key-1": createPublicKey((evidence.brokerVerificationContext.trustedIdentityKeys as Record<string, unknown>)["identity-key-1"] as string),
  };
  trusted.brokerVerificationContext.trustedProviderKeys = {
    "provider-key-1": createPublicKey((evidence.brokerVerificationContext.trustedProviderKeys as Record<string, unknown>)["provider-key-1"] as string),
  };
  assert.equal((await runBossProtectedPreflight(dependencies(evidence), trusted)).ready, true);

  for (const mutate of [
    (value: BossPreflightExpectations) => { value.brokerVerificationContext.expectedProviderDigest = "not-a-digest"; },
    (value: BossPreflightExpectations) => {
      const key = generateKeyPairSync("ed25519").publicKey;
      value.brokerVerificationContext.trustedIdentityKeys = { first: key, second: key };
    },
    (value: BossPreflightExpectations) => { value.brokerVerificationContext.trustedIdentityKeys = { private: generateKeyPairSync("ed25519").privateKey }; },
    (value: BossPreflightExpectations) => {
      const key = generateKeyPairSync("ed25519").publicKey;
      Object.defineProperty(key, "attacker", { enumerable: true, value: true });
      value.brokerVerificationContext.trustedIdentityKeys = { modified: key };
    },
  ]) {
    const candidate = expectations(signedEvidence());
    mutate(candidate);
    let invoked = 0;
    const readers = dependencies(signedEvidence());
    for (const name of ["getProtectedBrokerEvidence", "getControllerAuthorityEvidence", "getAuthorityTransitionEvidence", "getAdapterInventoryEvidence"] as const) {
      readers[name] = () => { invoked += 1; return undefined; };
    }
    const result = await runBossProtectedPreflight(readers, candidate);
    assert.equal(result.ready, false);
    assert.equal(invoked, 0);
  }

  const spoofedPrivateCandidate = expectations(signedEvidence());
  const spoofedPrivateKey = generateKeyPairSync("ed25519").privateKey;
  const mutableTypeSymbol = Reflect.ownKeys(spoofedPrivateKey).find((key) => typeof key === "symbol" && String(key) === "Symbol(kKeyType)");
  if (mutableTypeSymbol) {
    Object.defineProperty(spoofedPrivateKey, mutableTypeSymbol, { ...Object.getOwnPropertyDescriptor(spoofedPrivateKey, mutableTypeSymbol), value: "public" });
    spoofedPrivateCandidate.brokerVerificationContext.trustedIdentityKeys = { spoofed: spoofedPrivateKey };
    let spoofedReadersInvoked = 0;
    const spoofedReaders = dependencies(signedEvidence());
    for (const name of ["getProtectedBrokerEvidence", "getControllerAuthorityEvidence", "getAuthorityTransitionEvidence", "getAdapterInventoryEvidence"] as const) {
      spoofedReaders[name] = () => { spoofedReadersInvoked += 1; return undefined; };
    }
    await runBossProtectedPreflight(spoofedReaders, spoofedPrivateCandidate);
    assert.equal(spoofedReadersInvoked, 0);
  }

  const accessorCandidate = expectations(signedEvidence());
  const accessorKey = generateKeyPairSync("ed25519").publicKey;
  let typeAccessorInvoked = false;
  Object.defineProperty(accessorKey, "type", { enumerable: false, get() { typeAccessorInvoked = true; return "public"; } });
  accessorCandidate.brokerVerificationContext.trustedIdentityKeys = { accessor: accessorKey };
  let accessorReadersInvoked = 0;
  const accessorReaders = dependencies(signedEvidence());
  for (const name of ["getProtectedBrokerEvidence", "getControllerAuthorityEvidence", "getAuthorityTransitionEvidence", "getAdapterInventoryEvidence"] as const) {
    accessorReaders[name] = () => { accessorReadersInvoked += 1; return undefined; };
  }
  await runBossProtectedPreflight(accessorReaders, accessorCandidate);
  assert.equal(typeAccessorInvoked, false);
  assert.equal(accessorReadersInvoked, 0);

  let missingInvoked = 0;
  const missingReaders = dependencies(signedEvidence());
  for (const name of ["getProtectedBrokerEvidence", "getControllerAuthorityEvidence", "getAuthorityTransitionEvidence", "getAdapterInventoryEvidence"] as const) {
    missingReaders[name] = () => { missingInvoked += 1; return undefined; };
  }
  await runBossProtectedPreflight(missingReaders);
  assert.equal(missingInvoked, 0);
});

test("dependency proxies, accessors, inheritance, missing and unknown keys fail closed without invoking accessors", async () => {
  const valid = dependencies(signedEvidence());
  let invoked = false;
  const accessor = { ...valid } as Record<string, unknown>;
  Object.defineProperty(accessor, "getProtectedBrokerEvidence", {
    enumerable: true,
    get() { invoked = true; return valid.getProtectedBrokerEvidence; },
  });
  const inherited = Object.create(valid);
  const missing = { ...valid } as Record<string, unknown>;
  delete missing.getAdapterInventoryEvidence;
  for (const candidate of [new Proxy(valid, {}), accessor, inherited, missing, { ...valid, extra: () => undefined }]) {
    const result = await runBossProtectedPreflight(candidate as BossPreflightDependencies);
    assert.equal(result.ready, false);
    assert.ok(result.checks.every((check) => check.code === "BOSS_PREFLIGHT_DEPENDENCIES_INVALID"));
  }
  assert.equal(invoked, false);
});

test("evidence proxies, accessors, inherited records, sparse arrays and unknown keys are rejected as exact own-data violations", async () => {
  const proxyEvidence = copy();
  proxyEvidence.broker = new Proxy(proxyEvidence.broker, {});
  assert.equal((await codes(proxyEvidence))[0], "BOSS_PREFLIGHT_BROKER_EVIDENCE_INVALID");

  const accessorEvidence = copy();
  let invoked = false;
  Object.defineProperty(accessorEvidence.controller, "authorityIdentity", {
    enumerable: true,
    get() { invoked = true; return {}; },
  });
  assert.equal((await codes(accessorEvidence))[1], "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_INVALID");
  assert.equal(invoked, false);

  const inheritedEvidence = copy();
  inheritedEvidence.transition = Object.create(inheritedEvidence.transition);
  assert.equal((await codes(inheritedEvidence))[2], "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_INVALID");

  const sparseEvidence = copy();
  (sparseEvidence.inventory.adapters as unknown[]) = new Array(4);
  assert.equal((await codes(sparseEvidence))[3], "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID");

  const inheritedArray = copy();
  Object.setPrototypeOf(inheritedArray.inventory.adapters, { attacker: true });
  assert.equal((await codes(inheritedArray))[3], "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID");

  const symbolArray = copy();
  Object.defineProperty(symbolArray.inventory.adapters, Symbol("hidden"), { enumerable: true, value: true });
  assert.equal((await codes(symbolArray))[3], "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID");

  const nonIndexArray = copy();
  Object.defineProperty(nonIndexArray.inventory.adapters, "4294967295", { enumerable: true, value: true });
  assert.equal((await codes(nonIndexArray))[3], "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID");

  const cyclicEvidence = copy();
  cyclicEvidence.inventory.cycle = cyclicEvidence.inventory;
  assert.equal((await codes(cyclicEvidence))[3], "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID");

  const opaqueEvidence = copy();
  (opaqueEvidence.inventory.managerInventory as Record<string, unknown>).capabilityDigest = new Date();
  assert.equal((await codes(opaqueEvidence))[3], "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID");

  for (const [field, index, expected] of [
    ["broker", 0, "BOSS_PREFLIGHT_BROKER_EVIDENCE_INVALID"],
    ["controller", 1, "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_INVALID"],
    ["transition", 2, "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_INVALID"],
    ["inventory", 3, "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID"],
  ] as const) {
    const evidence = copy();
    evidence[field].unknown = true;
    assert.equal((await codes(evidence))[index], expected);
  }
});

test("each absent or throwing protected reader yields its deterministic unavailable code", async () => {
  const evidence = signedEvidence();
  const base = dependencies(evidence);
  const names = [
    "getProtectedBrokerEvidence",
    "getControllerAuthorityEvidence",
    "getAuthorityTransitionEvidence",
    "getAdapterInventoryEvidence",
  ] as const;
  const expected = [
    "BOSS_PREFLIGHT_BROKER_EVIDENCE_UNAVAILABLE",
    "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_UNAVAILABLE",
    "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_UNAVAILABLE",
    "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_UNAVAILABLE",
  ];
  for (let index = 0; index < names.length; index += 1) {
    const deps = { ...base, [names[index]!]: index % 2 ? () => { throw new Error("service unavailable"); } : () => undefined };
    const result = await runBossProtectedPreflight(deps, expectations(evidence));
    assert.equal(result.checks[index]!.code, expected[index]);
    assert.equal(result.ready, false);
  }
});

test("stale broker boot/generation and same-UID Controller evidence cannot substitute for current authority", async () => {
  const staleBroker = copy();
  staleBroker.brokerVerificationContext.expectedBootInstance = "stale-boot";
  assert.equal((await codes(staleBroker))[0], "BOSS_PREFLIGHT_BROKER_ATTESTATION_REJECTED");

  const staleController = copy();
  staleController.controller.brokerGeneration = BROKER_GENERATION - 1;
  assert.equal((await codes(staleController))[1], "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_MISMATCH");

  const sameUid = copy();
  sameUid.controller.controllerServiceUid = OWNER_UID;
  assert.equal((await codes(sameUid))[1], "BOSS_PREFLIGHT_CONTROLLER_UID_BOUNDARY_INVALID");

  const uncredentialed = copy();
  (uncredentialed.controller.managerCredential as Record<string, unknown>).scope = "participant";
  assert.equal((await codes(uncredentialed))[1], "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_INVALID");

  const wrongOwner = copy();
  (wrongOwner.controller.authorityPeerExpectation as Record<string, unknown>).ownerUid = OWNER_UID + 1;
  assert.equal((await codes(wrongOwner))[1], "BOSS_PREFLIGHT_CONTROLLER_AUTHORITY_PEER_DENIED");

  const wrongBinding = copy();
  (wrongBinding.controller.managerCredential as Record<string, unknown>).bindingEpoch = 2;
  assert.equal((await codes(wrongBinding))[1], "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_MISMATCH");

  const ownerEvidence = signedEvidence(OWNER_UID + 1);
  const coordinatedOwner = await runBossProtectedPreflight(dependencies(ownerEvidence), expectations(signedEvidence()));
  assert.equal(coordinatedOwner.checks[0].code, "BOSS_PREFLIGHT_BROKER_ATTESTATION_REJECTED");

  const bindingEvidence = signedEvidence(OWNER_UID, 2);
  const coordinatedBinding = await runBossProtectedPreflight(dependencies(bindingEvidence), expectations(bindingEvidence));
  assert.equal(coordinatedBinding.checks[1].code, "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_MISMATCH");
});

test("transition evidence must be committed, reconciled and match the authoritative Controller generation", async () => {
  const prepared = copy();
  const preparedTransition = prepared.transition.brokerTransition as Record<string, unknown>;
  preparedTransition.state = "prepared";
  delete preparedTransition.committedAt;
  assert.equal((await codes(prepared))[2], "BOSS_PREFLIGHT_TRANSITION_NOT_COMMITTED");

  const projected = copy();
  const projection = projected.transition.controllerProjection as Record<string, unknown>;
  projection.projectionState = "projected";
  projection.reconciledAt = null;
  assert.equal((await codes(projected))[2], "BOSS_PREFLIGHT_TRANSITION_NOT_RECONCILED");

  const substituted = copy();
  (substituted.transition.brokerEvent as Record<string, unknown>).authorityTransitionId = "authority-controller-other-1";
  assert.equal((await codes(substituted))[2], "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_MISMATCH");

  const stale = copy();
  (stale.transition.controllerProjection as Record<string, unknown>).resultingControllerGeneration = CONTROLLER_GENERATION + 1;
  assert.equal((await codes(stale))[2], "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_INVALID");

  const eventChronology = copy();
  (eventChronology.transition.brokerEvent as Record<string, unknown>).occurredAt = "2026-07-29T12:00:02.000Z";
  assert.equal((await codes(eventChronology))[2], "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_MISMATCH");

  const projectionChronology = copy();
  (projectionChronology.transition.controllerProjection as Record<string, unknown>).preparedAt = "2026-07-29T12:00:00.500Z";
  assert.equal((await codes(projectionChronology))[2], "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_MISMATCH");
});

test("adapter and Manager substitutions, version drift, and stale inventory fail closed", async () => {
  const packageSubstitution = copy();
  ((packageSubstitution.inventory.adapters as Record<string, unknown>[])[0]!).packageName = "@attacker/agent-intercom-pi";
  assert.equal((await codes(packageSubstitution))[3], "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID");

  const releaseDrift = copy();
  ((releaseDrift.inventory.adapters as Record<string, unknown>[])[1]!).releaseId = "boss-release-other-1";
  assert.equal((await codes(releaseDrift))[3], "BOSS_PREFLIGHT_ADAPTER_RELEASE_MISMATCH");

  const featureDrift = copy();
  ((featureDrift.inventory.adapters as Record<string, unknown>[])[2]!).capabilityDigest = DIGEST;
  assert.equal((await codes(featureDrift))[3], "BOSS_PREFLIGHT_ADAPTER_FEATURE_MISMATCH");

  const packageVersionDrift = copy();
  ((packageVersionDrift.inventory.adapters as Record<string, unknown>[])[0]!).packageVersion = "1.0.1";
  const packageAdapters = packageVersionDrift.inventory.adapters as Record<string, unknown>[];
  (packageVersionDrift.inventory.managerInventory as Record<string, unknown>).adapterInventoryDigest = sha256BossValue(
    "orc-boss-adapter-inventory-v1",
    [...packageAdapters].sort((left, right) => String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0),
  );
  assert.equal((await codes(packageVersionDrift))[3], "BOSS_PREFLIGHT_ADAPTER_RELEASE_MISMATCH");

  const managerSubstitution = copy();
  (managerSubstitution.inventory.managerInventory as Record<string, unknown>).managerParticipantId = "manager-other-1";
  assert.equal((await codes(managerSubstitution))[3], "BOSS_PREFLIGHT_MANAGER_INVENTORY_MISMATCH");

  const staleInventory = copy();
  (staleInventory.inventory.managerInventory as Record<string, unknown>).controllerGeneration = CONTROLLER_GENERATION - 1;
  assert.equal((await codes(staleInventory))[3], "BOSS_PREFLIGHT_MANAGER_INVENTORY_MISMATCH");

  const capabilitySubstitution = copy();
  (capabilitySubstitution.inventory.managerInventory as Record<string, unknown>).capabilityDigest = DIGEST;
  assert.equal((await codes(capabilitySubstitution))[3], "BOSS_PREFLIGHT_MANAGER_INVENTORY_MISMATCH");

  const replayedInventory = copy();
  (replayedInventory.inventory.managerInventory as Record<string, unknown>).verifiedAt = "2026-07-29T11:59:59.000Z";
  assert.equal((await codes(replayedInventory))[3], "BOSS_PREFLIGHT_MANAGER_INVENTORY_MISMATCH");

  const noExpectations = await runBossProtectedPreflight(dependencies(copy()));
  assert.equal(noExpectations.checks[3].code, "BOSS_PREFLIGHT_INVENTORY_EXPECTATIONS_UNAVAILABLE");

  const fallback = copy();
  (fallback.inventory.managerInventory as Record<string, unknown>).fallback = true;
  assert.equal((await codes(fallback))[3], "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID");
});
