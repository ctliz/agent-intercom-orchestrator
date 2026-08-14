import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import test from "node:test";
import {
  BROKER_PROVIDER_ATTESTATION_VERSION,
  brokerProviderAttestationSigningBytes,
} from "@ctliz/agent-intercom-core/boss";
import {
  BOSS_PROTECTED_SERVICE_MANIFEST_VERSION,
  BOSS_PROTECTED_SERVICE_PROVIDERS,
  BOSS_PROTECTED_SERVICE_RELEASE_AUTHORITY_VERSION,
  BossProtectedServicePlanError,
  compileBossProtectedServiceInstallPlan,
  parseBossProtectedServiceReleaseAuthorityCandidate,
  type BossProtectedServicePlanErrorCode,
  type BossProtectedServiceReleaseAuthorityInputV1,
} from "../src/boss-protected-service-plan.ts";

const OWNER_UID = 1000;
const OWNER_GID = 1000;
const BROKER_UID = 991;
const BROKER_GID = 991;
const CONTROLLER_UID = 992;
const CONTROLLER_GID = 992;
const ATTESTED_AT = "2026-07-30T12:00:00.000Z";

type MutableCandidate = {
  -readonly [K in keyof BossProtectedServiceReleaseAuthorityInputV1]: BossProtectedServiceReleaseAuthorityInputV1[K];
} & {
  trustedReleaseKeys: Record<string | symbol, unknown>;
  expectedProviders: Record<string | symbol, unknown>[];
};

function candidateFixture(keyValue?: KeyObject | string): { candidate: MutableCandidate; privateKey: KeyObject } {
  const keys = generateKeyPairSync("ed25519");
  const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const expectedProviders = BOSS_PROTECTED_SERVICE_PROVIDERS.map((provider, index) => ({
    adapterId: provider.id,
    providerPackage: provider.packageName,
    providerVersion: "1.2.3",
    providerDigest: String.fromCharCode(97 + index).repeat(64),
    artifactPath: `/usr/lib/agent-intercom/providers/${provider.id}/provider.mjs`,
    artifactOwnerUid: 0,
    artifactOwnerGid: 0,
    artifactMode: "0555",
  }));
  return {
    privateKey: keys.privateKey,
    candidate: {
      version: BOSS_PROTECTED_SERVICE_RELEASE_AUTHORITY_VERSION,
      interactiveOwnerName: "dxyz",
      interactiveOwnerUid: OWNER_UID,
      interactiveOwnerGid: OWNER_GID,
      brokerServiceName: "agent_intercom_broker",
      brokerServiceUid: BROKER_UID,
      brokerServiceGid: BROKER_GID,
      controllerServiceName: "agent_intercom_controller",
      controllerServiceUid: CONTROLLER_UID,
      controllerServiceGid: CONTROLLER_GID,
      trustedReleaseKeys: { "release-key-1": keyValue ?? publicPem },
      expectedProviders,
    },
  };
}

function expectCandidateCode(value: unknown, code: BossProtectedServicePlanErrorCode): BossProtectedServicePlanError {
  let observed: unknown;
  try {
    parseBossProtectedServiceReleaseAuthorityCandidate(value);
  } catch (error) {
    observed = error;
  }
  assert.ok(observed instanceof BossProtectedServicePlanError);
  assert.equal(observed.code, code);
  return observed;
}

function expectUnavailable(value: unknown): BossProtectedServicePlanError {
  let observed: unknown;
  try {
    compileBossProtectedServiceInstallPlan(value);
  } catch (error) {
    observed = error;
  }
  assert.ok(observed instanceof BossProtectedServicePlanError);
  assert.equal(observed.code, "BOSS_AUTHORITY_UNAVAILABLE");
  return observed;
}

function expectation(candidate: MutableCandidate, id: string): Record<string, unknown> {
  const found = candidate.expectedProviders.find((entry) => entry.adapterId === id);
  assert.ok(found);
  return found as unknown as Record<string, unknown>;
}

test("normalizes a complete non-authoritative release candidate without minting authority", () => {
  const fixture = candidateFixture();
  const snapshot = structuredClone(fixture.candidate);
  const parsed = parseBossProtectedServiceReleaseAuthorityCandidate(fixture.candidate);
  assert.deepEqual(fixture.candidate, snapshot);
  assert.deepEqual(parsed.expectedProviders.map((provider) => provider.adapterId), ["pi", "codex", "claude", "opencode"]);
  assert.equal(typeof parsed.trustedReleaseKeys["release-key-1"], "string");
  assert.ok((parsed.trustedReleaseKeys["release-key-1"] as string).startsWith("-----BEGIN PUBLIC KEY-----"));
  assert.deepEqual(
    [parsed.interactiveOwnerUid, parsed.brokerServiceUid, parsed.controllerServiceUid],
    [OWNER_UID, BROKER_UID, CONTROLLER_UID],
  );
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.expectedProviders));
  assert.ok(Object.isFrozen(parsed.expectedProviders[0]));
  expectUnavailable({ version: BOSS_PROTECTED_SERVICE_MANIFEST_VERSION });
});

