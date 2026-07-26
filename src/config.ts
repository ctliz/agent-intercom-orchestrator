import { statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { DEFAULT_PERMISSION_PROFILES } from "./permissions.ts";
import { DEFAULT_MODEL_ROUTING, isSafeModelPattern } from "./routing.ts";
import type { Effort, GitPolicy, Harness, LaunchProfile, ModelRoutingRule, OrchestratorConfig, PermissionProfile, RolePreset, RoutingConfig, SupervisionConfig, WorkspacePolicy } from "./types.ts";

const HARNESSES: Harness[] = ["pi", "codex", "claude", "opencode"];
const EFFORTS: Effort[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function preferredLocalWrapper(name: string): string {
  const path = join(homedir(), ".local", "bin", name);
  try {
    if (statSync(path).isFile()) return path;
  } catch {
    // Fall back to PATH for normal global package installations.
  }
  return name;
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  defaultHarness: "pi",
  defaultProfiles: {
    pi: "pi-peer",
    codex: "codex-safe",
    claude: "claude-safe",
    opencode: "opencode-peer",
  },
  defaultModels: {},
  defaultEfforts: {},
  profiles: {
    "pi-peer": {
      harness: "pi",
      command: preferredLocalWrapper("pi"),
      args: ["--mode", "rpc", "--exclude-tools", "agent_fleet"],
      mode: "persistent",
      maxRuntime: "12h",
      description: "Independent wakeable Pi coworker with its own session and Intercom identity",
    },
    "codex-safe": {
      harness: "codex",
      command: preferredLocalWrapper("coi"),
      args: ["--no-tui", "--sandbox", "workspace-write", "--ask-for-approval", "on-request"],
      mode: "persistent",
      maxRuntime: "12h",
      description: "Wakeable Codex worker with a workspace-write sandbox",
    },
    "codex-minimal": {
      harness: "codex",
      command: preferredLocalWrapper("coim"),
      args: ["--no-tui"],
      mode: "persistent",
      maxRuntime: "12h",
      description: "Wakeable Codex worker using a locally configured minimal profile",
    },
    "claude-safe": {
      harness: "claude",
      command: preferredLocalWrapper("cci"),
      args: ["--safe"],
      mode: "persistent",
      maxRuntime: "12h",
      description: "Wakeable Claude Code worker with standard permission prompts",
    },
    "claude-minimal": {
      harness: "claude",
      command: preferredLocalWrapper("ccim"),
      args: ["--safe"],
      mode: "persistent",
      maxRuntime: "12h",
      description: "Wakeable minimal Claude Code worker",
    },
    "opencode-peer": {
      harness: "opencode",
      command: preferredLocalWrapper("opencode"),
      args: [],
      mode: "persistent",
      maxRuntime: "12h",
      description: "Wakeable OpenCode server coworker with a persistent session and Intercom identity",
    },
    "opencode-run": {
      harness: "opencode",
      command: preferredLocalWrapper("opencode"),
      args: ["run", "--auto", "--format", "json"],
      mode: "one-shot",
      maxRuntime: "2h",
      description: "One-shot OpenCode worker; the assignment is passed as its initial headless run prompt",
    },
  },
  permissionProfiles: structuredClone(DEFAULT_PERMISSION_PROFILES),
  roles: {
    advisor: {
      harness: "pi",
      profile: "pi-peer",
      permissionProfile: "review-readonly",
      effort: "high",
      instructions: "Act as an independent advisor coworker. Challenge plans, inspect evidence, surface tradeoffs, and do not edit files unless explicitly asked.",
    },
    builder: {
      harness: "codex",
      profile: "codex-safe",
      permissionProfile: "builder-restricted",
      effort: "high",
      instructions: "Implement the assigned scope and report verifiable evidence with completion claims.",
    },
    challenger: {
      harness: "pi",
      profile: "pi-peer",
      permissionProfile: "review-readonly",
      effort: "high",
      instructions: "Challenge completion claims, inspect the actual evidence, and identify missing proof or defects.",
    },
    reviewer: {
      harness: "pi",
      profile: "pi-peer",
      permissionProfile: "review-readonly",
      effort: "high",
      instructions: "Review the assigned work independently, inspect concrete evidence, and report defects or missing proof without editing unless asked.",
    },
    researcher: {
      harness: "pi",
      profile: "pi-peer",
      permissionProfile: "review-readonly",
      effort: "medium",
      instructions: "Research the assigned question independently, cite concrete evidence, and report uncertainty clearly.",
    },
  },
  routing: {
    preference: ["pi", "codex", "claude", "opencode"],
    explicitOnly: ["opencode"],
    roles: {
      advisor: ["pi", "codex", "claude"],
      researcher: ["pi", "codex", "claude"],
      reviewer: ["pi", "codex", "claude"],
      challenger: ["pi", "codex", "claude"],
      builder: ["codex", "claude", "pi"],
    },
    profilePreferences: {
      pi: ["pi-peer"],
      codex: ["codex-safe", "codex-minimal"],
      claude: ["claude-safe", "claude-minimal"],
      opencode: ["opencode-peer", "opencode-run"],
    },
    roleRequirements: {},
    modelRouting: structuredClone(DEFAULT_MODEL_ROUTING),
    fallback: {
      preserveRoleInstructions: true,
    },
    capabilities: {
      requiresSubagents: ["codex", "claude"],
    },
  },
  supervision: {
    recommendRalphForSubstantialWork: true,
    recommendReturnOnAfterSpawn: true,
  },
  leaseMinutes: 30,
  heartbeatSeconds: 60,
  maxRuntime: "2h",
  stopTimeoutSeconds: 5,
  idleTimeoutMinutes: 60,
  checkpointWarningMinutes: 10,
  checkpointRetryMinutes: 5,
  cleanupGraceMinutes: 15,
  cleanupTimerMinutes: 15,
  cleanupTimerEnabled: true,
  cleanupExpiredOnStart: true,
  cleanupOnShutdown: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHarness(value: unknown): value is Harness {
  return typeof value === "string" && HARNESSES.includes(value as Harness);
}

function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && EFFORTS.includes(value as Effort);
}

function isWorkspacePolicy(value: unknown): value is WorkspacePolicy {
  return value === "host" || value === "read-only" || value === "read-write";
}

function isGitPolicy(value: unknown): value is GitPolicy {
  return value === "full" || value === "read-only";
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function mergeProfile(value: unknown): LaunchProfile | undefined {
  if (!isRecord(value) || !isHarness(value.harness) || typeof value.command !== "string") return undefined;
  const args = Array.isArray(value.args) && value.args.every((item) => typeof item === "string")
    ? value.args as string[]
    : undefined;
  const env = isRecord(value.env)
    ? Object.fromEntries(Object.entries(value.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : undefined;
  const mode = value.mode === "persistent" || value.mode === "one-shot" ? value.mode : undefined;
  return {
    harness: value.harness,
    command: value.command,
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(typeof value.spawnable === "boolean" ? { spawnable: value.spawnable } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(mode ? { mode } : {}),
    ...(typeof value.maxRuntime === "string" && value.maxRuntime.trim() ? { maxRuntime: value.maxRuntime.trim() } : {}),
  };
}

function mergePermissionProfile(value: unknown, fallback?: PermissionProfile): PermissionProfile | undefined {
  if (!isRecord(value)) return undefined;
  const workspace = isWorkspacePolicy(value.workspace) ? value.workspace : fallback?.workspace;
  const git = isGitPolicy(value.git) ? value.git : fallback?.git;
  if (!workspace || !git) return undefined;
  const strings = (input: unknown): string[] | undefined => Array.isArray(input) && input.every((item) => typeof item === "string")
    ? input as string[]
    : undefined;
  const record = (input: unknown): Record<string, string> | undefined => isRecord(input)
    ? Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : undefined;
  return {
    ...(fallback ?? {}),
    workspace,
    git,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.hardened === "boolean" ? { hardened: value.hardened } : {}),
    ...(strings(value.piTools) ? { piTools: strings(value.piTools) } : {}),
    ...(strings(value.inaccessiblePaths) ? { inaccessiblePaths: strings(value.inaccessiblePaths) } : {}),
    ...(strings(value.writablePaths) ? { writablePaths: strings(value.writablePaths) } : {}),
    ...(record(value.environment) ? { environment: record(value.environment) } : {}),
    ...(record(value.systemdProperties) ? { systemdProperties: record(value.systemdProperties) } : {}),
  };
}

function mergeRole(value: unknown): RolePreset | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(isHarness(value.harness) ? { harness: value.harness } : {}),
    ...(typeof value.profile === "string" ? { profile: value.profile } : {}),
    ...(typeof value.permissionProfile === "string" ? { permissionProfile: value.permissionProfile } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(isEffort(value.effort) ? { effort: value.effort } : {}),
    ...(typeof value.instructions === "string" ? { instructions: value.instructions } : {}),
  };
}

function mergeHarnessStrings(
  value: unknown,
  fallback: Partial<Record<Harness, string>>,
): Partial<Record<Harness, string>> {
  const result = { ...fallback };
  if (!isRecord(value)) return result;
  for (const harness of HARNESSES) {
    if (typeof value[harness] === "string" && value[harness].trim()) result[harness] = value[harness].trim();
  }
  return result;
}

function mergeHarnessEfforts(
  value: unknown,
  fallback: Partial<Record<Harness, Effort>>,
): Partial<Record<Harness, Effort>> {
  const result = { ...fallback };
  if (!isRecord(value)) return result;
  for (const harness of HARNESSES) {
    if (isEffort(value[harness])) result[harness] = value[harness];
  }
  return result;
}

function mergeHarnessList(value: unknown, fallback: Harness[]): Harness[] {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter(isHarness))];
}

function mergeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))];
}

