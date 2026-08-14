import { KeyObject } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  authorizeBrokerPeer,
  parseAuthorityTransitionRecord,
  parseAuthorityTransitionRequest,
  parseBrokerIdentityRecord,
  parseBrokerPeerExpectation,
  parseObservedBrokerPeer,
  verifyProtectedBrokerIdentity,
  type AuthorityTransitionRecord,
  type AuthorityTransitionRequest,
  type BrokerIdentityRecord,
  type BrokerIdentityVerificationContext,
  type BrokerPeerExpectation,
  type ObservedBrokerPeer,
} from "@ctliz/agent-intercom-core/boss";
import { canonicalJson } from "@ctliz/agent-intercom-core/canonical";

export type BossAuthorityQueryErrorCode =
  | "invalid_configuration"
  | "invalid_request"
  | "query_in_flight"
  | "transport_unavailable"
  | "invalid_transport_result"
  | "broker_identity_mismatch"
  | "broker_provider_mismatch"
  | "broker_boot_mismatch"
  | "broker_generation_mismatch"
  | "authority_peer_mismatch"
  | "transition_mismatch";

export class BossAuthorityQueryError extends Error {
  readonly code: BossAuthorityQueryErrorCode;
  readonly verificationCode?: string;

  constructor(code: BossAuthorityQueryErrorCode, message: string, cause?: unknown, verificationCode?: string) {
    super(message, { cause: cause instanceof Error ? cause : undefined });
    this.name = "BossAuthorityQueryError";
    this.code = code;
    this.verificationCode = verificationCode;
  }
}

/** All trust anchors and freshness pins are supplied independently of the transport. */
export interface BossAuthorityQueryTrust {
  identityVerification: BrokerIdentityVerificationContext;
  authorityPeerExpectation: BrokerPeerExpectation;
  /** An exact pin. Core's minimumBrokerGeneration remains an additional lower bound. */
  expectedBrokerGeneration: number;
}

/** The only authority-plane dependency. It is intentionally query-specific and has no mutation surface. */
export interface BossProtectedAuthorityQueryDependencies {
  queryProtectedAuthority(request: AuthorityTransitionRequest): unknown | Promise<unknown>;
}

/**
 * Exact transport result. `kernelObservedPeer` must be populated from authenticated OS peer
 * credentials; it is evidence, never a source of trust expectations.
 */
export interface BossProtectedAuthorityQueryTransportResult {
  brokerIdentity: unknown;
  responseData: unknown;
  kernelObservedPeer: unknown;
}

export interface BossAuthorityQueryResult {
  requestId: string;
  authorityTransitionId: string;
  brokerRevision: number;
  brokerIdentity: BrokerIdentityRecord;
  transition: AuthorityTransitionRecord;
}

export interface BossAuthorityQueryClient {
  query(request: AuthorityTransitionRequest): Promise<BossAuthorityQueryResult>;
}

const acceptedBossAuthorityQueryClients = new WeakSet<object>();

/** Returns whether value is a query client constructed and accepted by this module. */
export function isBossAuthorityQueryClient(value: unknown): value is BossAuthorityQueryClient {
  return typeof value === "object"
    && value !== null
    && !isProxy(value)
    && acceptedBossAuthorityQueryClients.has(value);
}

type OwnDataRecord = Record<string, unknown>;

function fail(
  code: BossAuthorityQueryErrorCode,
  message: string,
  cause?: unknown,
  verificationCode?: string,
): never {
  throw new BossAuthorityQueryError(code, message, cause, verificationCode);
}

function exactOwnDataRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
  code: "invalid_configuration" | "invalid_transport_result" = "invalid_configuration",
): OwnDataRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    return fail(code, `${path} must be a non-proxy plain object`);
  }
  const allowed = new Set(keys);
  const projected: OwnDataRecord = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(code, `${path} must not have symbol properties`);
    if (!allowed.has(key)) fail(code, `${path}.${key} is unsupported`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${path}.${key} must be an enumerable own data property`);
    }
    projected[key] = descriptor.value;
  }
  for (const key of keys) {
    if (!Object.hasOwn(projected, key)) fail(code, `${path}.${key} is required`);
  }
  return projected;
}

function dependencyCallback(value: unknown): BossProtectedAuthorityQueryDependencies["queryProtectedAuthority"] {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    return fail("invalid_configuration", "$dependencies must be a non-proxy plain object");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== "queryProtectedAuthority") {
    return fail("invalid_configuration", "$dependencies must expose exactly queryProtectedAuthority");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "queryProtectedAuthority");
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function"
    || isProxy(descriptor.value)) {
    return fail("invalid_configuration", "$dependencies.queryProtectedAuthority must be an enumerable own non-proxy function");
  }
  return descriptor.value as BossProtectedAuthorityQueryDependencies["queryProtectedAuthority"];
}

/**
 * Copies only ordinary, acyclic, unaliased data graphs. This runs before any Core parser can
 * observe caller- or transport-controlled values.
 */
function detachOwnDataTree(
  value: unknown,
  path: string,
  code: "invalid_configuration" | "invalid_request" | "invalid_transport_result",
  seen = new Set<object>(),
  forbidden = new Set<object>(),
  depth = 0,
): unknown {
  if (depth > 128) return fail(code, `${path} exceeds the maximum exact-data depth`);
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "undefined") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(code, `${path} contains a non-finite number`);
    return value;
  }
  if (typeof value !== "object") return fail(code, `${path} contains a non-data value`);
  if (isProxy(value)) return fail(code, `${path} must not contain a Proxy`);
  if (forbidden.has(value)) return fail(code, `${path} aliases protected client input`);
  if (value instanceof KeyObject) {
    if (Reflect.ownKeys(value).length !== 0) fail(code, `${path} KeyObject must not have custom own properties`);
    let keyType: unknown;
    try {
      keyType = Reflect.get(KeyObject.prototype, "type", value);
    } catch (error) {
      return fail(code, `${path} is not a genuine KeyObject`, error);
    }
    if (keyType !== "public") fail(code, `${path} must contain only public KeyObjects`);
    return value;
  }
  if (seen.has(value)) return fail(code, `${path} must not contain cycles or aliases`);
  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(code, `${path} must be a plain array`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
        fail(code, `${path} contains a non-index array property`);
      }
      const descriptor = descriptors[key]!;
      if (Number(key) >= value.length || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        fail(code, `${path}[${key}] must be an enumerable own data property`);
      }
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail(code, `${path}[${index}] must not be sparse`);
      result.push(detachOwnDataTree(descriptor.value, `${path}[${index}]`, code, seen, forbidden, depth + 1));
    }
    return result;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) fail(code, `${path} must contain only plain objects`);
  const result: OwnDataRecord = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(code, `${path} must not contain symbol properties`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${path}.${key} must be an enumerable own data property`);
    }
    Object.defineProperty(result, key, {
      value: detachOwnDataTree(descriptor.value, `${path}.${key}`, code, seen, forbidden, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function collectGraphObjects(value: unknown, objects = new Set<object>()): Set<object> {
  if (typeof value !== "object" || value === null || objects.has(value)) return objects;
  objects.add(value);
  if (value instanceof KeyObject) return objects;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) collectGraphObjects(descriptor.value, objects);
  }
  return objects;
}

function freezeDataTree(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || value instanceof KeyObject || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) freezeDataTree(descriptor.value, seen);
  }
  Object.freeze(value);
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return fail("invalid_configuration", `${path} must be a positive safe integer`);
  }
  return value as number;
}

