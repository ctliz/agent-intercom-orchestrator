import { createPublicKey, KeyObject } from "node:crypto";
import { posix as posixPath } from "node:path";
import { isProxy } from "node:util/types";
import {
  BROKER_PROTECTED_PROVIDER_ROOT,
  type BrokerProviderAttestation,
} from "@dataforxyz/agent-intercom-core/boss";

export const BOSS_PROTECTED_SERVICE_MANIFEST_VERSION = "orc.boss-protected-service-manifest.v1" as const;
export const BOSS_PROTECTED_SERVICE_RELEASE_AUTHORITY_VERSION = "orc.boss-protected-service-release-authority.v1" as const;
export const BOSS_PROTECTED_SERVICE_PLAN_VERSION = "orc.boss-protected-service-plan.v1" as const;

export const BOSS_PROTECTED_SERVICE_PROVIDERS = Object.freeze([
  Object.freeze({ id: "pi", packageName: "@dataforxyz/agent-intercom-pi" }),
  Object.freeze({ id: "codex", packageName: "@dataforxyz/agent-intercom-codex" }),
  Object.freeze({ id: "claude", packageName: "@dataforxyz/agent-intercom-claude" }),
  Object.freeze({ id: "opencode", packageName: "@dataforxyz/agent-intercom-opencode" }),
] as const);

export const BOSS_PROTECTED_SERVICE_PATHS = Object.freeze({
  providerRoot: "/usr/lib/agent-intercom/providers",
  brokerStateRoot: "/var/lib/agent-intercom/brokers",
  controllerStateRoot: "/var/lib/agent-intercom/controllers",
  runtimeRoot: "/run/agent-intercom",
} as const);

export const BOSS_PROTECTED_SERVICE_UNIT_TEMPLATES = Object.freeze({
  broker: "agent-intercom-broker@.service",
  controller: "agent-intercom-controller@.service",
} as const);

export type BossProtectedProviderId = (typeof BOSS_PROTECTED_SERVICE_PROVIDERS)[number]["id"];

export interface BossProtectedProviderExpectation {
  adapterId: BossProtectedProviderId;
  providerPackage: string;
  providerVersion: string;
  providerDigest: string;
  artifactPath: string;
  artifactOwnerUid: number;
  artifactOwnerGid: number;
  artifactMode: string;
}

export interface BossProtectedProviderAttestationEntry {
  adapterId: BossProtectedProviderId;
  attestation: BrokerProviderAttestation;
}

export interface BossProtectedServiceManifestV1 {
  version: typeof BOSS_PROTECTED_SERVICE_MANIFEST_VERSION;
  targetPlatform: "linux";
  selectedProviderId: BossProtectedProviderId;
  providerAttestations: readonly BossProtectedProviderAttestationEntry[];
}

export interface BossProtectedServiceReleaseAuthorityInputV1 {
  interactiveOwnerName: string;
  interactiveOwnerUid: number;
  interactiveOwnerGid: number;
  brokerServiceName: string;
  brokerServiceUid: number;
  brokerServiceGid: number;
  controllerServiceName: string;
  controllerServiceUid: number;
  controllerServiceGid: number;
  version: typeof BOSS_PROTECTED_SERVICE_RELEASE_AUTHORITY_VERSION;
  trustedReleaseKeys: Readonly<Record<string, KeyObject | string>>;
  expectedProviders: readonly BossProtectedProviderExpectation[];
}

export interface BossProtectedServiceReleaseAuthorityCandidate extends BossProtectedServiceReleaseAuthorityInputV1 {}

export interface BossVerifiedProtectedProvider extends BossProtectedProviderExpectation {
  attestedAt: string;
  attestationKeyId: string;
  signature: string;
}

export interface BossProtectedDirectoryAssertion {
  resourceType: "directory" | "directory_template";
  purpose: "protected_ancestor" | "provider_root" | "provider_directory" | "broker_state" | "controller_state" | "runtime";
  path: string;
  expectedOwnerUid: number;
  expectedOwnerGid: number;
  expectedMode: "0555" | "0700" | "0711" | "0755";
  mustNotBeSymlink: true;
  requiredTraverseUids: readonly number[];
  requiredMutateUids: readonly number[];
  forbiddenMutateUids: readonly number[];
}