test("accepts public Ed25519 KeyObject and rejects private, wrong-algorithm, and decorated KeyObjects", () => {
  const fixture = candidateFixture();
  const publicObject = createPublicKey(fixture.candidate.trustedReleaseKeys["release-key-1"] as string);
  const accepted = candidateFixture(publicObject);
  assert.equal(typeof parseBossProtectedServiceReleaseAuthorityCandidate(accepted.candidate).trustedReleaseKeys["release-key-1"], "string");

  const privateObject = candidateFixture(accepted.privateKey);
  expectCandidateCode(privateObject.candidate, "INVALID_TRUST_STORE");

  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  expectCandidateCode(candidateFixture(rsa.publicKey).candidate, "INVALID_TRUST_STORE");
  expectCandidateCode(candidateFixture(rsa.publicKey.export({ type: "spki", format: "pem" }).toString()).candidate, "INVALID_TRUST_STORE");

  const decorated = createPublicKey(fixture.candidate.trustedReleaseKeys["release-key-1"] as string);
  let invoked = false;
  Object.defineProperty(decorated, "attacker", {
    enumerable: true,
    get() { invoked = true; return "private"; },
  });
  expectCandidateCode(candidateFixture(decorated).candidate, "INVALID_TRUST_STORE");
  assert.equal(invoked, false);
});