function parseTrust(value: unknown): BossAuthorityQueryTrust {
  const copied = detachOwnDataTree(value, "$trust", "invalid_configuration") as OwnDataRecord;
  const record = exactOwnDataRecord(copied, [
    "identityVerification",
    "authorityPeerExpectation",
    "expectedBrokerGeneration",
  ], "$trust");
  const expectedBrokerGeneration = positiveInteger(record.expectedBrokerGeneration, "$trust.expectedBrokerGeneration");
  let authorityPeerExpectation: BrokerPeerExpectation;
  try {
    authorityPeerExpectation = parseBrokerPeerExpectation(record.authorityPeerExpectation);
  } catch (error) {
    return fail("invalid_configuration", "authority peer expectation is not an exact Core contract", error);
  }
  if (authorityPeerExpectation.endpointClass !== "authority"
    || authorityPeerExpectation.expectedControllerUid === undefined
    || authorityPeerExpectation.expectedClientUid !== authorityPeerExpectation.expectedControllerUid
    || authorityPeerExpectation.requiresKernelPeerCredentials !== true
    || authorityPeerExpectation.requiresServiceCapability !== true) {
    return fail("invalid_configuration", "authority queries require the exact Controller UID and service capability");
  }
  const verification = exactOwnDataRecord(record.identityVerification, [
    "expectedProviderPackage",
    "expectedProviderVersion",
    "expectedProviderDigest",
    "expectedProviderArtifactRoot",
    "expectedProviderArtifactOwnerUid",
    "expectedProviderArtifactOwnerGid",
    "expectedProviderArtifactMode",
    "expectedOwnerUid",
    "expectedBrokerServiceUid",
    "expectedBootInstance",
    "minimumBrokerGeneration",
    "expectedPublicEndpoint",
    "expectedAuthorityEndpoint",
    "trustedIdentityKeys",
    "trustedProviderKeys",
    "providerAttestation",
  ], "$trust.identityVerification");
  if (!Number.isSafeInteger(verification.minimumBrokerGeneration)
    || (verification.minimumBrokerGeneration as number) < 1
    || (verification.minimumBrokerGeneration as number) > expectedBrokerGeneration) {
    return fail("invalid_configuration", "exact broker generation pin must satisfy the identity freshness floor");
  }
  for (const key of [
    "expectedProviderPackage",
    "expectedProviderVersion",
    "expectedProviderDigest",
    "expectedProviderArtifactRoot",
    "expectedProviderArtifactMode",
    "expectedBootInstance",
    "expectedPublicEndpoint",
    "expectedAuthorityEndpoint",
  ]) {
    if (typeof verification[key] !== "string" || verification[key].length === 0) {
      return fail("invalid_configuration", `$trust.identityVerification.${key} must be a non-empty string`);
    }
  }
  for (const key of [
    "expectedProviderArtifactOwnerUid",
    "expectedProviderArtifactOwnerGid",
    "expectedOwnerUid",
    "expectedBrokerServiceUid",
  ]) {
    if (!Number.isSafeInteger(verification[key]) || (verification[key] as number) < 0) {
      return fail("invalid_configuration", `$trust.identityVerification.${key} must be a non-negative safe integer`);
    }
  }
  if (authorityPeerExpectation.ownerUid !== verification.expectedOwnerUid
    || authorityPeerExpectation.expectedBrokerServiceUid !== verification.expectedBrokerServiceUid) {
    return fail("invalid_configuration", "peer and signed identity expectations must share owner and broker service UID pins");
  }
  return {
    identityVerification: verification as unknown as BrokerIdentityVerificationContext,
    authorityPeerExpectation,
    expectedBrokerGeneration,
  };
}

function parseQuery(value: unknown): AuthorityTransitionRequest {
  try {
    const detached = detachOwnDataTree(value, "$request", "invalid_request");
    const request = parseAuthorityTransitionRequest(detached);
    if (request.operation !== "query") return fail("invalid_request", "only Core authority query requests are supported");
    freezeDataTree(request);
    return request;
  } catch (error) {
    if (error instanceof BossAuthorityQueryError) throw error;
    return fail("invalid_request", "request is not an exact Core AuthorityTransitionRequest", error);
  }
}

