import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDirectInteractiveBossCommand,
  bossAuthorityUnavailableMessage,
  parseBossCommand,
} from "../src/boss-command.ts";

test("Boss command parser is exact and defaults to status", () => {
  assert.deepEqual(parseBossCommand(""), { action: "status" });
  assert.deepEqual(parseBossCommand("status"), { action: "status" });
  assert.deepEqual(parseBossCommand("status boss-run_123"), { action: "status", bossRunId: "boss-run_123" });
  assert.deepEqual(parseBossCommand("create implement one exact goal"), {
    action: "create",
    goal: "implement one exact goal",
  });
  assert.deepEqual(parseBossCommand("reject boss-run_123 insufficient proof"), {
    action: "reject",
    bossRunId: "boss-run_123",
    note: "insufficient proof",
  });
  assert.throws(() => parseBossCommand("create"), /requires one explicit goal/);
  assert.throws(() => parseBossCommand("resume short"), /8-128/);
  for (const action of ["resume", "pause", "cancel", "proof", "approve", "reject"] as const) {
    assert.throws(() => parseBossCommand(action), /Boss run id must be 8-128/, `${action} must require an exact run id`);
  }
  assert.throws(() => parseBossCommand("status boss-run_123 unexpected-detail-token"), /Boss run id must be 8-128/);
  assert.throws(() => parseBossCommand("unknown"), /Unknown \/boss action/);
});

test("Boss commands reject every non-interactive invocation", () => {
  assert.doesNotThrow(() => assertDirectInteractiveBossCommand({ mode: "tui", hasUI: true }));
  for (const mode of ["rpc", "json", "print"] as const) {
    assert.throws(
      () => assertDirectInteractiveBossCommand({ mode, hasUI: mode === "rpc" }),
      /BOSS_DIRECT_USER_COMMAND_REQUIRED/,
    );
  }
  assert.throws(
    () => assertDirectInteractiveBossCommand({ mode: "tui", hasUI: false }),
    /BOSS_DIRECT_USER_COMMAND_REQUIRED/,
  );
});

test("unavailable authority response names every missing root of trust and makes no success claim", () => {
  const message = bossAuthorityUnavailableMessage(parseBossCommand("create prove the feature"));
  assert.match(message, /BOSS_AUTHORITY_UNAVAILABLE/);
  assert.match(message, /dedicated-UID Controller authority service/);
  assert.match(message, /broker-authoritative authority transition/);
  assert.match(message, /Manager inventory verification/);
  assert.match(message, /No run, credential, assignment, transition, or correlation state was created/);
  assert.doesNotMatch(message, /created successfully|ready|approved successfully/i);
});