function mergeProfilePreferences(
  value: unknown,
  fallback: RoutingConfig["profilePreferences"],
  defaultProfiles: OrchestratorConfig["defaultProfiles"],
): RoutingConfig["profilePreferences"] {
  const input = isRecord(value) ? value : {};
  const result: RoutingConfig["profilePreferences"] = {};
  for (const harness of HARNESSES) {
    const hasExplicitOrder = Object.hasOwn(input, harness) && Array.isArray(input[harness]);
    const order = mergeStringList(input[harness], fallback[harness] ?? []);
    result[harness] = hasExplicitOrder
      ? order
      : [...new Set([defaultProfiles[harness], ...order].filter((item): item is string => Boolean(item)))];
  }
  return result;
}

function mergeModelRules(value: unknown, fallback: ModelRoutingRule[]): ModelRoutingRule[] {
  if (!Array.isArray(value)) return structuredClone(fallback);
  return value.flatMap((candidate): ModelRoutingRule[] => {
    if (!isRecord(candidate) || !isHarness(candidate.harness) || !Array.isArray(candidate.patterns)) return [];
    const patterns = [...new Set(candidate.patterns
      .filter((pattern): pattern is string => typeof pattern === "string")
      .map((pattern) => pattern.trim())
      .filter(isSafeModelPattern))];
    return patterns.length ? [{ harness: candidate.harness, patterns }] : [];
  });
}

