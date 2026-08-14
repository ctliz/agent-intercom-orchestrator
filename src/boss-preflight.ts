import { createPublicKey, KeyObject } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  BOSS_CAPABILITY_FEATURE_DIGEST,
  BOSS_CONTROL_ENVELOPE_VERSION,
  BOSS_RUN_FEATURE,
  BOSS_RUN_FEATURE_SEMANTICS_HASH,
  BOSS_RUN_FEATURE_VERSION,
  BOSS_RUN_PROTOCOL_FEATURE_CONTRACT_HASH,
  BROKER_PEER_EXPECTATION_VERSION,
  INTERCOM_BASE_PROTOCOL_VERSION,
  authorizeBrokerPeer,
  parseAuthorityTransitionEvent,
  parseAuthorityTransitionRecord,
  parseBossRunAuthorityIdentity,
  parseBossRunFeatureContract,
  parseBrokerCompatibilityRequest,
  parseBrokerIdentityRecord,
  parseBrokerPeerExpectation,
  parseObservedBrokerPeer,
  verifyProtectedBrokerIdentity,
  type AuthorityTransitionEvent,
  type AuthorityTransitionRecord,
  type BossRunAuthorityIdentity,
  type BrokerIdentityRecord,
  type BrokerIdentityVerificationContext,
} from "@ctliz/agent-intercom-core/boss";
import { BOSS_PROTECTED_PREREQUISITES } from "./boss-command.ts";
import {
  canonicalBossJson,
  parseBossAuthorityTransitionProjectionV1,
  sha256BossValue,
  type BossAuthorityTransitionProjectionV1,
} from "./boss-types.ts";

export const BOSS_PREFLIGHT_RESULT_VERSION = "orc.boss-protected-preflight.v1" as const;
export const BOSS_PREFLIGHT_EXPECTATIONS_VERSION = "orc.boss-protected-preflight-expectations.v1" as const;
export const BOSS_CONTROLLER_EVIDENCE_VERSION = "orc.boss-controller-authority-evidence.v1" as const;
export const BOSS_MANAGER_CREDENTIAL_ATTESTATION_VERSION = "orc.boss-manager-credential-attestation.v1" as const;
export const BOSS_AUTHORITY_TRANSITION_EVIDENCE_VERSION = "orc.boss-authority-transition-evidence.v1" as const;
export const BOSS_ADAPTER_INVENTORY_EVIDENCE_VERSION = "orc.boss-adapter-inventory-evidence.v1" as const;
export const BOSS_MANAGER_INVENTORY_ATTESTATION_VERSION = "orc.boss-manager-inventory-attestation.v1" as const;

const INTRINSIC_STRUCTURED_CLONE = globalThis.structuredClone;
const KEY_OBJECT_TYPE_GETTER = Object.getOwnPropertyDescriptor(KeyObject.prototype, "type")!.get!;
const PUBLIC_KEY_EXPORT = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(createPublicKey(
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAnmdmU8vimbDrDOfIKaNGgXp9wgs39vnXi5+CfHs4Cdw=\n-----END PUBLIC KEY-----\n",
)), "export")!.value as (options: { type: "spki"; format: "der" }) => Buffer;

export const BOSS_PREFLIGHT_ADAPTERS = [
  { id: "pi", packageName: "@ctliz/agent-intercom-pi" },
  { id: "codex", packageName: "@ctliz/agent-intercom-codex" },
  { id: "claude", packageName: "@ctliz/agent-intercom-claude" },
  { id: "opencode", packageName: "@ctliz/agent-intercom-opencode" },
] as const;

export type BossPreflightErrorCode =
  | "BOSS_PREFLIGHT_READY"
  | "BOSS_PREFLIGHT_DEPENDENCIES_INVALID"
  | "BOSS_PREFLIGHT_BROKER_EVIDENCE_UNAVAILABLE"
  | "BOSS_PREFLIGHT_BROKER_EVIDENCE_INVALID"
  | "BOSS_PREFLIGHT_BROKER_ATTESTATION_REJECTED"
  | "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_UNAVAILABLE"
  | "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_INVALID"
  | "BOSS_PREFLIGHT_CONTROLLER_UID_BOUNDARY_INVALID"
  | "BOSS_PREFLIGHT_CONTROLLER_AUTHORITY_PEER_DENIED"
  | "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_MISMATCH"
  | "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_UNAVAILABLE"
  | "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_INVALID"
  | "BOSS_PREFLIGHT_TRANSITION_NOT_COMMITTED"
  | "BOSS_PREFLIGHT_TRANSITION_NOT_RECONCILED"
  | "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_MISMATCH"
  | "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_UNAVAILABLE"
  | "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID"
  | "BOSS_PREFLIGHT_INVENTORY_EXPECTATIONS_UNAVAILABLE"
  | "BOSS_PREFLIGHT_ADAPTER_SET_MISMATCH"
  | "BOSS_PREFLIGHT_ADAPTER_RELEASE_MISMATCH"
  | "BOSS_PREFLIGHT_ADAPTER_FEATURE_MISMATCH"
  | "BOSS_PREFLIGHT_MANAGER_INVENTORY_MISMATCH";

export type BossPreflightCheck = {
  prerequisite: (typeof BOSS_PROTECTED_PREREQUISITES)[number];
  ready: true;
  code: "BOSS_PREFLIGHT_READY";
  remediation: null;
} | {
  prerequisite: (typeof BOSS_PROTECTED_PREREQUISITES)[number];
  ready: false;
  code: Exclude<BossPreflightErrorCode, "BOSS_PREFLIGHT_READY">;
  remediation: string;
};

