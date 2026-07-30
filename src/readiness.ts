import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const INTERCOM_CONTROL_REGISTER_EVENT = "intercom:control:register";
export const INTERCOM_CONTROL_SEND_EVENT = "intercom:control:send";
export const INTERCOM_CONTROL_RECEIVED_EVENT = "intercom:control";
export const WORKER_READINESS_PROBE = "agent-intercom.orchestrator/readiness-probe";
export const WORKER_READINESS_ACK = "agent-intercom.orchestrator/readiness-ack";

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export type ReadinessAck = { requestId: string; runId: string; from: string };

export function parseReadinessAck(payload: unknown): ReadinessAck | undefined {
  const envelope = objectValue(payload);
  const control = objectValue(envelope?.control);
  const data = objectValue(control?.data);
  const from = objectValue(envelope?.from);
  if (control?.type !== WORKER_READINESS_ACK || control.version !== 1) return undefined;
  if (typeof data?.requestId !== "string" || typeof data.runId !== "string" || typeof from?.id !== "string") return undefined;
  return { requestId: data.requestId, runId: data.runId, from: from.id };
}

export class WorkerReadinessAckTracker {
  readonly #pending = new Map<string, { runId: string; target: string }>();
  readonly #ready = new Set<string>();

  expect(requestId: string, runId: string, target: string): void {
    this.#pending.set(requestId, { runId, target });
  }

  record(payload: unknown): void {
    const ack = parseReadinessAck(payload);
    if (!ack) return;
    const expected = this.#pending.get(ack.requestId);
    if (!expected) return;
    if (ack.runId !== expected.runId) return;
    if (ack.from !== expected.target && ack.from.toLowerCase() !== expected.target.toLowerCase()) return;
    this.#ready.add(ack.requestId);
  }

  consume(requestId: string): boolean {
    if (!this.#ready.has(requestId)) return false;
    this.discard(requestId);
    return true;
  }

  discard(requestId: string): void {
    this.#pending.delete(requestId);
    this.#ready.delete(requestId);
  }

  clear(): void {
    this.#pending.clear();
    this.#ready.clear();
  }
}

/**
 * Owned Pi peers load the orchestrator extension with fleet registration
 * disabled. This tiny responder proves that the exact runId reached the
 * Intercom broker without exposing a model-facing message.
 */
export function registerOwnedWorkerReadinessProbeType(
  pi: ExtensionAPI,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const runId = environment.AGENT_INTERCOM_RUN_ID?.trim();
  if (environment.AGENT_INTERCOM_OWNED !== "1" || !runId) return false;
  pi.events.emit(INTERCOM_CONTROL_REGISTER_EVENT, { type: WORKER_READINESS_PROBE, version: 1 });
  return true;
}

export function registerOwnedWorkerReadinessResponder(
  pi: ExtensionAPI,
  environment: NodeJS.ProcessEnv = process.env,
): (() => void) | undefined {
  const runId = environment.AGENT_INTERCOM_RUN_ID?.trim();
  if (!registerOwnedWorkerReadinessProbeType(pi, environment) || !runId) return undefined;
  return pi.events.on(INTERCOM_CONTROL_RECEIVED_EVENT, (payload) => {
    const envelope = objectValue(payload);
    const control = objectValue(envelope?.control);
    const data = objectValue(control?.data);
    const from = objectValue(envelope?.from);
    if (control?.type !== WORKER_READINESS_PROBE || control.version !== 1) return;
    if (data?.expectedRunId !== runId || typeof data.requestId !== "string" || typeof from?.id !== "string") return;
    pi.events.emit(INTERCOM_CONTROL_SEND_EVENT, {
      requestId: `readiness-ack-${data.requestId}`,
      to: from.id,
      control: {
        type: WORKER_READINESS_ACK,
        version: 1,
        data: { requestId: data.requestId, runId },
      },
    });
  });
}