function parseTransportResult(value: unknown, forbidden: Set<object>): {
  identity: BrokerIdentityRecord;
  transition: AuthorityTransitionRecord;
  observedPeer: ObservedBrokerPeer;
} {
  try {
    const record = exactOwnDataRecord(
      value,
      ["brokerIdentity", "responseData", "kernelObservedPeer"],
      "$transportResult",
      "invalid_transport_result",
    );
    const seen = new Set<object>();
    const identityValue = detachOwnDataTree(
      record.brokerIdentity,
      "$transportResult.brokerIdentity",
      "invalid_transport_result",
      seen,
      forbidden,
    );
    const observedValue = detachOwnDataTree(
      record.kernelObservedPeer,
      "$transportResult.kernelObservedPeer",
      "invalid_transport_result",
      seen,
      forbidden,
    );
    let responseValue: unknown;
    if (typeof record.responseData === "string") {
      responseValue = JSON.parse(record.responseData);
      if (record.responseData !== canonicalJson(responseValue)) {
        return fail("invalid_transport_result", "$transportResult.responseData must use exact canonical JSON encoding");
      }
    } else if (record.responseData instanceof Uint8Array) {
      if (isProxy(record.responseData) || Object.getPrototypeOf(record.responseData) !== Uint8Array.prototype
        || record.responseData.buffer instanceof SharedArrayBuffer
        || forbidden.has(record.responseData) || seen.has(record.responseData)) {
        return fail("invalid_transport_result", "$transportResult.responseData must be exact unaliased bytes");
      }
      for (const key of Reflect.ownKeys(record.responseData)) {
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
          return fail("invalid_transport_result", "$transportResult.responseData bytes have a custom property");
        }
        const descriptor = Object.getOwnPropertyDescriptor(record.responseData, key)!;
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
          return fail("invalid_transport_result", `$transportResult.responseData[${key}] is not exact byte data`);
        }
      }
      seen.add(record.responseData);
      const bytes = Uint8Array.prototype.slice.call(record.responseData) as Uint8Array;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      responseValue = JSON.parse(text);
      if (text !== canonicalJson(responseValue)) {
        return fail("invalid_transport_result", "$transportResult.responseData bytes must use exact canonical JSON encoding");
      }
    } else {
      responseValue = detachOwnDataTree(
        record.responseData,
        "$transportResult.responseData",
        "invalid_transport_result",
        seen,
        forbidden,
      );
    }
    responseValue = detachOwnDataTree(
      responseValue,
      "$transportResult.responseData.decoded",
      "invalid_transport_result",
    );
    return {
      identity: parseBrokerIdentityRecord(identityValue),
      transition: parseAuthorityTransitionRecord(responseValue),
      observedPeer: parseObservedBrokerPeer(observedValue),
    };
  } catch (error) {
    if (error instanceof BossAuthorityQueryError) throw error;
    return fail("invalid_transport_result", "transport result is not exact protected authority evidence", error);
  }
}

const PROVIDER_REJECTION_CODES = new Set([
  "PROVIDER_ATTESTATION_REQUIRED",
  "PROVIDER_ATTESTATION_UNSIGNED",
  "PROVIDER_KEY_UNKNOWN",
  "PROVIDER_SIGNATURE_INVALID",
  "PROVIDER_MISMATCH",
  "PROVIDER_ARTIFACT_MISMATCH",
]);

class DormantBossAuthorityQueryClient implements BossAuthorityQueryClient {
  readonly #transport: BossProtectedAuthorityQueryDependencies["queryProtectedAuthority"];
  readonly #trust: BossAuthorityQueryTrust;
  #inFlight = false;

  constructor(
    transport: BossProtectedAuthorityQueryDependencies["queryProtectedAuthority"],
    trust: BossAuthorityQueryTrust,
  ) {
    this.#transport = transport;
    this.#trust = trust;
  }