export interface BossPreflightResult {
  version: typeof BOSS_PREFLIGHT_RESULT_VERSION;
  ready: boolean;
  checks: readonly BossPreflightCheck[];
}

export interface BossPreflightDependencies {
  getProtectedBrokerEvidence(): unknown | Promise<unknown>;
  getControllerAuthorityEvidence(): unknown | Promise<unknown>;
  getAuthorityTransitionEvidence(): unknown | Promise<unknown>;
  getAdapterInventoryEvidence(): unknown | Promise<unknown>;
}

export interface BossPreflightExpectations {
  version: typeof BOSS_PREFLIGHT_EXPECTATIONS_VERSION;
  brokerVerificationContext: BrokerIdentityVerificationContext;
  adapters: Array<{ id: (typeof BOSS_PREFLIGHT_ADAPTERS)[number]["id"]; packageName: string; packageVersion: string; releaseId: string }>;
  authority: {
    interactiveOwnerUid: number;
    controllerServiceUid: number;
    bossRunId: string;
    managerParticipantId: string;
    controllerPrincipalId: string;
    controllerGeneration: number;
    bossBindingEpoch: number;
    brokerGeneration: number;
    brokerBootInstance: string;
    managerCredentialAuthorityTransitionId: string;
    controllerAuthorityTransitionId: string;
  };
  manager: {
    corePackageVersion: string;
    sdkPackageVersion: string;
    toolManifestDigest: string;
    resourceProfileDigest: string;
    capabilityDigest: string;
    verifiedNotBefore: string;
    verifiedNotAfter: string;
  };
}

type DependencyName = keyof BossPreflightDependencies;
type OwnDataRecord = Record<string, unknown>;

const DEPENDENCY_NAMES = [
  "getProtectedBrokerEvidence",
  "getControllerAuthorityEvidence",
  "getAuthorityTransitionEvidence",
  "getAdapterInventoryEvidence",
] as const satisfies readonly DependencyName[];

const REMEDIATION = {
  dependencies: "Provide exactly the four protected service evidence readers as own data properties.",
  broker: "Query the protected broker service and verify its signed identity, provider artifact, boot instance, and current generation.",
  controller: "Provision a Controller under a UID distinct from both the owner and broker, then obtain authority-peer and active Manager-credential attestations.",
  transition: "Commit the broker-authoritative Controller takeover and reconcile that exact event and generation into the Controller projection.",
  inventory: "Coordinate all four adapters on the canonical boss-run-v1 contract and obtain a Controller-attested current Manager inventory.",
} as const;

function fail(
  index: number,
  code: Exclude<BossPreflightErrorCode, "BOSS_PREFLIGHT_READY">,
  remediation: string,
): BossPreflightCheck {
  return { prerequisite: BOSS_PROTECTED_PREREQUISITES[index]!, ready: false, code, remediation };
}

function pass(index: number): BossPreflightCheck {
  return { prerequisite: BOSS_PROTECTED_PREREQUISITES[index]!, ready: true, code: "BOSS_PREFLIGHT_READY", remediation: null };
}

function ownRecord(value: unknown, required: readonly string[], path: string): OwnDataRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${path} must be a non-proxy plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw new Error(`${path} has a symbol key`);
  const allowed = new Set(required);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
  for (const key of keys as string[]) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is unsupported`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`${path}.${key} must be an enumerable data property`);
  }
  const projected: OwnDataRecord = {};
  for (const key of required) projected[key] = Object.getOwnPropertyDescriptor(value, key)!.value;
  return projected;
}

function denseArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`${path} must be a non-proxy plain array`);
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 0) throw new Error(`${path} has an invalid length`);
  const entries: unknown[] = [];
  const descriptors = new Map<number, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) throw new Error(`${path} has a non-index property`);
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= length) throw new Error(`${path} has an out-of-range property`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`${path}[${index}] must be an enumerable data property`);
    descriptors.set(index, descriptor);
  }
  if (descriptors.size !== length) throw new Error(`${path} must be dense`);
  for (let index = 0; index < length; index += 1) entries.push(descriptors.get(index)!.value);
  return entries;
}

/** Reject proxies/accessors/inherited containers before a Core parser can observe them. */
function assertOwnDataTree(value: unknown, path = "$", seen = new Set<object>()): void {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return;
  if (typeof value !== "object") throw new Error(`${path} contains a non-data value`);
  if (isProxy(value)) throw new Error(`${path} contains a proxy`);
  if (seen.has(value)) throw new Error(`${path} contains a cycle or alias`);
  seen.add(value);
  if (value instanceof KeyObject) {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "string") throw new Error(`${path} must not carry custom string-keyed KeyObject properties`);
    }
    return;
  }
  if (Array.isArray(value)) {
    denseArray(value, path).forEach((entry, index) => assertOwnDataTree(entry, `${path}[${index}]`, seen));
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${path} contains an inherited or opaque object`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new Error(`${path} contains a symbol key`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`${path}.${key} must be an enumerable data property`);
      assertOwnDataTree(descriptor.value, `${path}.${key}`, seen);
    }
  }
}