function mergeModelRouting(value: unknown): RoutingConfig["modelRouting"] {
  const fallback = DEFAULT_CONFIG.routing.modelRouting;
  if (!isRecord(value)) return structuredClone(fallback);
  const stripPrefixes: RoutingConfig["modelRouting"]["stripPrefixes"] = {};
  const inputPrefixes = isRecord(value.stripPrefixes) ? value.stripPrefixes : {};
  for (const harness of HARNESSES) {
    const prefixes = mergeStringList(inputPrefixes[harness], fallback.stripPrefixes[harness] ?? [])
      .filter((prefix) => !prefix.includes("*"));
    if (prefixes.length || Object.hasOwn(inputPrefixes, harness) || fallback.stripPrefixes[harness]) {
      stripPrefixes[harness] = prefixes;
    }
  }
  return {
    unmatchedHarness: value.unmatchedHarness === null
      ? null
      : isHarness(value.unmatchedHarness)
        ? value.unmatchedHarness
        : fallback.unmatchedHarness,
    rules: mergeModelRules(value.rules, fallback.rules),
    stripPrefixes,
  };
}

function mergeSupervision(value: unknown): SupervisionConfig {
  const fallback = DEFAULT_CONFIG.supervision;
  if (!isRecord(value)) return structuredClone(fallback);
  return {
    recommendRalphForSubstantialWork: typeof value.recommendRalphForSubstantialWork === "boolean"
      ? value.recommendRalphForSubstantialWork
      : fallback.recommendRalphForSubstantialWork,
    recommendReturnOnAfterSpawn: typeof value.recommendReturnOnAfterSpawn === "boolean"
      ? value.recommendReturnOnAfterSpawn
      : fallback.recommendReturnOnAfterSpawn,
  };
}

