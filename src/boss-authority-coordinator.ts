import { isProxy } from "node:util/types";
import {
  parseAuthorityTransitionEvent,
  parseAuthorityTransitionRecord,
  parseAuthorityTransitionRequest,
  parseBrokerIdentityRecord,
  type AuthorityTransitionEvent,
  type AuthorityTransitionOperation,
  type AuthorityTransitionRecord,
  type AuthorityTransitionRequest,
} from "@dataforxyz/agent-intercom-core/boss";
import { canonicalJson } from "@dataforxyz/agent-intercom-core/canonical";
import {
  BossAuthorityQueryError,
  isBossAuthorityQueryClient,
  type BossAuthorityQueryClient,
  type BossAuthorityQueryErrorCode,
  type BossAuthorityQueryResult,
} from "./boss-authority-client.ts";
import {
  BossAuthorityReconciliationError,
  reconcileCommittedBossAuthorityTransition,
  type BossAuthorityReconciliationErrorCode,
  type BossAuthorityReconciliationResult,
} from "./boss-authority-reconciler.ts";
import { BossStore, isBossStore } from "./boss-store.ts";

export interface BossCommittedAuthorityEventSelector {
  authorityTransitionId: string;
  brokerRevision: number;
  operation: AuthorityTransitionOperation;
  bossRunId?: string;
}

export interface BossAuthorityCoordinatorDependencies {
  queryClient: BossAuthorityQueryClient;
  readCommittedAuthorityEvent(selector: BossCommittedAuthorityEventSelector): unknown | Promise<unknown>;
  store: BossStore;
}

export type BossAuthorityCoordinatorErrorCode =
  | "invalid_configuration"
  | "invalid_request"
  | "query_failed"
  | "invalid_query_result"
  | "event_unavailable"
  | "invalid_event"
  | "event_mismatch"
  | "reconciliation_failed";

export type BossAuthorityCoordinatorSourceCode =
  | BossAuthorityQueryErrorCode
  | BossAuthorityReconciliationErrorCode;

export class BossAuthorityCoordinatorError extends Error {
  readonly code: BossAuthorityCoordinatorErrorCode;
  /** The unchanged code of an accepted typed query/reconciliation failure. */
  readonly sourceCode?: BossAuthorityCoordinatorSourceCode;

  constructor(
    code: BossAuthorityCoordinatorErrorCode,
    message: string,
    cause?: unknown,
    sourceCode?: BossAuthorityCoordinatorSourceCode,
  ) {
    super(message, { cause: cause instanceof Error ? cause : undefined });
    this.name = "BossAuthorityCoordinatorError";
    this.code = code;
    this.sourceCode = sourceCode;
  }
}

type OwnDataRecord = Record<string, unknown>;

function fail(
  code: BossAuthorityCoordinatorErrorCode,
  message: string,
  cause?: unknown,
  sourceCode?: BossAuthorityCoordinatorSourceCode,
): never {
  throw new BossAuthorityCoordinatorError(code, message, cause, sourceCode);
}

function exactRecord(value: unknown, keys: readonly string[], path: string, code: BossAuthorityCoordinatorErrorCode): OwnDataRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    return fail(code, `${path} must be a non-proxy plain object`);
  }
  const allowed = new Set(keys);
  const result: OwnDataRecord = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(code, `${path} must not contain symbol properties`);
    if (!allowed.has(key)) fail(code, `${path}.${key} is unsupported`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, `${path}.${key} must be an enumerable own data property`);
    }
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  for (const key of keys) if (!Object.hasOwn(result, key)) fail(code, `${path}.${key} is required`);
  return result;
}

function dependencies(value: unknown): BossAuthorityCoordinatorDependencies {
  const record = exactRecord(value, [
    "queryClient",
    "readCommittedAuthorityEvent",
    "store",
  ], "$dependencies", "invalid_configuration");
  if (!isBossAuthorityQueryClient(record.queryClient)) {
    return fail("invalid_configuration", "$dependencies.queryClient must be an accepted BossAuthorityQueryClient");
  }
  if (typeof record.readCommittedAuthorityEvent !== "function" || isProxy(record.readCommittedAuthorityEvent)) {
    return fail("invalid_configuration", "$dependencies.readCommittedAuthorityEvent must be a non-proxy function");
  }
  const store = exactBossStore(record.store);
  return {
    queryClient: record.queryClient,
    readCommittedAuthorityEvent: record.readCommittedAuthorityEvent as BossAuthorityCoordinatorDependencies["readCommittedAuthorityEvent"],
    store,
  };
}