function normalizedOwnData(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof KeyObject) {
    const cloned = INTRINSIC_STRUCTURED_CLONE(value);
    if (!(cloned instanceof KeyObject) || Reflect.apply(KEY_OBJECT_TYPE_GETTER, cloned, []) !== "public") throw new Error("Broker trust key must be public");
    const exported = Reflect.apply(PUBLIC_KEY_EXPORT, cloned, [{ type: "spki", format: "der" }]) as Buffer;
    return createPublicKey({ key: exported, type: "spki", format: "der" });
  }
  if (Array.isArray(value)) return value.map((entry) => normalizedOwnData(entry));
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) result[key] = normalizedOwnData((value as Record<string, unknown>)[key]);
  return result;
}

function parseBrokerVerificationContext(value: unknown): BrokerIdentityVerificationContext {
  assertOwnDataTree(value, "$expectations.brokerVerificationContext");
  const normalized = normalizedOwnData(value);
  const projected = ownRecord(normalized, [
    "expectedProviderPackage", "expectedProviderVersion", "expectedProviderDigest", "expectedProviderArtifactRoot",
    "expectedProviderArtifactOwnerUid", "expectedProviderArtifactOwnerGid", "expectedProviderArtifactMode", "expectedOwnerUid",
    "expectedBrokerServiceUid", "expectedBootInstance", "minimumBrokerGeneration", "expectedPublicEndpoint", "expectedAuthorityEndpoint",
    "trustedIdentityKeys", "trustedProviderKeys", "providerAttestation",
  ], "$expectations.brokerVerificationContext");
  const ownerUid = uid(projected.expectedOwnerUid, "$expectations.brokerVerificationContext.expectedOwnerUid");
  const brokerServiceUid = uid(projected.expectedBrokerServiceUid, "$expectations.brokerVerificationContext.expectedBrokerServiceUid");
  let controllerUid = 0;
  while (controllerUid === ownerUid || controllerUid === brokerServiceUid) controllerUid += 1;
  const parsed = parseBrokerCompatibilityRequest({
    clientKind: "boss",
    supportedBaseProtocolVersions: [INTERCOM_BASE_PROTOCOL_VERSION],
    requiredFeature: BOSS_RUN_FEATURE,
    expectedProtectedOwnerUid: ownerUid,
    identityVerification: projected,
    peerExpectation: {
      version: BROKER_PEER_EXPECTATION_VERSION,
      endpointClass: "authority",
      ownerUid,
      expectedBrokerServiceUid: brokerServiceUid,
      expectedBrokerProcessId: 1,
      expectedClientUid: controllerUid,
      expectedControllerUid: controllerUid,
      requiresKernelPeerCredentials: true,
      requiresServiceCapability: true,
    },
    observedPeer: {
      kernelPeerCredentialsPresent: true,
      endpointClass: "authority",
      brokerServiceUid,
      brokerProcessId: 1,
      clientUid: controllerUid,
      serviceCapabilityPresented: true,
    },
  });
  if (parsed.clientKind !== "boss") throw new Error("Broker verification context did not parse as protected Boss context");
  return parsed.identityVerification;
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`${path} must be a bounded string`);
  return value;
}

function digest(value: unknown, path: string): string {
  const result = nonEmpty(value, path);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${path} must be a SHA-256 digest`);
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${path} must be a positive safe integer`);
  return value as number;
}

