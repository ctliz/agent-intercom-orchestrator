import type { Effort, Harness, LaunchProfile, OrchestratorConfig, RoutingConfig } from "./types.ts";

export const ROUTABLE_HARNESSES: Harness[] = ["pi", "codex", "claude", "opencode"];

export interface HarnessAvailability {
  harness: Harness;
  available: boolean;
  profile?: string;
  executable?: string;
  mode?: "persistent" | "one-shot";
  supportsSubagents: boolean;
  supportedEfforts?: Effort[];
  reasons: string[];
}

export interface RoutingCandidate {
  harness: Harness;
  rank: number;
  source: string;
  eligible: boolean;
  selected: boolean;
  reasons: string[];
}

export interface RoutingDecision {
  selected?: Harness;
  automatic: boolean;
  explicitSource?: "harness" | "profile" | "model";
  role: string;
  requiresSubagents: boolean;
  requestedEffort?: Effort;
  reasons: string[];
  candidates: RoutingCandidate[];
}

export interface RoutingRequest {
  role: string;
  defaultHarness: Harness;
  routing: RoutingConfig;
  availability: Partial<Record<Harness, HarnessAvailability>>;
  presetHarness?: Harness;
  explicitHarness?: Harness;
  explicitSource?: "harness" | "profile" | "model";
  requiresSubagents?: boolean;
  requestedEffort?: Effort;
  candidateEfforts?: Partial<Record<Harness, Effort>>;
}

export interface AvailabilityOptions {
  profileOverrides?: Partial<Record<Harness, string>>;
  supportedEfforts?: Partial<Record<Harness, Effort[]>>;
  resolveCommand: (command: string) => string | undefined;
}

function uniqueHarnesses(items: Array<Harness | undefined>): Harness[] {
  return [...new Set(items.filter((item): item is Harness => Boolean(item)))];
}

function inspectProfile(
  harness: Harness,
  profileName: string | undefined,
  profile: LaunchProfile | undefined,
  supportsSubagents: boolean,
  supportedEfforts: Effort[] | undefined,
  resolveCommand: AvailabilityOptions["resolveCommand"],
): HarnessAvailability {
  const shared = { harness, supportsSubagents, ...(supportedEfforts ? { supportedEfforts: [...supportedEfforts] } : {}) };
  if (!profileName) {
    return { ...shared, available: false, reasons: ["no launch profile is configured"] };
  }
  if (!profile) {
    return { ...shared, available: false, profile: profileName, reasons: [`profile '${profileName}' does not exist`] };
  }
  const mode = profile.mode ?? "persistent";
  if (profile.harness !== harness) {
    return {
      ...shared,
      available: false,
      profile: profileName,
      mode,
      reasons: [`profile '${profileName}' launches ${profile.harness}, not ${harness}`],
    };
  }
  if (profile.spawnable === false) {
    return {
      ...shared,
      available: false,
      profile: profileName,
      mode,
      reasons: [profile.description || `profile '${profileName}' is attach-only`],
    };
  }
  const executable = resolveCommand(profile.command);
  if (!executable) {
    return {
      ...shared,
      available: false,
      profile: profileName,
      mode,
      reasons: [`profile '${profileName}' (${mode}) command '${profile.command}' is not executable`],
    };
  }
  return {
    ...shared,
    available: true,
    profile: profileName,
    executable,
    mode,
    reasons: [`profile '${profileName}' is spawnable in ${mode} mode at ${executable}`],
  };
}

/**
 * Build a side-effect-free availability snapshot apart from the injected command lookup.
 * Automatic routing intentionally evaluates only the explicit, role-preset, or configured
 * default profile. Other configured profiles remain discoverable through `capabilities` and
 * `profiles` and can be selected explicitly or made the harness default.
 */
export function detectHarnessAvailability(
  config: OrchestratorConfig,
  options: AvailabilityOptions,
): Record<Harness, HarnessAvailability> {
  const supportsSubagents = new Set(config.routing.capabilities.requiresSubagents);
  return Object.fromEntries(ROUTABLE_HARNESSES.map((harness) => {
    const profileName = options.profileOverrides?.[harness] ?? config.defaultProfiles[harness];
    return [harness, inspectProfile(
      harness,
      profileName,
      profileName ? config.profiles[profileName] : undefined,
      supportsSubagents.has(harness),
      options.supportedEfforts?.[harness],
      options.resolveCommand,
    )];
  })) as Record<Harness, HarnessAvailability>;
}