function exactBossStore(value: unknown): BossStore {
  if (!isBossStore(value) || isProxy(value) || Object.getPrototypeOf(value) !== BossStore.prototype
    || Object.hasOwn(value, "read") || Object.hasOwn(value, "transaction")
    || value.read !== BossStore.prototype.read || value.transaction !== BossStore.prototype.transaction) {
    return fail("invalid_configuration", "$dependencies.store must be an exact module-constructed BossStore instance");
  }
  return value;
}

function detachData(
  value: unknown,
  path: string,
  code: BossAuthorityCoordinatorErrorCode,
  forbidden = new Set<object>(),
  seen = new Set<object>(),
  depth = 0,
): unknown {
  if (depth > 128) return fail(code, `${path} exceeds the exact-data depth limit`);
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "undefined") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(code, `${path} contains a non-finite number`);
    return value;
  }
  if (typeof value !== "object") return fail(code, `${path} contains a non-data value`);
  if (isProxy(value)) return fail(code, `${path} must not contain a Proxy`);
  if (forbidden.has(value)) return fail(code, `${path} aliases data from an earlier authority phase`);
  if (seen.has(value)) return fail(code, `${path} must not contain cycles or aliases`);
  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(code, `${path} must be a plain array`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) fail(code, `${path} contains a non-index property`);
      const descriptor = descriptors[key]!;
      if (Number(key) >= value.length || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        fail(code, `${path}[${key}] must be an enumerable own data property`);
      }
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail(code, `${path}[${index}] must not be sparse`);
      result.push(detachData(descriptor.value, `${path}[${index}]`, code, forbidden, seen, depth + 1));
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
      value: detachData(descriptor.value, `${path}.${key}`, code, forbidden, seen, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function graphObjects(value: unknown, result = new Set<object>()): Set<object> {
  if (typeof value !== "object" || value === null || result.has(value)) return result;
  result.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) graphObjects(descriptor.value, result);
  }
  return result;
}

function freezeData(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) freezeData(descriptor.value, seen);
  }
  Object.freeze(value);
}

function parseRequest(value: unknown): AuthorityTransitionRequest {
  try {
    const request = parseAuthorityTransitionRequest(detachData(value, "$request", "invalid_request"));
    if (request.operation !== "query") return fail("invalid_request", "coordinator accepts only exact Core query requests");
    freezeData(request);
    return request;
  } catch (error) {
    if (error instanceof BossAuthorityCoordinatorError) throw error;
    return fail("invalid_request", "request is not an exact Core AuthorityTransitionRequest", error);
  }
}

function parseQueryResult(value: unknown, request: AuthorityTransitionRequest): BossAuthorityQueryResult {
  try {
    const detached = detachData(value, "$queryResult", "invalid_query_result", graphObjects(request));
    const record = exactRecord(detached, [
      "requestId",
      "authorityTransitionId",
      "brokerRevision",
      "brokerIdentity",
      "transition",
    ], "$queryResult", "invalid_query_result");
    const brokerIdentity = parseBrokerIdentityRecord(record.brokerIdentity);
    const transition = parseAuthorityTransitionRecord(record.transition);
    if (record.requestId !== request.requestId
      || record.authorityTransitionId !== request.authorityTransitionId
      || record.authorityTransitionId !== transition.authorityTransitionId
      || record.brokerRevision !== transition.brokerRevision
      || transition.brokerRevision > request.expectedBrokerRevision) {
      return fail("invalid_query_result", "query result does not match the exact request and returned transition");
    }
    const result: BossAuthorityQueryResult = {
      requestId: record.requestId as string,
      authorityTransitionId: record.authorityTransitionId as string,
      brokerRevision: record.brokerRevision as number,
      brokerIdentity,
      transition,
    };
    freezeData(result);
    return result;
  } catch (error) {
    if (error instanceof BossAuthorityCoordinatorError) throw error;
    return fail("invalid_query_result", "query client returned a non-exact authority result", error);
  }
}