export interface BossProtectedSocketAssertion {
  resourceType: "unix_socket";
  purpose: "public_endpoint" | "authority_endpoint";
  path: string;
  expectedOwnerUid: number;
  expectedOwnerGid: number;
  expectedBaseMode: "0600";
  mustNotBeSymlink: true;
  requiredConnectUidAcl: readonly number[];
  forbiddenConnectUids: readonly number[];
}

export interface BossProtectedProviderArtifactAssertion {
  resourceType: "provider_artifact";
  providerId: BossProtectedProviderId;
  path: string;
  expectedOwnerUid: 0;
  expectedOwnerGid: 0;
  expectedMode: "0555";
  mustNotBeSymlink: true;
  expectedSha256: string;
  requiredReadExecuteUids: readonly number[];
  forbiddenWriteUids: readonly number[];
}

export interface BossProtectedServiceInstallPlanV1 {
  version: typeof BOSS_PROTECTED_SERVICE_PLAN_VERSION;
  targetPlatform: "linux";
  identities: {
    interactiveOwner: { name: string; uid: number; gid: number };
    brokerService: { name: string; uid: number; gid: number };
    controllerService: { name: string; uid: number; gid: number };
  };
  providers: readonly BossVerifiedProtectedProvider[];
  selectedProviderId: BossProtectedProviderId;
  paths: {
    providerRoot: typeof BOSS_PROTECTED_SERVICE_PATHS.providerRoot;
    brokerStateDirectory: string;
    controllerStateDirectoryTemplate: string;
    runtimeDirectory: string;
    publicEndpoint: string;
    authorityEndpoint: string;
  };
  serviceUnits: {
    brokerTemplate: typeof BOSS_PROTECTED_SERVICE_UNIT_TEMPLATES.broker;
    brokerInstance: string;
    controllerTemplate: typeof BOSS_PROTECTED_SERVICE_UNIT_TEMPLATES.controller;
  };
  assertions: {
    directories: readonly BossProtectedDirectoryAssertion[];
    sockets: readonly BossProtectedSocketAssertion[];
    providerArtifacts: readonly BossProtectedProviderArtifactAssertion[];
  };
}

export type BossProtectedServicePlanErrorCode =
  | "BOSS_AUTHORITY_UNAVAILABLE"
  | "INVALID_MANIFEST"
  | "UNSUPPORTED_PLATFORM"
  | "INVALID_SERVICE_IDENTITY"
  | "INVALID_TRUST_STORE"
  | "PROVIDER_SET_MISMATCH"
  | "PROVIDER_TUPLE_INVALID"
  | "PROVIDER_TUPLE_CONFLICT"
  | "PROVIDER_ATTESTATION_INVALID"
  | "PROVIDER_ATTESTATION_REJECTED"
  | "SELECTED_PROVIDER_INVALID";

export class BossProtectedServicePlanError extends Error {
  readonly code: BossProtectedServicePlanErrorCode;
  readonly path: string;

  constructor(code: BossProtectedServicePlanErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "BossProtectedServicePlanError";
    this.code = code;
    this.path = path;
  }
}

type OwnDataRecord = Record<string, unknown>;

const INTRINSIC_STRUCTURED_CLONE = globalThis.structuredClone;
const KEY_OBJECT_TYPE_GETTER = Object.getOwnPropertyDescriptor(KeyObject.prototype, "type")!.get!;
const PUBLIC_KEY_EXPORT = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(createPublicKey(
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAnmdmU8vimbDrDOfIKaNGgXp9wgs39vnXi5+CfHs4Cdw=\n-----END PUBLIC KEY-----\n",
)), "export")!.value as (options: { type: "spki"; format: "der" }) => Buffer;
const PROVIDER_IDS = BOSS_PROTECTED_SERVICE_PROVIDERS.map((provider) => provider.id);
const EXPECTED_PROVIDER_MODE = "0555" as const;
const MAX_LINUX_ID = 0x7fff_ffff;
const MAX_DATA_TREE_DEPTH = 64;
const MAX_DATA_TREE_WORK_UNITS = 4_096;
const MAX_DATA_ARRAY_LENGTH = 256;

