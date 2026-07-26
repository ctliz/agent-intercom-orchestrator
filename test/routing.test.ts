import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG, mergeConfig } from "../src/config.ts";
import {
  detectHarnessAvailability,
  formatRoutingDecision,
  inferHarnessFromModel,
  resolveHarnessRoute,
  type HarnessAvailability,
} from "../src/routing.ts";
import type { Harness } from "../src/types.ts";

function availability(overrides: Partial<Record<Harness, Partial<HarnessAvailability>>> = {}): Record<Harness, HarnessAvailability> {
  return Object.fromEntries((["pi", "codex", "claude", "opencode"] as Harness[]).map((harness) => [harness, {
    harness,
    available: true,
    profile: `${harness}-profile`,
    executable: `/bin/${harness}`,
    mode: "persistent",
    supportsSubagents: harness === "codex" || harness === "claude",
    supportedEfforts: harness === "codex" ? ["low", "medium", "high", "xhigh"] : ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    reasons: [`${harness} is installed`],
    ...overrides[harness],
  }])) as Record<Harness, HarnessAvailability>;
}

test("advisory and builder role presets keep their configured first choices", () => {
  const advisor = resolveHarnessRoute({
    role: "advisor",
    defaultHarness: "pi",
    presetHarness: "pi",
    routing: DEFAULT_CONFIG.routing,
    availability: availability(),
  });
  const builder = resolveHarnessRoute({
    role: "builder",
    defaultHarness: "pi",
    presetHarness: "codex",
    routing: DEFAULT_CONFIG.routing,
    availability: availability(),
  });
  assert.equal(advisor.selected, "pi");
  assert.equal(builder.selected, "codex");
  assert.match(advisor.candidates[0].source, /role preset/);
});

test("automatic routing falls back by availability and explains every skip", () => {
  const decision = resolveHarnessRoute({
    role: "builder",
    defaultHarness: "pi",
    presetHarness: "codex",
    routing: DEFAULT_CONFIG.routing,
    availability: availability({ codex: { available: false, reasons: ["codex command missing"] } }),
  });
  assert.equal(decision.selected, "claude");
  assert.equal(decision.candidates.find((candidate) => candidate.harness === "codex")?.eligible, false);
  assert.match(formatRoutingDecision(decision), /codex command missing/);
  assert.match(formatRoutingDecision(decision), /claude \[selected\]/);
});

test("subagent-required work excludes Pi and selects direct Codex before Claude", () => {
  const decision = resolveHarnessRoute({
    role: "advisor",
    defaultHarness: "pi",
    presetHarness: "pi",
    routing: DEFAULT_CONFIG.routing,
    availability: availability(),
    requiresSubagents: true,
  });
  assert.equal(decision.selected, "codex");
  assert.match(decision.candidates[0].reasons.join(" "), /nested subagents are required/);
});

test("OpenCode is never selected automatically but an explicit override always wins", () => {
  const onlyOpenCode = availability({
    pi: { available: false, reasons: ["missing"] },
    codex: { available: false, reasons: ["missing"] },
    claude: { available: false, reasons: ["missing"] },
  });
  const automatic = resolveHarnessRoute({
    role: "worker",
    defaultHarness: "pi",
    routing: DEFAULT_CONFIG.routing,
    availability: onlyOpenCode,
  });
  const explicit = resolveHarnessRoute({
    role: "worker",
    defaultHarness: "pi",
    routing: DEFAULT_CONFIG.routing,
    availability: onlyOpenCode,
    explicitHarness: "opencode",
    explicitSource: "profile",
    requiresSubagents: true,
  });
  assert.equal(automatic.selected, undefined);
  assert.match(automatic.candidates.find((candidate) => candidate.harness === "opencode")?.reasons.join(" ") ?? "", /explicit-only/);
  assert.equal(explicit.selected, "opencode");
  assert.equal(explicit.automatic, false);
  assert.equal(explicit.explicitSource, "profile");
  assert.match(explicit.reasons.join(" "), /does not support configured nested subagents/);
});