function mergeRouting(
  value: unknown,
  defaultProfiles: OrchestratorConfig["defaultProfiles"],
  legacyDefaultHarness?: Harness,
): RoutingConfig {
  const fallback = DEFAULT_CONFIG.routing;
  if (!isRecord(value)) {
    const routing = structuredClone(fallback);
    routing.profilePreferences = mergeProfilePreferences(undefined, fallback.profilePreferences, defaultProfiles);
    if (legacyDefaultHarness) {
      routing.preference = [...new Set([legacyDefaultHarness, ...routing.preference])];
    }
    return routing;
  }
  const roles = structuredClone(fallback.roles);
  if (isRecord(value.roles)) {
    for (const [role, preference] of Object.entries(value.roles)) {
      if (Array.isArray(preference)) roles[role] = [...new Set(preference.filter(isHarness))];
    }
  }
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  const roleRequirements = structuredClone(fallback.roleRequirements);
  if (isRecord(value.roleRequirements)) {
    for (const [role, requirement] of Object.entries(value.roleRequirements)) {
      if (!isRecord(requirement)) continue;
      roleRequirements[role] = {
        ...(typeof requirement.requiresSubagents === "boolean" ? { requiresSubagents: requirement.requiresSubagents } : {}),
      };
    }
  }
  const fallbackPolicy = isRecord(value.fallback) ? value.fallback : {};
  return {
    preference: mergeHarnessList(value.preference, fallback.preference),
    explicitOnly: mergeHarnessList(value.explicitOnly, fallback.explicitOnly),
    roles,
    profilePreferences: mergeProfilePreferences(value.profilePreferences, fallback.profilePreferences, defaultProfiles),
    roleRequirements,
    modelRouting: mergeModelRouting(value.modelRouting),
    fallback: {
      preserveRoleInstructions: typeof fallbackPolicy.preserveRoleInstructions === "boolean"
        ? fallbackPolicy.preserveRoleInstructions
        : fallback.fallback.preserveRoleInstructions,
    },
    capabilities: {
      requiresSubagents: mergeHarnessList(capabilities.requiresSubagents, fallback.capabilities.requiresSubagents),
    },
  };
}