test("rejects private PEM and malformed trust stores", () => {
  const fixture = candidateFixture();
  fixture.candidate.trustedReleaseKeys = {
    "release-key-1": fixture.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  expectCandidateCode(fixture.candidate, "INVALID_TRUST_STORE");

  const empty = candidateFixture();
  empty.candidate.trustedReleaseKeys = {};
  expectCandidateCode(empty.candidate, "INVALID_TRUST_STORE");

  const malformed = candidateFixture();
  malformed.candidate.trustedReleaseKeys = { "release-key-1": "not a public key" };
  expectCandidateCode(malformed.candidate, "INVALID_TRUST_STORE");
});

test("requires exact canonical provider tuples while allowing identical content digests", () => {
  const identical = candidateFixture();
  for (const provider of identical.candidate.expectedProviders) provider.providerDigest = "a".repeat(64);
  assert.equal(parseBossProtectedServiceReleaseAuthorityCandidate(identical.candidate).expectedProviders.length, 4);

  const missing = candidateFixture();
  missing.candidate.expectedProviders.pop();
  expectCandidateCode(missing.candidate, "PROVIDER_SET_MISMATCH");

  const duplicate = candidateFixture();
  duplicate.candidate.expectedProviders[3]!.adapterId = duplicate.candidate.expectedProviders[0]!.adapterId;
  expectCandidateCode(duplicate.candidate, "PROVIDER_TUPLE_INVALID");

  const packageSubstitution = candidateFixture();
  expectation(packageSubstitution.candidate, "pi").providerPackage = "@attacker/agent-intercom-pi";
  expectCandidateCode(packageSubstitution.candidate, "PROVIDER_TUPLE_INVALID");
});

test("rejects noncanonical, traversal, and writable provider artifact tuples", () => {
  for (const artifactPath of [
    "/usr/lib/agent-intercom/providers/pi/../evil/provider.mjs",
    "/usr/lib/agent-intercom/providers//pi/provider.mjs",
    "/usr/lib/agent-intercom/providers/pi\\provider.mjs",
    "/tmp/pi/provider.mjs",
    "/usr/lib/agent-intercom/providers/pi/not-provider.js",
  ]) {
    const fixture = candidateFixture();
    expectation(fixture.candidate, "pi").artifactPath = artifactPath;
    expectCandidateCode(fixture.candidate, "PROVIDER_TUPLE_INVALID");
  }
  for (const [field, value] of [["artifactMode", "0755"], ["artifactOwnerUid", OWNER_UID], ["artifactOwnerGid", OWNER_GID]] as const) {
    const fixture = candidateFixture();
    expectation(fixture.candidate, "pi")[field] = value;
    expectCandidateCode(fixture.candidate, "PROVIDER_TUPLE_INVALID");
  }
});

test("candidate owns explicit account mappings and rejects collisions or invalid Linux identities", () => {
  for (const [field, value] of [
    ["brokerServiceName", "dxyz"],
    ["controllerServiceName", "Agent Controller"],
    ["interactiveOwnerName", "../dxyz"],
    ["brokerServiceUid", OWNER_UID],
    ["controllerServiceUid", BROKER_UID],
    ["interactiveOwnerUid", 0],
    ["brokerServiceUid", -0],
    ["controllerServiceGid", Number.MAX_SAFE_INTEGER],
  ] as const) {
    const fixture = candidateFixture();
    (fixture.candidate as unknown as Record<string, unknown>)[field] = value;
    expectCandidateCode(fixture.candidate, "INVALID_SERVICE_IDENTITY");
  }
});

test("bounds depth, object edges, array edges, and primitive leaves before schema projection", () => {
  const deep = candidateFixture().candidate as unknown as Record<string, unknown>;
  let branch: Record<string, unknown> = {};
  deep.deep = branch;
  for (let index = 0; index < 100; index += 1) {
    const next: Record<string, unknown> = {};
    branch.next = next;
    branch = next;
  }
  expectCandidateCode(deep, "INVALID_TRUST_STORE");

  const primitiveBomb = candidateFixture().candidate as unknown as Record<string, unknown>;
  primitiveBomb.bomb = Array.from({ length: 20 }, () => Array.from({ length: 128 }, () => 0));
  expectCandidateCode(primitiveBomb, "INVALID_TRUST_STORE");

  const wideObject = candidateFixture().candidate as unknown as Record<string, unknown>;
  wideObject.bomb = Object.fromEntries(Array.from({ length: 4_100 }, (_, index) => [`p${index}`, index]));
  expectCandidateCode(wideObject, "INVALID_TRUST_STORE");
});

test("rejects proxies, accessors, inheritance, aliases, cycles, sparse arrays, and symbols without getter invocation", () => {
  expectCandidateCode(new Proxy(candidateFixture().candidate, {}), "INVALID_TRUST_STORE");

  const accessor = candidateFixture();
  let invoked = false;
  Object.defineProperty(accessor.candidate.expectedProviders[0], "providerVersion", {
    enumerable: true,
    get() { invoked = true; return "9.9.9"; },
  });
  expectCandidateCode(accessor.candidate, "INVALID_TRUST_STORE");
  assert.equal(invoked, false);

  const inherited = candidateFixture();
  inherited.candidate.expectedProviders[0] = Object.create(inherited.candidate.expectedProviders[0]) as unknown as BossProtectedServiceReleaseAuthorityInputV1["expectedProviders"][number] & Record<string | symbol, unknown>;
  expectCandidateCode(inherited.candidate, "INVALID_TRUST_STORE");

  const aliased = candidateFixture();
  aliased.candidate.expectedProviders[1] = aliased.candidate.expectedProviders[0]!;
  expectCandidateCode(aliased.candidate, "INVALID_TRUST_STORE");

  const cyclic = candidateFixture().candidate as unknown as Record<string, unknown>;
  cyclic.cycle = cyclic;
  expectCandidateCode(cyclic, "INVALID_TRUST_STORE");

  const sparse = candidateFixture();
  sparse.candidate.expectedProviders = new Array(4);
  expectCandidateCode(sparse.candidate, "INVALID_TRUST_STORE");

  const symbol = candidateFixture();
  Object.defineProperty(symbol.candidate.expectedProviders[0], Symbol("hidden"), { enumerable: true, value: true });
  expectCandidateCode(symbol.candidate, "INVALID_TRUST_STORE");
});

test("attacker keys, tuples, and matching signatures can produce only a candidate, never a production plan", () => {
  const attacker = candidateFixture();
  const parsed = parseBossProtectedServiceReleaseAuthorityCandidate(attacker.candidate);
  const provider = parsed.expectedProviders[0]!;
  const attestation = {
    version: BROKER_PROVIDER_ATTESTATION_VERSION,
    providerPackage: provider.providerPackage,
    providerVersion: provider.providerVersion,
    providerDigest: provider.providerDigest,
    artifactPath: provider.artifactPath,
    artifactOwnerUid: 0,
    artifactOwnerGid: 0,
    artifactMode: "0555",
    userWritable: false,
    attestedAt: ATTESTED_AT,
    attestationKeyId: "release-key-1",
    signature: "",
  };
  attestation.signature = sign(null, brokerProviderAttestationSigningBytes(attestation), attacker.privateKey).toString("base64");
  const manifest = {
    version: BOSS_PROTECTED_SERVICE_MANIFEST_VERSION,
    targetPlatform: "linux",
    selectedProviderId: "pi",
    providerAttestations: [{ adapterId: "pi", attestation }],
  };
  expectUnavailable(manifest);
});

test("authority unavailability is returned before any hostile manifest value is inspected", () => {
  let invoked = false;
  const hostile = Object.defineProperty({}, "version", {
    enumerable: true,
    get() { invoked = true; throw new Error("must not run"); },
  });
  const error = expectUnavailable(new Proxy(hostile, {
    ownKeys() { invoked = true; throw new Error("must not enumerate"); },
  }));
  assert.equal(error.path, "$authority");
  assert.equal(invoked, false);
});