function fail(code: BossProtectedServicePlanErrorCode, path: string, message: string): never {
  throw new BossProtectedServicePlanError(code, path, message);
}

function assertOwnDataTree(
  value: unknown,
  path = "$",
  code: BossProtectedServicePlanErrorCode = "INVALID_MANIFEST",
  allowKeyObjects = false,
): void {
  const seen = new Set<object>();
  const stack: Array<{ value: unknown; path: string; depth: number }> = [{ value, path, depth: 0 }];
  let workUnits = 0;
  const account = (count: number, currentPath: string): void => {
    workUnits += count;
    if (workUnits > MAX_DATA_TREE_WORK_UNITS) {
      fail(code, currentPath, `exceeds maximum data traversal work ${MAX_DATA_TREE_WORK_UNITS}`);
    }
  };
  while (stack.length > 0) {
    const current = stack.pop()!;
    account(1, current.path);
    if (current.depth > MAX_DATA_TREE_DEPTH) fail(code, current.path, `exceeds maximum data depth ${MAX_DATA_TREE_DEPTH}`);
    if (current.value === null || ["string", "number", "boolean", "undefined"].includes(typeof current.value)) continue;
    if (typeof current.value !== "object") fail(code, current.path, "must contain only data values");
    if (isProxy(current.value)) fail(code, current.path, "must not contain a proxy");
    if (seen.has(current.value)) fail(code, current.path, "must not contain cycles or object aliases");
    seen.add(current.value);

    if (current.value instanceof KeyObject) {
      if (!allowKeyObjects) fail(code, current.path, "must not contain opaque key objects");
      for (const key of Reflect.ownKeys(current.value)) {
        if (typeof key === "string") fail(code, current.path, "KeyObject values must not carry custom string properties");
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      const entries = denseArray(current.value, current.path, code);
      account(entries.length, current.path);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        stack.push({ value: entries[index], path: `${current.path}[${index}]`, depth: current.depth + 1 });
      }
      continue;
    }
    if (Object.getPrototypeOf(current.value) !== Object.prototype) {
      fail(code, current.path, "must not contain inherited or opaque objects");
    }
    const children: Array<{ value: unknown; path: string; depth: number }> = [];
    for (const key of Reflect.ownKeys(current.value)) {
      account(1, current.path);
      if (typeof key !== "string") fail(code, current.path, "must not contain symbol properties");
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        fail(code, `${current.path}.${key}`, "must be an enumerable own data property");
      }
      children.push({ value: descriptor.value, path: `${current.path}.${key}`, depth: current.depth + 1 });
    }
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]!);
  }
}

function ownRecord(
  value: unknown,
  required: readonly string[],
  path: string,
  code: BossProtectedServicePlanErrorCode = "INVALID_MANIFEST",
): OwnDataRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(code, path, "must be a non-proxy plain object");
  }
  const allowed = new Set(required);
  const result: OwnDataRecord = Object.create(null) as OwnDataRecord;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(code, path, "must not have symbol properties");
    if (!allowed.has(key)) fail(code, `${path}.${key}`, "is not supported");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${path}.${key}`, "must be an enumerable own data property");
    }
    result[key] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.hasOwn(result, key)) fail(code, `${path}.${key}`, "is required");
  }
  return result;
}

function denseArray(value: unknown, path: string, code: BossProtectedServicePlanErrorCode = "INVALID_MANIFEST"): unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(code, path, "must be a non-proxy plain array");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    fail(code, path, "must have a valid own data length");
  }
  const length = lengthDescriptor.value as number;
  if (length > MAX_DATA_ARRAY_LENGTH) fail(code, path, `must not exceed ${MAX_DATA_ARRAY_LENGTH} entries`);
  const descriptors = new Map<number, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) fail(code, path, "must not have symbol or non-index properties");
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= length) fail(code, `${path}.${key}`, "is outside the array length");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${path}[${index}]`, "must be an enumerable own data property");
    }
    descriptors.set(index, descriptor);
  }
  if (descriptors.size !== length) {
    for (let index = 0; index < length; index += 1) {
      if (!descriptors.has(index)) fail(code, `${path}[${index}]`, "sparse array holes are not supported");
    }
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) result.push(descriptors.get(index)!.value);
  return result;
}