function selectorFor(transition: AuthorityTransitionRecord): BossCommittedAuthorityEventSelector {
  const selector: BossCommittedAuthorityEventSelector = {
    authorityTransitionId: transition.authorityTransitionId,
    brokerRevision: transition.brokerRevision,
    operation: transition.operation,
    ...(transition.target.bossRunId === undefined ? {} : { bossRunId: transition.target.bossRunId }),
  };
  freezeData(selector);
  return selector;
}

function parseEvent(
  value: unknown,
  selector: BossCommittedAuthorityEventSelector,
  transition: AuthorityTransitionRecord,
  forbidden: Set<object>,
): AuthorityTransitionEvent {
  try {
    const event = parseAuthorityTransitionEvent(detachData(value, "$event", "invalid_event", forbidden));
    if (event.authorityTransitionId !== selector.authorityTransitionId
      || event.brokerRevision !== selector.brokerRevision
      || event.operation !== selector.operation
      || event.bossRunId !== selector.bossRunId
      || transition.state !== "committed"
      || transition.committedAt !== event.occurredAt
      || canonicalJson(transition.target) !== canonicalJson(event.target)
      || canonicalJson(transition.prior) !== canonicalJson(event.prior)
      || canonicalJson(transition.proposed) !== canonicalJson(event.resulting)) {
      return fail("event_mismatch", "committed event does not exactly correlate with the queried authority record");
    }
    freezeData(event);
    return event;
  } catch (error) {
    if (error instanceof BossAuthorityCoordinatorError) throw error;
    return fail("invalid_event", "authoritative event reader returned a non-exact Core event", error);
  }
}

class DormantBossAuthorityCoordinator {
  readonly #dependencies: BossAuthorityCoordinatorDependencies;

  constructor(value: BossAuthorityCoordinatorDependencies) {
    this.#dependencies = dependencies(value);
  }

  async reconcile(requestValue: AuthorityTransitionRequest): Promise<BossAuthorityReconciliationResult> {
    const request = parseRequest(requestValue);
    let rawQueryResult: unknown;
    try {
      rawQueryResult = await this.#dependencies.queryClient.query(request);
    } catch (error) {
      if (error instanceof BossAuthorityQueryError) {
        return fail("query_failed", "authority query failed", error, error.code);
      }
      return fail("query_failed", "authority query dependency failed", error);
    }
    const queryResult = parseQueryResult(rawQueryResult, request);
    const selector = selectorFor(queryResult.transition);
    // Snapshot source identities while the accepted query result is still fenced. The event
    // reader receives no query object and cannot make a later mutation safe by racing this set.
    const forbidden = graphObjects(rawQueryResult);
    for (const object of graphObjects(queryResult)) forbidden.add(object);
    for (const object of graphObjects(selector)) forbidden.add(object);

    let rawEvent: unknown;
    try {
      rawEvent = await Reflect.apply(this.#dependencies.readCommittedAuthorityEvent, undefined, [selector]);
    } catch (error) {
      return fail("event_unavailable", "committed authority event is unavailable", error);
    }
    if (rawEvent === undefined || rawEvent === null) {
      return fail("event_unavailable", "committed authority event reader returned no event");
    }
    const event = parseEvent(rawEvent, selector, queryResult.transition, forbidden);

    try {
      return await reconcileCommittedBossAuthorityTransition(
        this.#dependencies.store,
        queryResult.transition,
        event,
      );
    } catch (error) {
      if (error instanceof BossAuthorityReconciliationError) {
        return fail("reconciliation_failed", "authority reconciliation failed", error, error.code);
      }
      return fail("reconciliation_failed", "authority reconciliation dependency failed", error);
    }
  }
}

/** Constructs a dormant query-event-reconcile coordinator. It performs no I/O until reconcile. */
export function createBossAuthorityCoordinator(
  value: BossAuthorityCoordinatorDependencies,
): { reconcile(request: AuthorityTransitionRequest): Promise<BossAuthorityReconciliationResult> } {
  return new DormantBossAuthorityCoordinator(value);
}