export function mergeConfig(value: unknown): OrchestratorConfig {
  if (!isRecord(value)) return structuredClone(DEFAULT_CONFIG);
  const profiles = structuredClone(DEFAULT_CONFIG.profiles);
  if (isRecord(value.profiles)) {
    for (const [name, profileValue] of Object.entries(value.profiles)) {
      const profile = mergeProfile(profileValue);
      if (profile) profiles[name] = profile;
    }
  }
  const permissionProfiles = structuredClone(DEFAULT_CONFIG.permissionProfiles);
  if (isRecord(value.permissionProfiles)) {
    for (const [name, permissionValue] of Object.entries(value.permissionProfiles)) {
      const permission = mergePermissionProfile(permissionValue, permissionProfiles[name]);
      if (permission) permissionProfiles[name] = permission;
    }
  }
  const roles = structuredClone(DEFAULT_CONFIG.roles);
  if (isRecord(value.roles)) {
    for (const [name, roleValue] of Object.entries(value.roles)) {
      const role = mergeRole(roleValue);
      if (role) roles[name] = { ...(roles[name] ?? {}), ...role };
    }
  }
  const defaultHarness = isHarness(value.defaultHarness) ? value.defaultHarness : DEFAULT_CONFIG.defaultHarness;
  const defaultProfiles = mergeHarnessStrings(value.defaultProfiles, DEFAULT_CONFIG.defaultProfiles);
  const idleTimeoutMinutes = positiveNumber(value.idleTimeoutMinutes, DEFAULT_CONFIG.idleTimeoutMinutes);
  const checkpointWarningMinutes = Math.min(
    positiveNumber(value.checkpointWarningMinutes, DEFAULT_CONFIG.checkpointWarningMinutes),
    idleTimeoutMinutes,
  );
  return {
    defaultHarness,
    defaultProfiles,
    defaultModels: mergeHarnessStrings(value.defaultModels, DEFAULT_CONFIG.defaultModels),
    defaultEfforts: mergeHarnessEfforts(value.defaultEfforts, DEFAULT_CONFIG.defaultEfforts),
    profiles,
    permissionProfiles,
    roles,
    routing: mergeRouting(value.routing, defaultProfiles, !isRecord(value.routing) && isHarness(value.defaultHarness) ? defaultHarness : undefined),
    supervision: mergeSupervision(value.supervision),
    leaseMinutes: positiveNumber(value.leaseMinutes, DEFAULT_CONFIG.leaseMinutes),
    heartbeatSeconds: positiveNumber(value.heartbeatSeconds, DEFAULT_CONFIG.heartbeatSeconds),
    maxRuntime: typeof value.maxRuntime === "string" && value.maxRuntime.trim() ? value.maxRuntime : DEFAULT_CONFIG.maxRuntime,
    stopTimeoutSeconds: positiveNumber(value.stopTimeoutSeconds, DEFAULT_CONFIG.stopTimeoutSeconds),
    idleTimeoutMinutes,
    checkpointWarningMinutes,
    checkpointRetryMinutes: positiveNumber(value.checkpointRetryMinutes, DEFAULT_CONFIG.checkpointRetryMinutes),
    cleanupGraceMinutes: positiveNumber(value.cleanupGraceMinutes, DEFAULT_CONFIG.cleanupGraceMinutes),
    cleanupTimerMinutes: positiveNumber(value.cleanupTimerMinutes, DEFAULT_CONFIG.cleanupTimerMinutes),
    cleanupTimerEnabled:
      typeof value.cleanupTimerEnabled === "boolean" ? value.cleanupTimerEnabled : DEFAULT_CONFIG.cleanupTimerEnabled,
    cleanupExpiredOnStart:
      typeof value.cleanupExpiredOnStart === "boolean" ? value.cleanupExpiredOnStart : DEFAULT_CONFIG.cleanupExpiredOnStart,
    cleanupOnShutdown:
      typeof value.cleanupOnShutdown === "boolean" ? value.cleanupOnShutdown : DEFAULT_CONFIG.cleanupOnShutdown,
  };
}