function wellFormed(value: string, path: string, code: BossProtectedServicePlanErrorCode): string {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(code, path, "must not contain an unpaired surrogate");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(code, path, "must not contain an unpaired surrogate");
    }
  }
  return value;
}

function boundedString(value: unknown, path: string, code: BossProtectedServicePlanErrorCode, maximum = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) {
    fail(code, path, `must be a non-empty bounded string without control characters`);
  }
  return wellFormed(value, path, code);
}

function providerId(value: unknown, path: string, code: BossProtectedServicePlanErrorCode): BossProtectedProviderId {
  if (typeof value !== "string" || !(PROVIDER_IDS as readonly string[]).includes(value)) {
    fail(code, path, "must identify pi, codex, claude, or opencode");
  }
  return value as BossProtectedProviderId;
}

function digest(value: unknown, path: string, code: BossProtectedServicePlanErrorCode): string {
  const parsed = boundedString(value, path, code, 64);
  if (!/^[a-f0-9]{64}$/.test(parsed)) fail(code, path, "must be a lowercase SHA-256 digest");
  return parsed;
}

function linuxId(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || (value as number) < 1 || (value as number) > MAX_LINUX_ID) {
    fail("INVALID_SERVICE_IDENTITY", path, `must be a positive Linux uid/gid no greater than ${MAX_LINUX_ID}`);
  }
  return value as number;
}

function linuxIdentityName(value: unknown, path: string): string {
  const parsed = boundedString(value, path, "INVALID_SERVICE_IDENTITY", 32);
  if (!/^[a-z_][a-z0-9_-]{0,30}[a-z0-9_$-]$|^[a-z_]$/.test(parsed)) {
    fail("INVALID_SERVICE_IDENTITY", path, "must be an explicit bounded Linux account name");
  }
  return parsed;
}

function safeArtifactPath(value: unknown, path: string, code: BossProtectedServicePlanErrorCode): string {
  const parsed = boundedString(value, path, code, 4_096);
  if (
    !parsed.startsWith(BROKER_PROTECTED_PROVIDER_ROOT)
    || parsed === BROKER_PROTECTED_PROVIDER_ROOT
    || parsed.endsWith("/")
    || parsed.includes("\\")
    || posixPath.normalize(parsed) !== parsed
  ) fail(code, path, `must be a normalized file beneath ${BROKER_PROTECTED_PROVIDER_ROOT}`);
  const segments = parsed.slice(BROKER_PROTECTED_PROVIDER_ROOT.length).split("/");
  if (segments.some((segment) => !/^[A-Za-z0-9@][A-Za-z0-9@._+-]{0,127}$/.test(segment)) || segments.at(-1) !== "provider.mjs") {
    fail(code, path, "must use bounded literal path segments and end in provider.mjs");
  }
  return parsed;
}

function parseTrustedReleaseKeys(value: unknown): Record<string, string> {
  const path = "$authorityCandidate.trustedReleaseKeys";
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("INVALID_TRUST_STORE", path, "must be a non-proxy plain object");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length === 0 || keys.length > 32) fail("INVALID_TRUST_STORE", path, "must contain between one and 32 release keys");
  const result: Record<string, string> = {};
  for (const key of keys) {
    if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.:-]{0,127}$/.test(key)) {
      fail("INVALID_TRUST_STORE", path, "release key identifiers must be bounded ASCII identifiers");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("INVALID_TRUST_STORE", `${path}.${key}`, "must be an enumerable own data property");
    }
    let normalized: string;
    try {
      if (descriptor.value instanceof KeyObject) {
        const cloned = INTRINSIC_STRUCTURED_CLONE(descriptor.value);
        if (!(cloned instanceof KeyObject) || Reflect.apply(KEY_OBJECT_TYPE_GETTER, cloned, []) !== "public") throw new Error("not public");
        const exported = Reflect.apply(PUBLIC_KEY_EXPORT, cloned, [{ type: "spki", format: "der" }]) as Buffer;
        const publicKey = createPublicKey({ key: exported, type: "spki", format: "der" });
        if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("not Ed25519");
        normalized = publicKey.export({ type: "spki", format: "pem" }).toString();
      } else {
        const encoded = typeof descriptor.value === "string" && descriptor.value.length <= 16_384
          ? wellFormed(descriptor.value, `${path}.${key}`, "INVALID_TRUST_STORE")
          : fail("INVALID_TRUST_STORE", `${path}.${key}`, "must be a public Ed25519 KeyObject or bounded PUBLIC KEY PEM");
        if (!/^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----\n?$/.test(encoded)) throw new Error("not PUBLIC KEY PEM");
        const publicKey = createPublicKey(encoded);
        if (publicKey.type !== "public" || publicKey.asymmetricKeyType !== "ed25519") throw new Error("not Ed25519");
        normalized = publicKey.export({ type: "spki", format: "pem" }).toString();
      }
    } catch {
      fail("INVALID_TRUST_STORE", `${path}.${key}`, "must be a public Ed25519 key without custom string properties");
    }
    Object.defineProperty(result, key, { configurable: true, enumerable: true, value: normalized, writable: true });
  }
  return result;
}