function uid(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path} must be a non-negative UID`);
  return value as number;
}

function timestamp(value: unknown, path: string): string {
  const result = nonEmpty(value, path);
  const parsed = Date.parse(result);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) || Number.isNaN(parsed) || new Date(parsed).toISOString() !== result) {
    throw new Error(`${path} must be a canonical timestamp`);
  }
  return result;
}

function exactDependencies(value: unknown): Record<DependencyName, () => unknown | Promise<unknown>> {
  const record = ownRecord(value, DEPENDENCY_NAMES, "$dependencies");
  const result = {} as Record<DependencyName, () => unknown | Promise<unknown>>;
  for (const name of DEPENDENCY_NAMES) {
    if (typeof record[name] !== "function" || isProxy(record[name] as object)) throw new Error(`$dependencies.${name} must be a non-proxy function`);
    result[name] = record[name] as () => unknown | Promise<unknown>;
  }
  return result;
}

function parseExpectations(value: unknown): BossPreflightExpectations | undefined {
  if (value === undefined) return undefined;
  assertOwnDataTree(value);
  const root = ownRecord(value, ["version", "brokerVerificationContext", "adapters", "authority", "manager"], "$expectations");
  if (root.version !== BOSS_PREFLIGHT_EXPECTATIONS_VERSION) throw new Error("Unsupported preflight expectations version");
  const adapters = denseArray(root.adapters, "$expectations.adapters").map((entry, index) => {
    const v = ownRecord(entry, ["id", "packageName", "packageVersion", "releaseId"], `$expectations.adapters[${index}]`);
    const expected = BOSS_PREFLIGHT_ADAPTERS.find((candidate) => candidate.id === v.id);
    if (!expected || v.packageName !== expected.packageName) throw new Error("Expectation adapter identity substitution");
    return {
      id: expected.id,
      packageName: expected.packageName,
      packageVersion: nonEmpty(v.packageVersion, `$expectations.adapters[${index}].packageVersion`),
      releaseId: nonEmpty(v.releaseId, `$expectations.adapters[${index}].releaseId`),
    };
  });
  if (adapters.length !== BOSS_PREFLIGHT_ADAPTERS.length || new Set(adapters.map((entry) => entry.id)).size !== BOSS_PREFLIGHT_ADAPTERS.length) throw new Error("Expectation adapter set mismatch");
  const authorityValue = ownRecord(root.authority, [
    "interactiveOwnerUid", "controllerServiceUid", "bossRunId", "managerParticipantId", "controllerPrincipalId", "controllerGeneration",
    "bossBindingEpoch", "brokerGeneration", "brokerBootInstance", "managerCredentialAuthorityTransitionId", "controllerAuthorityTransitionId",
  ], "$expectations.authority");
  const managerValue = ownRecord(root.manager, [
    "corePackageVersion", "sdkPackageVersion", "toolManifestDigest", "resourceProfileDigest", "capabilityDigest", "verifiedNotBefore", "verifiedNotAfter",
  ], "$expectations.manager");
  const verifiedNotBefore = timestamp(managerValue.verifiedNotBefore, "$expectations.manager.verifiedNotBefore");
  const verifiedNotAfter = timestamp(managerValue.verifiedNotAfter, "$expectations.manager.verifiedNotAfter");
  if (Date.parse(verifiedNotAfter) < Date.parse(verifiedNotBefore)) throw new Error("Expectation freshness window is reversed");
  return {
    version: BOSS_PREFLIGHT_EXPECTATIONS_VERSION,
    brokerVerificationContext: parseBrokerVerificationContext(root.brokerVerificationContext),
    adapters,
    authority: {
      interactiveOwnerUid: uid(authorityValue.interactiveOwnerUid, "$expectations.authority.interactiveOwnerUid"),
      controllerServiceUid: uid(authorityValue.controllerServiceUid, "$expectations.authority.controllerServiceUid"),
      bossRunId: nonEmpty(authorityValue.bossRunId, "$expectations.authority.bossRunId"),
      managerParticipantId: nonEmpty(authorityValue.managerParticipantId, "$expectations.authority.managerParticipantId"),
      controllerPrincipalId: nonEmpty(authorityValue.controllerPrincipalId, "$expectations.authority.controllerPrincipalId"),
      controllerGeneration: positiveInteger(authorityValue.controllerGeneration, "$expectations.authority.controllerGeneration"),
      bossBindingEpoch: positiveInteger(authorityValue.bossBindingEpoch, "$expectations.authority.bossBindingEpoch"),
      brokerGeneration: positiveInteger(authorityValue.brokerGeneration, "$expectations.authority.brokerGeneration"),
      brokerBootInstance: nonEmpty(authorityValue.brokerBootInstance, "$expectations.authority.brokerBootInstance"),
      managerCredentialAuthorityTransitionId: nonEmpty(authorityValue.managerCredentialAuthorityTransitionId, "$expectations.authority.managerCredentialAuthorityTransitionId"),
      controllerAuthorityTransitionId: nonEmpty(authorityValue.controllerAuthorityTransitionId, "$expectations.authority.controllerAuthorityTransitionId"),
    },
    manager: {
      corePackageVersion: nonEmpty(managerValue.corePackageVersion, "$expectations.manager.corePackageVersion"),
      sdkPackageVersion: nonEmpty(managerValue.sdkPackageVersion, "$expectations.manager.sdkPackageVersion"),
      toolManifestDigest: digest(managerValue.toolManifestDigest, "$expectations.manager.toolManifestDigest"),
      resourceProfileDigest: digest(managerValue.resourceProfileDigest, "$expectations.manager.resourceProfileDigest"),
      capabilityDigest: digest(managerValue.capabilityDigest, "$expectations.manager.capabilityDigest"),
      verifiedNotBefore,
      verifiedNotAfter,
    },
  };
}

async function readEvidence(reader: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    return await Reflect.apply(reader, undefined, []);
  } catch {
    return undefined;
  }
}

type ParsedBroker = { identity: BrokerIdentityRecord };

function checkBroker(value: unknown, expectations: BossPreflightExpectations | undefined): { check: BossPreflightCheck; parsed?: ParsedBroker } {
  if (value === undefined || value === null) return { check: fail(0, "BOSS_PREFLIGHT_BROKER_EVIDENCE_UNAVAILABLE", REMEDIATION.broker) };
  if (!expectations) return { check: fail(0, "BOSS_PREFLIGHT_BROKER_ATTESTATION_REJECTED", REMEDIATION.broker) };
  try {
    assertOwnDataTree(value);
    const record = ownRecord(value, ["identity"], "$brokerEvidence");
    const identity = parseBrokerIdentityRecord(record.identity);
    const decision = verifyProtectedBrokerIdentity(record.identity, expectations.brokerVerificationContext);
    if (!decision.accepted) return { check: fail(0, "BOSS_PREFLIGHT_BROKER_ATTESTATION_REJECTED", REMEDIATION.broker) };
    return { check: pass(0), parsed: { identity } };
  } catch {
    return { check: fail(0, "BOSS_PREFLIGHT_BROKER_EVIDENCE_INVALID", REMEDIATION.broker) };
  }
}

type ManagerCredentialAttestation = {
  credentialId: string;
  bossRunId: string;
  managerParticipantId: string;
  controllerPrincipalId: string;
  controllerGeneration: number;
  bindingEpoch: number;
  authorityTransitionId: string;
  brokerGeneration: number;
  brokerBootInstance: string;
};

function parseManagerCredential(value: unknown): ManagerCredentialAttestation {
  const v = ownRecord(value, [
    "version", "credentialId", "bossRunId", "managerParticipantId", "controllerPrincipalId", "controllerGeneration",
    "bindingEpoch", "scope", "state", "authorityTransitionId", "brokerGeneration", "brokerBootInstance",
  ], "$controllerEvidence.managerCredential");
  if (v.version !== BOSS_MANAGER_CREDENTIAL_ATTESTATION_VERSION || v.scope !== "manager" || v.state !== "active") throw new Error("Manager credential attestation is not active");
  return {
    credentialId: nonEmpty(v.credentialId, "$.credentialId"),
    bossRunId: nonEmpty(v.bossRunId, "$.bossRunId"),
    managerParticipantId: nonEmpty(v.managerParticipantId, "$.managerParticipantId"),
    controllerPrincipalId: nonEmpty(v.controllerPrincipalId, "$.controllerPrincipalId"),
    controllerGeneration: positiveInteger(v.controllerGeneration, "$.controllerGeneration"),
    bindingEpoch: positiveInteger(v.bindingEpoch, "$.bindingEpoch"),
    authorityTransitionId: nonEmpty(v.authorityTransitionId, "$.authorityTransitionId"),
    brokerGeneration: positiveInteger(v.brokerGeneration, "$.brokerGeneration"),
    brokerBootInstance: nonEmpty(v.brokerBootInstance, "$.brokerBootInstance"),
  };
}

type ParsedController = {
  authority: BossRunAuthorityIdentity;
  controllerServiceUid: number;
  managerCredential: ManagerCredentialAttestation;
};

function checkController(value: unknown, broker?: ParsedBroker, expectations?: BossPreflightExpectations): { check: BossPreflightCheck; parsed?: ParsedController } {
  if (value === undefined || value === null) return { check: fail(1, "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_UNAVAILABLE", REMEDIATION.controller) };
  try {
    assertOwnDataTree(value);
    const v = ownRecord(value, [
      "version", "interactiveOwnerUid", "controllerServiceUid", "authorityIdentity", "brokerGeneration", "brokerBootInstance",
      "authorityPeerExpectation", "observedAuthorityPeer", "managerCredential",
    ], "$controllerEvidence");
    if (v.version !== BOSS_CONTROLLER_EVIDENCE_VERSION) throw new Error("Unsupported Controller evidence version");
    const interactiveOwnerUid = uid(v.interactiveOwnerUid, "$.interactiveOwnerUid");
    const controllerServiceUid = uid(v.controllerServiceUid, "$.controllerServiceUid");
    const brokerGeneration = positiveInteger(v.brokerGeneration, "$.brokerGeneration");
    const brokerBootInstance = nonEmpty(v.brokerBootInstance, "$.brokerBootInstance");
    const authority = parseBossRunAuthorityIdentity(v.authorityIdentity);
    const expectation = parseBrokerPeerExpectation(v.authorityPeerExpectation);
    const observed = parseObservedBrokerPeer(v.observedAuthorityPeer);
    const managerCredential = parseManagerCredential(v.managerCredential);
    const brokerIdentity = broker?.identity;
    const brokerUid = brokerIdentity?.protectedServiceUid ?? expectation.expectedBrokerServiceUid;
    if (controllerServiceUid === interactiveOwnerUid || controllerServiceUid === brokerUid || brokerUid === interactiveOwnerUid) {
      return { check: fail(1, "BOSS_PREFLIGHT_CONTROLLER_UID_BOUNDARY_INVALID", REMEDIATION.controller) };
    }
    const peerDecision = authorizeBrokerPeer(expectation, observed);
    if (!peerDecision.allowed
      || expectation.endpointClass !== "authority"
      || expectation.ownerUid !== interactiveOwnerUid
      || expectation.ownerUid !== brokerIdentity?.ownerUid
      || expectation.expectedControllerUid !== controllerServiceUid) {
      return { check: fail(1, "BOSS_PREFLIGHT_CONTROLLER_AUTHORITY_PEER_DENIED", REMEDIATION.controller) };
    }
    if (!brokerIdentity
      || !expectations
      || interactiveOwnerUid !== expectations.authority.interactiveOwnerUid
      || controllerServiceUid !== expectations.authority.controllerServiceUid
      || authority.bossRunId !== expectations.authority.bossRunId
      || authority.controllerPrincipalId !== expectations.authority.controllerPrincipalId
      || authority.controllerGeneration !== expectations.authority.controllerGeneration
      || authority.bossBindingEpoch !== expectations.authority.bossBindingEpoch
      || brokerGeneration !== expectations.authority.brokerGeneration
      || brokerBootInstance !== expectations.authority.brokerBootInstance
      || managerCredential.managerParticipantId !== expectations.authority.managerParticipantId
      || managerCredential.authorityTransitionId !== expectations.authority.managerCredentialAuthorityTransitionId
      || brokerIdentity.ownerUid !== interactiveOwnerUid
      || brokerIdentity.protectedServiceUid !== expectation.expectedBrokerServiceUid
      || brokerIdentity.processId !== expectation.expectedBrokerProcessId
      || brokerIdentity.brokerGeneration !== brokerGeneration
      || brokerIdentity.bootInstance !== brokerBootInstance
      || managerCredential.bossRunId !== authority.bossRunId
      || managerCredential.controllerPrincipalId !== authority.controllerPrincipalId
      || managerCredential.controllerGeneration !== authority.controllerGeneration
      || managerCredential.bindingEpoch !== authority.bossBindingEpoch
      || managerCredential.brokerGeneration !== brokerGeneration
      || managerCredential.brokerBootInstance !== brokerBootInstance) {
      return { check: fail(1, "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_MISMATCH", REMEDIATION.controller) };
    }
    return { check: pass(1), parsed: { authority, controllerServiceUid, managerCredential } };
  } catch {
    return { check: fail(1, "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_INVALID", REMEDIATION.controller) };
  }
}

type ParsedTransition = { projection: BossAuthorityTransitionProjectionV1 };

function checkTransition(value: unknown, controller?: ParsedController, expectations?: BossPreflightExpectations): { check: BossPreflightCheck; parsed?: ParsedTransition } {
  if (value === undefined || value === null) return { check: fail(2, "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_UNAVAILABLE", REMEDIATION.transition) };
  try {
    assertOwnDataTree(value);
    const v = ownRecord(value, ["version", "brokerTransition", "brokerEvent", "controllerProjection"], "$transitionEvidence");
    if (v.version !== BOSS_AUTHORITY_TRANSITION_EVIDENCE_VERSION) throw new Error("Unsupported transition evidence version");
    const transition: AuthorityTransitionRecord = parseAuthorityTransitionRecord(v.brokerTransition);
    const event: AuthorityTransitionEvent = parseAuthorityTransitionEvent(v.brokerEvent);
    const projection = parseBossAuthorityTransitionProjectionV1(v.controllerProjection);
    if (transition.state !== "committed" || event.state !== "committed" || projection.brokerState !== "committed") {
      return { check: fail(2, "BOSS_PREFLIGHT_TRANSITION_NOT_COMMITTED", REMEDIATION.transition) };
    }
    if (projection.projectionState !== "reconciled") {
      return { check: fail(2, "BOSS_PREFLIGHT_TRANSITION_NOT_RECONCILED", REMEDIATION.transition) };
    }
    const authority = controller?.authority;
    if (!authority
      || !expectations
      || transition.authorityTransitionId !== expectations.authority.controllerAuthorityTransitionId
      || transition.operation !== "controller_takeover"
      || event.operation !== transition.operation
      || projection.operation !== transition.operation
      || canonicalBossJson(event.target) !== canonicalBossJson(transition.target)
      || canonicalBossJson(event.prior) !== canonicalBossJson(transition.prior)
      || canonicalBossJson(event.resulting) !== canonicalBossJson(transition.proposed)
      || transition.authorityTransitionId !== event.authorityTransitionId
      || transition.authorityTransitionId !== projection.authorityTransitionId
      || transition.brokerRevision !== event.brokerRevision
      || transition.brokerRevision !== projection.brokerRevision
      || transition.expectedBrokerRevision !== projection.expectedBrokerRevision
      || transition.idempotencyKey !== projection.idempotencyKey
      || transition.target.bossRunId !== authority.bossRunId
      || event.bossRunId !== authority.bossRunId
      || projection.bossRunId !== authority.bossRunId
      || transition.target.controllerPrincipalId !== authority.controllerPrincipalId
      || event.target.controllerPrincipalId !== authority.controllerPrincipalId
      || projection.targetKind !== "controller"
      || projection.targetId !== authority.controllerPrincipalId
      || transition.proposed.controllerGeneration !== authority.controllerGeneration
      || event.resulting.controllerGeneration !== authority.controllerGeneration
      || projection.resultingControllerGeneration !== authority.controllerGeneration
      || projection.priorControllerGeneration !== transition.prior.controllerGeneration
      || projection.priorControllerGeneration !== event.prior.controllerGeneration
      || authority.authorityTransitionRevision !== transition.brokerRevision
      || event.occurredAt !== transition.committedAt
      || projection.preparedAt !== transition.preparedAt
      || projection.committedAt !== transition.committedAt
      || projection.prepareTokenDigest !== sha256BossValue("orc-boss-prepare-token-v1", transition.prepareToken)) {
      return { check: fail(2, "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_MISMATCH", REMEDIATION.transition) };
    }
    return { check: pass(2), parsed: { projection } };
  } catch {
    return { check: fail(2, "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_INVALID", REMEDIATION.transition) };
  }
}

type AdapterRecord = {
  id: (typeof BOSS_PREFLIGHT_ADAPTERS)[number]["id"];
  packageName: string;
  packageVersion: string;
  releaseId: string;
  featureContract: ReturnType<typeof parseBossRunFeatureContract>;
  protocolFeatureContractHash: string;
  capabilityDigest: string;
};

function parseAdapter(value: unknown, index: number): AdapterRecord {
  const v = ownRecord(value, [
    "id", "packageName", "packageVersion", "releaseId", "featureContract", "protocolFeatureContractHash", "capabilityDigest",
  ], `$inventoryEvidence.adapters[${index}]`);
  const expected = BOSS_PREFLIGHT_ADAPTERS.find((entry) => entry.id === v.id);
  if (!expected || v.packageName !== expected.packageName) throw new Error("Adapter identity substitution");
  return {
    id: expected.id,
    packageName: expected.packageName,
    packageVersion: nonEmpty(v.packageVersion, "$.packageVersion"),
    releaseId: nonEmpty(v.releaseId, "$.releaseId"),
    featureContract: parseBossRunFeatureContract(v.featureContract),
    protocolFeatureContractHash: digest(v.protocolFeatureContractHash, "$.protocolFeatureContractHash"),
    capabilityDigest: digest(v.capabilityDigest, "$.capabilityDigest"),
  };
}

type ManagerInventory = {
  bossRunId: string;
  managerParticipantId: string;
  controllerPrincipalId: string;
  controllerGeneration: number;
  authorityTransitionId: string;
  brokerGeneration: number;
  brokerBootInstance: string;
  adapterReleaseId: string;
  adapterInventoryDigest: string;
  corePackageVersion: string;
  sdkPackageVersion: string;
  toolManifestDigest: string;
  resourceProfileDigest: string;
  capabilityDigest: string;
  verifiedAt: string;
};

function parseManagerInventory(value: unknown): ManagerInventory {
  const v = ownRecord(value, [
    "version", "bossRunId", "managerParticipantId", "controllerPrincipalId", "controllerGeneration", "authorityTransitionId",
    "brokerGeneration", "brokerBootInstance", "adapterReleaseId", "adapterInventoryDigest", "corePackageVersion", "sdkPackageVersion",
    "harness", "model", "effort", "permissionProfile", "fallback", "toolManifestDigest", "resourceProfileDigest", "capabilityDigest",
    "status", "verifiedAt",
  ], "$inventoryEvidence.managerInventory");
  if (v.version !== BOSS_MANAGER_INVENTORY_ATTESTATION_VERSION || v.status !== "verified"
    || v.harness !== "pi" || v.model !== "codex/gpt-5.6-sol" || v.effort !== "high"
    || v.permissionProfile !== "manager-restricted" || v.fallback !== false) throw new Error("Manager inventory is not the exact verified profile");
  const corePackageVersion = nonEmpty(v.corePackageVersion, "$.corePackageVersion");
  const sdkPackageVersion = nonEmpty(v.sdkPackageVersion, "$.sdkPackageVersion");
  const toolManifestDigest = digest(v.toolManifestDigest, "$.toolManifestDigest");
  const resourceProfileDigest = digest(v.resourceProfileDigest, "$.resourceProfileDigest");
  const capabilityDigest = digest(v.capabilityDigest, "$.capabilityDigest");
  const verifiedAt = timestamp(v.verifiedAt, "$.verifiedAt");
  return {
    bossRunId: nonEmpty(v.bossRunId, "$.bossRunId"),
    managerParticipantId: nonEmpty(v.managerParticipantId, "$.managerParticipantId"),
    controllerPrincipalId: nonEmpty(v.controllerPrincipalId, "$.controllerPrincipalId"),
    controllerGeneration: positiveInteger(v.controllerGeneration, "$.controllerGeneration"),
    authorityTransitionId: nonEmpty(v.authorityTransitionId, "$.authorityTransitionId"),
    brokerGeneration: positiveInteger(v.brokerGeneration, "$.brokerGeneration"),
    brokerBootInstance: nonEmpty(v.brokerBootInstance, "$.brokerBootInstance"),
    adapterReleaseId: nonEmpty(v.adapterReleaseId, "$.adapterReleaseId"),
    adapterInventoryDigest: digest(v.adapterInventoryDigest, "$.adapterInventoryDigest"),
    corePackageVersion,
    sdkPackageVersion,
    toolManifestDigest,
    resourceProfileDigest,
    capabilityDigest,
    verifiedAt,
  };
}

function checkInventory(
  value: unknown,
  broker?: ParsedBroker,
  controller?: ParsedController,
  transition?: ParsedTransition,
  expectations?: BossPreflightExpectations,
): { check: BossPreflightCheck } {
  if (value === undefined || value === null) return { check: fail(3, "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_UNAVAILABLE", REMEDIATION.inventory) };
  if (!expectations) return { check: fail(3, "BOSS_PREFLIGHT_INVENTORY_EXPECTATIONS_UNAVAILABLE", REMEDIATION.inventory) };
  try {
    assertOwnDataTree(value);
    const v = ownRecord(value, ["version", "adapters", "managerInventory"], "$inventoryEvidence");
    if (v.version !== BOSS_ADAPTER_INVENTORY_EVIDENCE_VERSION) throw new Error("Unsupported inventory evidence version");
    const entries = denseArray(v.adapters, "$inventoryEvidence.adapters");
    const adapters = entries.map(parseAdapter);
    if (adapters.length !== BOSS_PREFLIGHT_ADAPTERS.length
      || new Set(adapters.map((entry) => entry.id)).size !== BOSS_PREFLIGHT_ADAPTERS.length
      || BOSS_PREFLIGHT_ADAPTERS.some((expected) => !adapters.some((entry) => entry.id === expected.id && entry.packageName === expected.packageName))) {
      return { check: fail(3, "BOSS_PREFLIGHT_ADAPTER_SET_MISMATCH", REMEDIATION.inventory) };
    }
    const releases = new Set(adapters.map((entry) => entry.releaseId));
    if (releases.size !== 1) return { check: fail(3, "BOSS_PREFLIGHT_ADAPTER_RELEASE_MISMATCH", REMEDIATION.inventory) };
    if (adapters.some((entry) => {
      const expected = expectations.adapters.find((candidate) => candidate.id === entry.id);
      return !expected || expected.packageName !== entry.packageName || expected.packageVersion !== entry.packageVersion || expected.releaseId !== entry.releaseId;
    })) return { check: fail(3, "BOSS_PREFLIGHT_ADAPTER_RELEASE_MISMATCH", REMEDIATION.inventory) };
    if (adapters.some((entry) => entry.featureContract.feature !== BOSS_RUN_FEATURE
      || entry.featureContract.version !== BOSS_RUN_FEATURE_VERSION
      || entry.featureContract.semanticsHash !== BOSS_RUN_FEATURE_SEMANTICS_HASH
      || entry.featureContract.controlEnvelopeVersion !== BOSS_CONTROL_ENVELOPE_VERSION
      || entry.protocolFeatureContractHash !== BOSS_RUN_PROTOCOL_FEATURE_CONTRACT_HASH
      || entry.capabilityDigest !== BOSS_CAPABILITY_FEATURE_DIGEST)) {
      return { check: fail(3, "BOSS_PREFLIGHT_ADAPTER_FEATURE_MISMATCH", REMEDIATION.inventory) };
    }
    const manager = parseManagerInventory(v.managerInventory);
    const authority = controller?.authority;
    const credential = controller?.managerCredential;
    const projection = transition?.projection;
    const identity = broker?.identity;
    const canonicalAdapters = [...adapters].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    if (!authority || !credential || !projection || !identity
      || manager.bossRunId !== authority.bossRunId
      || manager.managerParticipantId !== credential.managerParticipantId
      || manager.controllerPrincipalId !== authority.controllerPrincipalId
      || manager.controllerGeneration !== authority.controllerGeneration
      || manager.authorityTransitionId !== projection.authorityTransitionId
      || manager.brokerGeneration !== identity.brokerGeneration
      || manager.brokerBootInstance !== identity.bootInstance
      || manager.adapterReleaseId !== adapters[0]!.releaseId
      || manager.adapterInventoryDigest !== sha256BossValue("orc-boss-adapter-inventory-v1", canonicalAdapters)
      || manager.corePackageVersion !== expectations.manager.corePackageVersion
      || manager.sdkPackageVersion !== expectations.manager.sdkPackageVersion
      || manager.toolManifestDigest !== expectations.manager.toolManifestDigest
      || manager.resourceProfileDigest !== expectations.manager.resourceProfileDigest
      || manager.capabilityDigest !== expectations.manager.capabilityDigest
      || Date.parse(manager.verifiedAt) < Date.parse(expectations.manager.verifiedNotBefore)
      || Date.parse(manager.verifiedAt) > Date.parse(expectations.manager.verifiedNotAfter)) {
      return { check: fail(3, "BOSS_PREFLIGHT_MANAGER_INVENTORY_MISMATCH", REMEDIATION.inventory) };
    }
    return { check: pass(3) };
  } catch {
    return { check: fail(3, "BOSS_PREFLIGHT_INVENTORY_EVIDENCE_INVALID", REMEDIATION.inventory) };
  }
}

const unavailable = (): undefined => undefined;

/**
 * Deliberately unavailable until authenticated protected broker/Controller clients exist.
 * This object performs no discovery and guesses no filesystem path, uid, endpoint, or secret.
 */
export const BOSS_PRODUCTION_PREFLIGHT_DEPENDENCIES: BossPreflightDependencies = Object.freeze({
  getProtectedBrokerEvidence: unavailable,
  getControllerAuthorityEvidence: unavailable,
  getAuthorityTransitionEvidence: unavailable,
  getAdapterInventoryEvidence: unavailable,
});

export async function runBossProtectedPreflight(
  dependencies: BossPreflightDependencies = BOSS_PRODUCTION_PREFLIGHT_DEPENDENCIES,
  expectationValue?: BossPreflightExpectations,
): Promise<BossPreflightResult> {
  let readers: Record<DependencyName, () => unknown | Promise<unknown>>;
  try {
    readers = exactDependencies(dependencies);
  } catch {
    const checks = BOSS_PROTECTED_PREREQUISITES.map((_, index) => fail(index, "BOSS_PREFLIGHT_DEPENDENCIES_INVALID", REMEDIATION.dependencies));
    return { version: BOSS_PREFLIGHT_RESULT_VERSION, ready: false, checks };
  }

  let expectations: BossPreflightExpectations | undefined;
  try {
    expectations = parseExpectations(expectationValue);
  } catch {
    expectations = undefined;
  }

  if (!expectations) {
    const checks = [
      fail(0, "BOSS_PREFLIGHT_BROKER_EVIDENCE_UNAVAILABLE", REMEDIATION.broker),
      fail(1, "BOSS_PREFLIGHT_CONTROLLER_EVIDENCE_UNAVAILABLE", REMEDIATION.controller),
      fail(2, "BOSS_PREFLIGHT_TRANSITION_EVIDENCE_UNAVAILABLE", REMEDIATION.transition),
      fail(3, "BOSS_PREFLIGHT_INVENTORY_EXPECTATIONS_UNAVAILABLE", REMEDIATION.inventory),
    ] as const;
    return { version: BOSS_PREFLIGHT_RESULT_VERSION, ready: false, checks };
  }

  const [brokerValue, controllerValue, transitionValue, inventoryValue] = await Promise.all([
    readEvidence(readers.getProtectedBrokerEvidence),
    readEvidence(readers.getControllerAuthorityEvidence),
    readEvidence(readers.getAuthorityTransitionEvidence),
    readEvidence(readers.getAdapterInventoryEvidence),
  ]);
  const broker = checkBroker(brokerValue, expectations);
  const controller = checkController(controllerValue, broker.parsed, expectations);
  const transition = checkTransition(transitionValue, controller.parsed, expectations);
  const inventory = checkInventory(inventoryValue, broker.parsed, controller.parsed, transition.parsed, expectations);
  const checks = [broker.check, controller.check, transition.check, inventory.check] as const;
  return { version: BOSS_PREFLIGHT_RESULT_VERSION, ready: checks.every((check) => check.ready), checks };
}