  async query(requestValue: AuthorityTransitionRequest): Promise<BossAuthorityQueryResult> {
    if (this.#inFlight) return fail("query_in_flight", "only one protected authority query may be in flight");
    const request = parseQuery(requestValue);
    const forbidden = collectGraphObjects(request);
    this.#inFlight = true;
    try {
      let rawResult: unknown;
      try {
        rawResult = await Reflect.apply(this.#transport, undefined, [request]);
      } catch (error) {
        return fail("transport_unavailable", "protected authority query transport is unavailable", error);
      }
      if (rawResult === undefined || rawResult === null) {
        return fail("transport_unavailable", "protected authority query transport returned no result");
      }

      const { identity, transition, observedPeer } = parseTransportResult(rawResult, forbidden);
      const identityDecision = verifyProtectedBrokerIdentity(identity, this.#trust.identityVerification);
      if (!identityDecision.accepted) {
        if (identityDecision.code === "STALE_BOOT_INSTANCE") {
          return fail("broker_boot_mismatch", "protected broker boot instance does not match its caller pin", undefined, identityDecision.code);
        }
        if (identityDecision.code === "REGRESSED_BROKER_GENERATION") {
          return fail("broker_generation_mismatch", "protected broker generation is below its caller freshness floor", undefined, identityDecision.code);
        }
        if (PROVIDER_REJECTION_CODES.has(identityDecision.code)) {
          return fail("broker_provider_mismatch", "protected broker provider attestation was rejected", undefined, identityDecision.code);
        }
        return fail("broker_identity_mismatch", "protected broker signed identity was rejected", undefined, identityDecision.code);
      }
      if (identity.brokerGeneration !== this.#trust.expectedBrokerGeneration) {
        return fail("broker_generation_mismatch", "protected broker generation does not match its exact caller pin");
      }

      const expectation = this.#trust.authorityPeerExpectation;
      const peerDecision = authorizeBrokerPeer(expectation, observedPeer);
      if (!peerDecision.allowed
        || expectation.ownerUid !== identity.ownerUid
        || expectation.expectedBrokerServiceUid !== identity.protectedServiceUid
        || expectation.expectedBrokerProcessId !== identity.processId) {
        return fail(
          "authority_peer_mismatch",
          "kernel-observed authority endpoint peer does not match the Controller and signed broker pins",
          undefined,
          peerDecision.allowed ? "SIGNED_IDENTITY_PEER_MISMATCH" : peerDecision.code,
        );
      }
      if (transition.authorityTransitionId !== request.authorityTransitionId
        || transition.brokerRevision > request.expectedBrokerRevision) {
        return fail("transition_mismatch", "authority response does not match the queried transition and revision fence");
      }

      // Core has no echoed requestId and historical records may precede the query's revision fence.
      // Correlate the transition id and require the returned revision not to exceed that fence.
      return {
        requestId: request.requestId,
        authorityTransitionId: request.authorityTransitionId,
        brokerRevision: transition.brokerRevision,
        brokerIdentity: detachOwnDataTree(identity, "$result.brokerIdentity", "invalid_transport_result") as BrokerIdentityRecord,
        transition: detachOwnDataTree(transition, "$result.transition", "invalid_transport_result") as AuthorityTransitionRecord,
      };
    } finally {
      this.#inFlight = false;
    }
  }
}

Object.freeze(DormantBossAuthorityQueryClient.prototype);

/** Constructs a dormant client. No I/O occurs until its sole query method is invoked. */
export function createBossAuthorityQueryClient(
  dependencies: BossProtectedAuthorityQueryDependencies,
  trust: BossAuthorityQueryTrust,
): BossAuthorityQueryClient {
  const callback = dependencyCallback(dependencies);
  let parsedTrust: BossAuthorityQueryTrust;
  try {
    parsedTrust = parseTrust(trust);
  } catch (error) {
    if (error instanceof BossAuthorityQueryError) throw error;
    return fail("invalid_configuration", "authority query trust configuration could not be normalized", error);
  }
  const client = new DormantBossAuthorityQueryClient(callback, parsedTrust);
  acceptedBossAuthorityQueryClients.add(client);
  return Object.freeze(client);
}