test("configured routing preference outranks the legacy default fallback", () => {
  const decision = resolveHarnessRoute({
    role: "worker",
    defaultHarness: "pi",
    routing: { ...DEFAULT_CONFIG.routing, preference: ["claude", "codex", "pi", "opencode"] },
    availability: availability(),
  });
  assert.equal(decision.selected, "claude");
  assert.match(decision.candidates[0].source, /routing\.preference/);

  const migrated = mergeConfig({ defaultHarness: "claude" });
  assert.deepEqual(migrated.routing.preference.slice(0, 2), ["claude", "pi"]);
});

test("explicit model identifiers select direct Codex or Claude harnesses", () => {
  assert.equal(inferHarnessFromModel("codex/gpt-5.6-sol"), "codex");
  assert.equal(inferHarnessFromModel("openai/gpt-5.4"), "codex");
  assert.equal(inferHarnessFromModel("gpt-5.6-sol"), "codex");
  assert.equal(inferHarnessFromModel("codex-mini-latest"), "codex");
  assert.equal(inferHarnessFromModel("claude/claude-fable-5"), "claude");
  assert.equal(inferHarnessFromModel("anthropic/claude-opus-4-8"), "claude");
  assert.equal(inferHarnessFromModel("opus"), "claude");
  assert.equal(inferHarnessFromModel("google/gemini-3"), undefined);
});

test("automatic routing filters unsupported explicit effort while explicit harness reports a warning", () => {
  const automatic = resolveHarnessRoute({
    role: "builder",
    defaultHarness: "pi",
    routing: DEFAULT_CONFIG.routing,
    availability: availability(),
    requestedEffort: "max",
  });
  assert.equal(automatic.selected, "claude");
  assert.match(automatic.candidates.find((candidate) => candidate.harness === "codex")?.reasons.join(" ") ?? "", /effort 'max' is unsupported/);

  const explicit = resolveHarnessRoute({
    role: "builder",
    defaultHarness: "pi",
    routing: DEFAULT_CONFIG.routing,
    availability: availability(),
    explicitHarness: "codex",
    explicitSource: "harness",
    requestedEffort: "max",
  });
  assert.equal(explicit.selected, "codex");
  assert.match(explicit.reasons.join(" "), /capability warning.*unsupported/);
});

test("zero eligible harnesses returns an explainable preview decision", () => {
  const unavailable = availability({
    pi: { available: false, reasons: ["pi missing"] },
    codex: { available: false, reasons: ["codex missing"] },
    claude: { available: false, reasons: ["claude missing"] },
  });
  const decision = resolveHarnessRoute({
    role: "worker",
    defaultHarness: "pi",
    routing: DEFAULT_CONFIG.routing,
    availability: unavailable,
  });
  assert.equal(decision.selected, undefined);
  assert.match(formatRoutingDecision(decision), /Recommended harness: none/);
  assert.match(formatRoutingDecision(decision), /opencode \[excluded\].*explicit-only/);
});

test("availability requires the selected profile and reports mode, effort, and executable", () => {
  const config = mergeConfig({
    defaultProfiles: { pi: "missing", codex: "attach", claude: "claude-safe" },
    profiles: {
      attach: { harness: "codex", command: "codex", spawnable: false, description: "attach only" },
      "claude-safe": { harness: "claude", command: "claude", mode: "one-shot" },
    },
  });
  const detected = detectHarnessAvailability(config, {
    supportedEfforts: { claude: ["low", "high", "max"] },
    resolveCommand: (command) => command === "claude" ? "/usr/bin/claude" : undefined,
  });
  assert.equal(detected.pi.available, false);
  assert.match(detected.pi.reasons[0], /does not exist/);
  assert.equal(detected.codex.available, false);
  assert.match(detected.codex.reasons[0], /attach only/);
  assert.equal(detected.claude.available, true);
  assert.equal(detected.claude.executable, "/usr/bin/claude");
  assert.equal(detected.claude.mode, "one-shot");
  assert.deepEqual(detected.claude.supportedEfforts, ["low", "high", "max"]);
  assert.match(detected.claude.reasons[0], /one-shot mode/);
});