/** Infer the direct harness requested by an explicit provider/model identifier. */
export function inferHarnessFromModel(model: string | undefined): Harness | undefined {
  const value = model?.trim().toLowerCase();
  if (!value) return undefined;
  if (/^(?:codex|openai)\//.test(value) || /^(?:codex-|gpt-|o[1-9](?:-|$))/.test(value)) return "codex";
  if (/^(?:claude|anthropic)\//.test(value) || /^(?:claude-|opus(?:-|$)|sonnet(?:-|$)|haiku(?:-|$)|fable(?:-|$))/.test(value)) return "claude";
  return undefined;
}

function effortReason(availability: HarnessAvailability | undefined, effort: Effort | undefined): string | undefined {
  if (!effort || !availability?.supportedEfforts || availability.supportedEfforts.includes(effort)) return undefined;
  return `effort '${effort}' is unsupported (choose ${availability.supportedEfforts.join(", ") || "a harness default"})`;
}

/** Resolve one harness without reading the filesystem, mutating state, or launching work. */
export function resolveHarnessRoute(request: RoutingRequest): RoutingDecision {
  const role = request.role.trim() || "worker";
  const requiresSubagents = request.requiresSubagents === true;
  const requestedEffort = request.requestedEffort;
  if (request.explicitHarness) {
    const availability = request.availability[request.explicitHarness];
    const source = request.explicitSource ?? "harness";
    const effectiveEffort = request.candidateEfforts?.[request.explicitHarness] ?? requestedEffort;
    const warnings = [
      ...(!availability?.available ? availability?.reasons.map((reason) => `availability warning: ${reason}`) ?? ["availability warning: availability was not detected"] : availability.reasons),
      ...(requiresSubagents && !availability?.supportsSubagents ? ["capability warning: explicit harness does not support configured nested subagents"] : []),
      ...(effortReason(availability, effectiveEffort) ? [`capability warning: ${effortReason(availability, effectiveEffort)}`] : []),
    ];
    const reasons = [`explicit ${source} override selected ${request.explicitHarness}`, ...warnings];
    return {
      selected: request.explicitHarness,
      automatic: false,
      explicitSource: source,
      role,
      requiresSubagents,
      ...(requestedEffort ? { requestedEffort } : {}),
      reasons,
      candidates: [{
        harness: request.explicitHarness,
        rank: 1,
        source: `explicit ${source}`,
        eligible: true,
        selected: true,
        reasons,
      }],
    };
  }

  const rolePreferences = request.routing.roles[role] ?? [];
  const ordered = uniqueHarnesses([
    request.presetHarness,
    ...rolePreferences,
    ...request.routing.preference,
    request.defaultHarness,
  ]);
  const sourceFor = (harness: Harness): string => {
    if (harness === request.presetHarness) return `role preset '${role}'`;
    const roleIndex = rolePreferences.indexOf(harness);
    if (roleIndex >= 0) return `routing.roles.${role}[${roleIndex}]`;
    const preferenceIndex = request.routing.preference.indexOf(harness);
    if (preferenceIndex >= 0) return `routing.preference[${preferenceIndex}]`;
    return "legacy defaultHarness fallback";
  };
  const explicitOnly = new Set(request.routing.explicitOnly);
  const candidates: RoutingCandidate[] = [];
  let selected: Harness | undefined;
  for (const [index, harness] of ordered.entries()) {
    const availability = request.availability[harness];
    const reasons: string[] = [`ranked by ${sourceFor(harness)}`];
    let eligible = true;
    if (explicitOnly.has(harness)) {
      eligible = false;
      reasons.push("excluded from automatic routing (explicit-only)");
    }
    if (requiresSubagents && !availability?.supportsSubagents) {
      eligible = false;
      reasons.push("excluded because nested subagents are required");
    }
    const unsupportedEffort = effortReason(availability, request.candidateEfforts?.[harness] ?? requestedEffort);
    if (unsupportedEffort) {
      eligible = false;
      reasons.push(`excluded because ${unsupportedEffort}`);
    }
    if (!availability?.available) {
      eligible = false;
      reasons.push(...(availability?.reasons ?? ["availability was not detected"]));
    } else {
      reasons.push(...availability.reasons);
    }
    const candidateSelected = eligible && selected === undefined;
    if (candidateSelected) {
      selected = harness;
      reasons.push("selected as the highest-ranked eligible harness");
    } else if (eligible) {
      reasons.push(`skipped because ${selected} ranked higher`);
    }
    candidates.push({ harness, rank: index + 1, source: sourceFor(harness), eligible, selected: candidateSelected, reasons });
  }
  const reasons = selected
    ? [`automatically selected ${selected} for role '${role}'${requiresSubagents ? " with nested subagents required" : ""}`]
    : [`no eligible installed harness for role '${role}'${requiresSubagents ? " with nested subagents required" : ""}`];
  return {
    selected,
    automatic: true,
    role,
    requiresSubagents,
    ...(requestedEffort ? { requestedEffort } : {}),
    reasons,
    candidates,
  };
}

export function formatRoutingDecision(decision: RoutingDecision): string {
  const heading = decision.selected
    ? `${decision.automatic ? "Recommended" : "Explicit"} harness: ${decision.selected}`
    : "Recommended harness: none";
  const requirements = `role=${decision.role} requiresSubagents=${decision.requiresSubagents}${decision.requestedEffort ? ` effort=${decision.requestedEffort}` : ""}`;
  const candidates = decision.candidates.map((candidate) => {
    const state = candidate.selected ? "selected" : candidate.eligible ? "eligible" : "excluded";
    return `${candidate.rank}. ${candidate.harness} [${state}] — ${candidate.reasons.join("; ")}`;
  });
  return [heading, requirements, ...decision.reasons, ...candidates].join("\n");
}