function parseExpectedProvider(value: unknown, index: number): BossProtectedProviderExpectation {
  const path = `$authorityCandidate.expectedProviders[${index}]`;
  const v = ownRecord(value, [
    "adapterId", "providerPackage", "providerVersion", "providerDigest", "artifactPath",
    "artifactOwnerUid", "artifactOwnerGid", "artifactMode",
  ], path, "PROVIDER_TUPLE_INVALID");
  const adapterId = providerId(v.adapterId, `${path}.adapterId`, "PROVIDER_SET_MISMATCH");
  const canonical = BOSS_PROTECTED_SERVICE_PROVIDERS.find((provider) => provider.id === adapterId)!;
  const providerPackage = boundedString(v.providerPackage, `${path}.providerPackage`, "PROVIDER_TUPLE_INVALID");
  if (providerPackage !== canonical.packageName) fail("PROVIDER_TUPLE_INVALID", `${path}.providerPackage`, "does not match the canonical adapter package");
  const providerVersion = boundedString(v.providerVersion, `${path}.providerVersion`, "PROVIDER_TUPLE_INVALID", 128);
  if (!/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(providerVersion)) {
    fail("PROVIDER_TUPLE_INVALID", `${path}.providerVersion`, "must be a bounded release version");
  }
  const artifactOwnerUid = v.artifactOwnerUid;
  const artifactOwnerGid = v.artifactOwnerGid;
  const artifactMode = v.artifactMode;
  if (artifactOwnerUid !== 0 || artifactOwnerGid !== 0 || artifactMode !== EXPECTED_PROVIDER_MODE) {
    fail("PROVIDER_TUPLE_INVALID", path, "provider artifacts must be pinned root:root mode 0555");
  }
  const artifactPath = safeArtifactPath(v.artifactPath, `${path}.artifactPath`, "PROVIDER_TUPLE_INVALID");
  const canonicalArtifactPath = `${BROKER_PROTECTED_PROVIDER_ROOT}${adapterId}/provider.mjs`;
  if (artifactPath !== canonicalArtifactPath) {
    fail("PROVIDER_TUPLE_INVALID", `${path}.artifactPath`, `must equal the canonical ${adapterId} provider path`);
  }
  return {
    adapterId,
    providerPackage,
    providerVersion,
    providerDigest: digest(v.providerDigest, `${path}.providerDigest`, "PROVIDER_TUPLE_INVALID"),
    artifactPath,
    artifactOwnerUid: 0,
    artifactOwnerGid: 0,
    artifactMode: EXPECTED_PROVIDER_MODE,
  };
}

function exactProviderSet<T extends { adapterId: BossProtectedProviderId }>(entries: readonly T[], path: string): Map<BossProtectedProviderId, T> {
  if (entries.length !== BOSS_PROTECTED_SERVICE_PROVIDERS.length) {
    fail("PROVIDER_SET_MISMATCH", path, "must contain exactly pi, codex, claude, and opencode");
  }
  const byId = new Map<BossProtectedProviderId, T>();
  for (const entry of entries) {
    if (byId.has(entry.adapterId)) fail("PROVIDER_SET_MISMATCH", path, "must not contain duplicate adapter identifiers");
    byId.set(entry.adapterId, entry);
  }
  if (BOSS_PROTECTED_SERVICE_PROVIDERS.some((provider) => !byId.has(provider.id))) {
    fail("PROVIDER_SET_MISMATCH", path, "must contain exactly pi, codex, claude, and opencode");
  }
  return byId;
}