export async function readConfig(path: string): Promise<OrchestratorConfig> {
  try {
    return mergeConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(DEFAULT_CONFIG);
    throw new Error(`Could not read orchestrator config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeConfigValue(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function writeConfig(path: string, config: OrchestratorConfig): Promise<void> {
  await writeConfigValue(path, config);
}

export async function writeConfigDefaults(path: string, config: OrchestratorConfig): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (isRecord(parsed)) existing = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const defaultProfiles = Object.fromEntries(
    HARNESSES
      .filter((harness) => config.defaultProfiles[harness] !== DEFAULT_CONFIG.defaultProfiles[harness])
      .map((harness) => [harness, config.defaultProfiles[harness]]),
  );
  const permissionProfiles = Object.fromEntries(
    Object.entries(config.permissionProfiles).flatMap(([name, profile]) => {
      const builtIn = DEFAULT_CONFIG.permissionProfiles[name];
      if (!builtIn) return [[name, profile]];
      const delta = Object.fromEntries(
        Object.entries(profile).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(builtIn[key as keyof PermissionProfile])),
      );
      return Object.keys(delta).length ? [[name, delta]] : [];
    }),
  );
  const roles = Object.fromEntries(
    Object.entries(config.roles).flatMap(([name, role]) => {
      const builtIn = DEFAULT_CONFIG.roles[name];
      if (!builtIn) return [[name, role]];
      const delta = Object.fromEntries(
        Object.entries(role).filter(([key, value]) => value !== builtIn[key as keyof RolePreset]),
      );
      return Object.keys(delta).length ? [[name, delta]] : [];
    }),
  );
  const hadRoutingObject = isRecord(existing.routing);
  const existingRouting = hadRoutingObject ? structuredClone(existing.routing as Record<string, unknown>) : {};
  const routingRoles = Object.fromEntries(
    Object.entries(config.routing.roles).filter(([name, preference]) =>
      JSON.stringify(preference) !== JSON.stringify(DEFAULT_CONFIG.routing.roles[name])),
  );
  const profilePreferenceDelta = Object.fromEntries(HARNESSES.flatMap((harness) =>
    JSON.stringify(config.routing.profilePreferences[harness] ?? []) !== JSON.stringify(DEFAULT_CONFIG.routing.profilePreferences[harness] ?? [])
      ? [[harness, config.routing.profilePreferences[harness] ?? []]]
      : []));
  const existingProfilePreferences = isRecord(existingRouting.profilePreferences)
    ? structuredClone(existingRouting.profilePreferences)
    : {};
  for (const harness of HARNESSES) delete existingProfilePreferences[harness];
  const profilePreferences = { ...existingProfilePreferences, ...profilePreferenceDelta };
  const modelStripPrefixDelta = Object.fromEntries(HARNESSES.flatMap((harness) =>
    JSON.stringify(config.routing.modelRouting.stripPrefixes[harness] ?? []) !== JSON.stringify(DEFAULT_CONFIG.routing.modelRouting.stripPrefixes[harness] ?? [])
      ? [[harness, config.routing.modelRouting.stripPrefixes[harness] ?? []]]
      : []));
  const existingModelRouting = isRecord(existingRouting.modelRouting)
    ? structuredClone(existingRouting.modelRouting)
    : {};
  const existingModelStripPrefixes = isRecord(existingModelRouting.stripPrefixes)
    ? structuredClone(existingModelRouting.stripPrefixes)
    : {};
  for (const harness of HARNESSES) delete existingModelStripPrefixes[harness];
  const modelStripPrefixes = { ...existingModelStripPrefixes, ...modelStripPrefixDelta };
  delete existingModelRouting.unmatchedHarness;
  delete existingModelRouting.rules;
  delete existingModelRouting.stripPrefixes;
  const modelRouting = {
    ...existingModelRouting,
    ...(config.routing.modelRouting.unmatchedHarness !== DEFAULT_CONFIG.routing.modelRouting.unmatchedHarness
      ? { unmatchedHarness: config.routing.modelRouting.unmatchedHarness }
      : {}),
    ...(JSON.stringify(config.routing.modelRouting.rules) !== JSON.stringify(DEFAULT_CONFIG.routing.modelRouting.rules)
      ? { rules: config.routing.modelRouting.rules }
      : {}),
    ...(Object.keys(modelStripPrefixes).length ? { stripPrefixes: modelStripPrefixes } : {}),
  };
  const existingFallback = isRecord(existingRouting.fallback) ? structuredClone(existingRouting.fallback) : {};
  delete existingFallback.preserveRoleInstructions;
  const fallback = {
    ...existingFallback,
    ...(config.routing.fallback.preserveRoleInstructions !== DEFAULT_CONFIG.routing.fallback.preserveRoleInstructions
      ? { preserveRoleInstructions: config.routing.fallback.preserveRoleInstructions }
      : {}),
  };
  const existingCapabilities = isRecord(existingRouting.capabilities) ? structuredClone(existingRouting.capabilities) : {};
  delete existingCapabilities.requiresSubagents;
  const capabilities = {
    ...existingCapabilities,
    ...(JSON.stringify(config.routing.capabilities.requiresSubagents) !== JSON.stringify(DEFAULT_CONFIG.routing.capabilities.requiresSubagents)
      ? { requiresSubagents: config.routing.capabilities.requiresSubagents }
      : {}),
  };
  const routingDelta = {
    ...(JSON.stringify(config.routing.preference) !== JSON.stringify(DEFAULT_CONFIG.routing.preference)
      ? { preference: config.routing.preference }
      : {}),
    ...(JSON.stringify(config.routing.explicitOnly) !== JSON.stringify(DEFAULT_CONFIG.routing.explicitOnly)
      ? { explicitOnly: config.routing.explicitOnly }
      : {}),
    ...(Object.keys(routingRoles).length ? { roles: routingRoles } : {}),
    ...(Object.keys(profilePreferences).length ? { profilePreferences } : {}),
    ...(Object.keys(config.routing.roleRequirements).length ? { roleRequirements: config.routing.roleRequirements } : {}),
    ...(Object.keys(modelRouting).length ? { modelRouting } : {}),
    ...(Object.keys(fallback).length ? { fallback } : {}),
    ...(Object.keys(capabilities).length ? { capabilities } : {}),
  };
  for (const key of ["preference", "explicitOnly", "roles", "profilePreferences", "roleRequirements", "modelRouting", "fallback", "capabilities"]) {
    delete existingRouting[key];
  }
  const routing = { ...existingRouting, ...routingDelta };
  const hadSupervisionObject = isRecord(existing.supervision);
  const existingSupervision = hadSupervisionObject ? structuredClone(existing.supervision as Record<string, unknown>) : {};
  delete existingSupervision.recommendRalphForSubstantialWork;
  delete existingSupervision.recommendReturnOnAfterSpawn;
  const supervision = {
    ...existingSupervision,
    ...(config.supervision.recommendRalphForSubstantialWork !== DEFAULT_CONFIG.supervision.recommendRalphForSubstantialWork
      ? { recommendRalphForSubstantialWork: config.supervision.recommendRalphForSubstantialWork }
      : {}),
    ...(config.supervision.recommendReturnOnAfterSpawn !== DEFAULT_CONFIG.supervision.recommendReturnOnAfterSpawn
      ? { recommendReturnOnAfterSpawn: config.supervision.recommendReturnOnAfterSpawn }
      : {}),
  };
  await writeConfigValue(path, {
    ...existing,
    defaultHarness: config.defaultHarness,
    defaultProfiles,
    defaultModels: config.defaultModels,
    defaultEfforts: config.defaultEfforts,
    permissionProfiles,
    roles,
    routing: Object.keys(routing).length ? routing : hadRoutingObject ? {} : undefined,
    supervision: Object.keys(supervision).length ? supervision : hadSupervisionObject ? {} : undefined,
    leaseMinutes: config.leaseMinutes,
    heartbeatSeconds: config.heartbeatSeconds,
    maxRuntime: config.maxRuntime,
    stopTimeoutSeconds: config.stopTimeoutSeconds,
    idleTimeoutMinutes: config.idleTimeoutMinutes,
    checkpointWarningMinutes: config.checkpointWarningMinutes,
    checkpointRetryMinutes: config.checkpointRetryMinutes,
    cleanupGraceMinutes: config.cleanupGraceMinutes,
    cleanupTimerMinutes: config.cleanupTimerMinutes,
    cleanupTimerEnabled: config.cleanupTimerEnabled,
    cleanupExpiredOnStart: config.cleanupExpiredOnStart,
    cleanupOnShutdown: config.cleanupOnShutdown,
  });
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function resolveProfileCommand(command: string, pathEnv = process.env.PATH ?? ""): string | undefined {
  const expanded = expandHome(command);
  if (isAbsolute(expanded)) {
    try {
      const stat = statSync(expanded);
      return stat.isFile() && (stat.mode & 0o111) !== 0 ? expanded : undefined;
    } catch {
      return undefined;
    }
  }
  for (const directory of pathEnv.split(":")) {
    if (!directory) continue;
    const candidate = join(directory, expanded);
    try {
      const stat = statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}
