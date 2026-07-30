import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERCOM_CONTROL_RECEIVED_EVENT,
  INTERCOM_CONTROL_REGISTER_EVENT,
  INTERCOM_CONTROL_SEND_EVENT,
  registerOwnedWorkerReadinessProbeType,
  registerOwnedWorkerReadinessResponder,
  WORKER_READINESS_ACK,
  WORKER_READINESS_PROBE,
  WorkerReadinessAckTracker,
} from "../src/readiness.ts";

test("owned Pi readiness responder acknowledges only its exact runId", () => {
  const listeners = new Map<string, (payload: unknown) => void>();
  const emitted: Array<{ name: string; payload: any }> = [];
  const pi: any = {
    events: {
      emit(name: string, payload: unknown) { emitted.push({ name, payload }); },
      on(name: string, listener: (payload: unknown) => void) { listeners.set(name, listener); return () => listeners.delete(name); },
    },
  };
  const unsubscribe = registerOwnedWorkerReadinessResponder(pi, {
    AGENT_INTERCOM_OWNED: "1",
    AGENT_INTERCOM_RUN_ID: "run-current",
  });
  assert.equal(typeof unsubscribe, "function");
  assert.deepEqual(emitted[0], {
    name: INTERCOM_CONTROL_REGISTER_EVENT,
    payload: { type: WORKER_READINESS_PROBE, version: 1 },
  });

  const receive = listeners.get(INTERCOM_CONTROL_RECEIVED_EVENT)!;
  receive({
    from: { id: "manager-a" },
    control: { type: WORKER_READINESS_PROBE, version: 1, data: { requestId: "stale", expectedRunId: "run-old" } },
  });
  assert.equal(emitted.length, 1, "stale runId must not be acknowledged");

  receive({
    from: { id: "manager-a" },
    control: { type: WORKER_READINESS_PROBE, version: 1, data: { requestId: "current", expectedRunId: "run-current" } },
  });
  assert.equal(emitted[1].name, INTERCOM_CONTROL_SEND_EVENT);
  assert.equal(emitted[1].payload.to, "manager-a");
  assert.deepEqual(emitted[1].payload.control, {
    type: WORKER_READINESS_ACK,
    version: 1,
    data: { requestId: "current", runId: "run-current" },
  });
  unsubscribe?.();
  assert.equal(listeners.has(INTERCOM_CONTROL_RECEIVED_EVENT), false);
});

test("owned Pi readiness control type can be re-registered after extension load order settles", () => {
  const emitted: unknown[] = [];
  const pi: any = { events: { emit(name: string, payload: unknown) { emitted.push({ name, payload }); } } };
  const environment = { AGENT_INTERCOM_OWNED: "1", AGENT_INTERCOM_RUN_ID: "run-current" };
  assert.equal(registerOwnedWorkerReadinessProbeType(pi, environment), true);
  assert.equal(registerOwnedWorkerReadinessProbeType(pi, environment), true);
  assert.deepEqual(emitted, [
    { name: INTERCOM_CONTROL_REGISTER_EVENT, payload: { type: WORKER_READINESS_PROBE, version: 1 } },
    { name: INTERCOM_CONTROL_REGISTER_EVENT, payload: { type: WORKER_READINESS_PROBE, version: 1 } },
  ]);
});

test("readiness tracker rejects stale runIds, wrong targets, and replay", () => {
  const tracker = new WorkerReadinessAckTracker();
  tracker.expect("request-a", "run-current", "worker-a");
  tracker.record({
    from: { id: "worker-a" },
    control: { type: WORKER_READINESS_ACK, version: 1, data: { requestId: "request-a", runId: "run-old" } },
  });
  assert.equal(tracker.consume("request-a"), false);

  tracker.expect("request-b", "run-current", "worker-a");
  tracker.record({
    from: { id: "worker-b" },
    control: { type: WORKER_READINESS_ACK, version: 1, data: { requestId: "request-b", runId: "run-current" } },
  });
  assert.equal(tracker.consume("request-b"), false);

  tracker.expect("request-c", "run-current", "worker-a");
  tracker.record({
    from: { id: "WORKER-A" },
    control: { type: WORKER_READINESS_ACK, version: 1, data: { requestId: "request-c", runId: "run-current" } },
  });
  assert.equal(tracker.consume("request-c"), true);
  assert.equal(tracker.consume("request-c"), false, "ack is single-use");

  tracker.record({
    from: { id: "worker-a" },
    control: { type: WORKER_READINESS_ACK, version: 1, data: { requestId: "unsolicited", runId: "run-current" } },
  });
  assert.equal(tracker.consume("unsolicited"), false, "unsolicited acknowledgments are not retained");
});

test("non-owned processes do not register a readiness responder", () => {
  let touched = false;
  const pi: any = { events: { emit() { touched = true; }, on() { touched = true; return () => {}; } } };
  assert.equal(registerOwnedWorkerReadinessResponder(pi, { AGENT_INTERCOM_RUN_ID: "run-a" }), undefined);
  assert.equal(touched, false);
});