export function parseBossProtectedServiceReleaseAuthorityCandidate(
  value: unknown,
): BossProtectedServiceReleaseAuthorityCandidate {
  assertOwnDataTree(value, "$authorityCandidate", "INVALID_TRUST_STORE", true);
  const root = ownRecord(value, [
    "version", "interactiveOwnerName", "interactiveOwnerUid", "interactiveOwnerGid",
    "brokerServiceName", "brokerServiceUid", "brokerServiceGid", "controllerServiceName",
    "controllerServiceUid", "controllerServiceGid", "trustedReleaseKeys", "expectedProviders",
  ], "$authorityCandidate", "INVALID_TRUST_STORE");
  if (root.version !== BOSS_PROTECTED_SERVICE_RELEASE_AUTHORITY_VERSION) {
    fail("INVALID_TRUST_STORE", "$authorityCandidate.version", "has an unsupported release-authority candidate version");
  }

  // Parse keys before all other candidate-controlled values. This parser only
  // normalizes untrusted provisioning input; its result is never an authority.
  const trustedReleaseKeys = parseTrustedReleaseKeys(root.trustedReleaseKeys);
  const expectedProviders = denseArray(root.expectedProviders, "$authorityCandidate.expectedProviders", "PROVIDER_SET_MISMATCH").map(parseExpectedProvider);
  exactProviderSet(expectedProviders, "$authorityCandidate.expectedProviders");

  const interactiveOwnerName = linuxIdentityName(root.interactiveOwnerName, "$authorityCandidate.interactiveOwnerName");
  const brokerServiceName = linuxIdentityName(root.brokerServiceName, "$authorityCandidate.brokerServiceName");
  const controllerServiceName = linuxIdentityName(root.controllerServiceName, "$authorityCandidate.controllerServiceName");
  const interactiveOwnerUid = linuxId(root.interactiveOwnerUid, "$authorityCandidate.interactiveOwnerUid");
  const brokerServiceUid = linuxId(root.brokerServiceUid, "$authorityCandidate.brokerServiceUid");
  const controllerServiceUid = linuxId(root.controllerServiceUid, "$authorityCandidate.controllerServiceUid");
  if (new Set([interactiveOwnerName, brokerServiceName, controllerServiceName]).size !== 3) {
    fail("INVALID_SERVICE_IDENTITY", "$authorityCandidate", "interactive owner, broker, and Controller account names must be pairwise distinct");
  }
  if (new Set([interactiveOwnerUid, brokerServiceUid, controllerServiceUid]).size !== 3) {
    fail("INVALID_SERVICE_IDENTITY", "$authorityCandidate", "interactive owner, broker, and Controller UIDs must be pairwise distinct");
  }

  return deepFreeze({
    version: BOSS_PROTECTED_SERVICE_RELEASE_AUTHORITY_VERSION,
    interactiveOwnerName,
    interactiveOwnerUid,
    interactiveOwnerGid: linuxId(root.interactiveOwnerGid, "$authorityCandidate.interactiveOwnerGid"),
    brokerServiceName,
    brokerServiceUid,
    brokerServiceGid: linuxId(root.brokerServiceGid, "$authorityCandidate.brokerServiceGid"),
    controllerServiceName,
    controllerServiceUid,
    controllerServiceGid: linuxId(root.controllerServiceGid, "$authorityCandidate.controllerServiceGid"),
    trustedReleaseKeys,
    expectedProviders,
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

/**
 * Production compilation is deliberately unavailable until a protected
 * provisioner supplies an approved release catalog and authenticated account
 * mappings through a genuinely non-public boundary. The untrusted manifest is
 * never inspected while that authority is absent.
 */
export function compileBossProtectedServiceInstallPlan(_value: unknown): never {
  return fail("BOSS_AUTHORITY_UNAVAILABLE", "$authority", "protected release authority is not installed");
}
