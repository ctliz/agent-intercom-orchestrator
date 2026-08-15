import { access, readFile, realpath } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export type AdapterId = "pi" | "codex" | "claude" | "opencode" | "orchestrator";

export interface UpdateCommand {
  command: string;
  args: string[];
  display: string;
}

export interface AdapterVersion {
  id: AdapterId;
  packageName: string;
  current?: string;
  latest?: string;
  source: "pi-git" | "pi-npm" | "npm-global" | "git" | "local" | "missing";
  root?: string;
  sourceSpec?: string;
  status: "current" | "outdated" | "ahead" | "missing" | "unknown" | "migration-required" | "dual-load";
  update?: UpdateCommand;
  blockedReason?: string;
  /** Legacy `0.11.0-connect.1` (@dataforxyz/*) install surfaces found for this adapter, if any. */
  legacySurfaces?: LegacySurface[];
}

/**
 * Historical 0.11.0-connect.1 shipped under `@dataforxyz/*`; canonical `@ctliz/*`
 * began with 0.11.0-connect.2 and continues with coordinated 0.12.0-connect.1.
 *
 * The retired namespace is a *migration-detection input only*. It is never a
 * healthy or current installation, is never auto-upgraded in place, and is
 * never silently overwritten. It is deliberately confined to this registry and
 * the migration docs so it cannot leak back into normal runtime imports.
 */
export const LEGACY_NPM_SCOPE = "@dataforxyz";
export const CANONICAL_NPM_SCOPE = "@ctliz";
export const LEGACY_GITHUB_OWNER = "dataforxyz";
export const CANONICAL_GITHUB_OWNER = "ctliz";

export type LegacySurfaceKind = "pi-settings" | "git-checkout" | "node-modules" | "global-bin";

export interface LegacySurface {
  kind: LegacySurfaceKind;
  /** Filesystem path or settings spec that still carries the retired identity. */
  detail: string;
}

export type MigrationCode = "OK" | "MIGRATION_REQUIRED" | "DUPLICATE_INSTALL";

export interface MigrationDiagnosis {
  code: MigrationCode;
  /** True when setup/update must refuse to proceed. */
  blocked: boolean;
  summary: string;
  legacySurfaces: LegacySurface[];
  canonicalSurfaces: LegacySurface[];
  remediation: string[];
}

export interface HarnessVersion {
  harness: "pi" | "codex" | "claude" | "opencode";
  version?: string;
  command?: string;
  args?: string[];
  source?: "manager-runtime" | "profile";
}

export interface HarnessRuntime {
  command: string;
  args?: string[];
  source?: "manager-runtime" | "profile";
  version?: string;
}

const ADAPTERS: Array<{ id: AdapterId; packageName: string; repo: string; binary?: "coi" | "cci" }> = [
  { id: "pi", packageName: "@ctliz/agent-intercom-pi", repo: "agent-intercom-pi" },
  { id: "codex", packageName: "@ctliz/agent-intercom-codex", repo: "agent-intercom-codex", binary: "coi" },
  { id: "claude", packageName: "@ctliz/agent-intercom-claude", repo: "agent-intercom-claude", binary: "cci" },
  { id: "opencode", packageName: "@ctliz/agent-intercom-opencode", repo: "agent-intercom-opencode" },
  { id: "orchestrator", packageName: "@ctliz/agent-intercom-orchestrator", repo: "agent-intercom-orchestrator" },
];

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandSpec(command: string, args: string[]): UpdateCommand {
  return { command, args, display: [command, ...args].map(shellQuote).join(" ") };
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path: string): Promise<any | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return undefined; }
}

async function packageRootFrom(start: string | undefined, packageName: string): Promise<string | undefined> {
  if (!start) return undefined;
  let current: string;
  try {
    const resolved = await realpath(start);
    current = (await exists(join(resolved, "package.json"))) ? resolved : dirname(resolved);
  } catch {
    return undefined;
  }
  const root = parse(current).root;
  while (current !== root) {
    const manifest = await readJson(join(current, "package.json"));
    if (manifest?.name === packageName) return current;
    current = dirname(current);
  }
  return undefined;
}

async function versionAt(root: string | undefined): Promise<string | undefined> {
  if (!root) return undefined;
  const manifest = await readJson(join(root, "package.json"));
  return typeof manifest?.version === "string" ? manifest.version : undefined;
}

function gitRoot(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const result = spawnSync("git", ["-C", path, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function gitDirty(path: string): boolean {
  const result = spawnSync("git", ["-C", path, "status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status !== 0 || Boolean(result.stdout.trim());
}

function npmGlobalRoot(): string | undefined {
  const result = spawnSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

async function piPackageSources(agentDir: string): Promise<string[]> {
  const settings = await readJson(join(agentDir, "settings.json"));
  return Array.isArray(settings?.packages) ? settings.packages.filter((entry: unknown): entry is string => typeof entry === "string") : [];
}

function legacyPackageName(adapter: { packageName: string }): string {
  return adapter.packageName.replace(`${CANONICAL_NPM_SCOPE}/`, `${LEGACY_NPM_SCOPE}/`);
}

/**
 * Matches a Pi settings spec to an adapter. The retired identity is matched on
 * purpose so a legacy `0.11.0-connect.1` (@dataforxyz/*) install is *detected*, never so it is accepted.
 */
function sourceMatches(source: string, adapter: { packageName: string; repo: string }): boolean {
  return (
    source.includes(adapter.packageName)
    || source.includes(legacyPackageName(adapter))
    || source.includes(`/${adapter.repo}`)
    || source.includes(`/${adapter.repo}.git`)
    || source.includes(`/${adapter.repo}@`)
    || source.includes(`/${adapter.repo}#`)
    || sourceIsLegacy(source, adapter)
  );
}

function isCanonicalGitSpec(spec: string): boolean {
  if (
    /@v?[\d.]+-connect\.2(?:$|[#?])/.test(spec)
    || /@connect\.2(?:$|[#?])/.test(spec)
    || /@v?0\.(?:1[2-9]|[2-9]\d)\.[\d.]+(?:-connect\.\d+)?(?:$|[#?])/.test(spec)
    || /@v?[1-9]\d*\.[\d.]+(?:-connect\.\d+)?(?:$|[#?])/.test(spec)
  ) {
    return true;
  }
  return false;
}

function sourceIsLegacy(source: string, adapter: { packageName: string; repo: string }): boolean {
  if (
    source.includes(legacyPackageName(adapter))
    || source.includes(`${LEGACY_GITHUB_OWNER}/${adapter.repo}`)
  ) {
    return true;
  }
  if (source.startsWith("git:github.com/") && source.includes(`${CANONICAL_GITHUB_OWNER}/${adapter.repo}`)) {
    if (isCanonicalGitSpec(source)) {
      return false;
    }
    return true;
  }
  return false;
}

function rootFromPiSource(agentDir: string, source: string, adapter: { packageName: string; repo: string }): string | undefined {
  if (source.startsWith("git:github.com/")) {
    const match = /^git:github\.com\/([^/@#]+)\/([^/@#]+)/.exec(source);
    if (match) {
      return join(agentDir, "git", "github.com", match[1], match[2]);
    }
  }
  if (source.startsWith("npm:")) {
    const raw = source.slice(4);
    const slash = raw.indexOf("/");
    if (slash !== -1) {
      const scope = raw.slice(0, slash);
      const pkg = raw.slice(slash + 1).split("@")[0];
      return join(agentDir, "npm", "node_modules", scope, pkg);
    }
  }
  return undefined;
}

async function configuredOpenCodePluginRoot(home: string | undefined, packageName: string): Promise<string | undefined> {
  if (!home) return undefined;
  for (const file of [join(home, ".config", "opencode", "opencode.json"), join(home, ".config", "opencode", "opencode.jsonc")]) {
    const config = await readJson(file);
    if (!Array.isArray(config?.plugin)) continue;
    for (const entry of config.plugin) {
      if (typeof entry !== "string" || !entry.includes("agent-intercom-opencode")) continue;
      const root = await packageRootFrom(resolve(entry), packageName);
      if (root) return root;
    }
  }
  return undefined;
}

async function manifestNameAt(root: string | undefined): Promise<string | undefined> {
  if (!root) return undefined;
  const manifest = await readJson(join(root, "package.json"));
  return typeof manifest?.name === "string" ? manifest.name : undefined;
}

function isLegacyPackageName(name: string | undefined): boolean {
  return typeof name === "string" && (name.startsWith(`${LEGACY_NPM_SCOPE}/agent-intercom-`) || name.startsWith(`${LEGACY_NPM_SCOPE}/`));
}

function isCanonicalPackageName(name: string | undefined): boolean {
  return typeof name === "string" && (name.startsWith(`${CANONICAL_NPM_SCOPE}/agent-intercom-`) || name.startsWith(`${CANONICAL_NPM_SCOPE}/`));
}

function dedupeSurfaces(surfaces: LegacySurface[]): LegacySurface[] {
  const seen = new Set<string>();
  const result: LegacySurface[] = [];
  for (const s of surfaces) {
    const key = `${s.kind}:${s.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(s);
    }
  }
  return result;
}

/**
 * Scans the *active install surfaces of the current OS user* for both legacy
 * and canonical Agent Intercom namespaces.
 *
 * Primary classification fact is the resolved package manifest (`package.json`
 * `name`), NOT purely the repository URL or filesystem directory owner.
 * This ensures that a checkout at `github.com/ctliz/agent-intercom-pi` whose
 * manifest still declares `@dataforxyz/agent-intercom-pi` is correctly diagnosed
 * as `MIGRATION_REQUIRED`.
 */
async function scanAllInstallSurfaces(options: {
  agentDir: string;
  globalRoot?: string;
  pathDirs?: string[];
}): Promise<{ legacySurfaces: LegacySurface[]; canonicalSurfaces: LegacySurface[] }> {
  const { agentDir } = options;
  const legacySurfaces: LegacySurface[] = [];
  const canonicalSurfaces: LegacySurface[] = [];

  // 1. Pi settings package sources
  for (const spec of await piPackageSources(agentDir)) {
    if (!spec.includes("agent-intercom-")) continue;

    let resolvedRoot: string | undefined;
    if (spec.startsWith("git:github.com/")) {
      const match = /^git:github\.com\/([^/@#]+)\/([^/@#]+)/.exec(spec);
      if (match) {
        resolvedRoot = join(agentDir, "git", "github.com", match[1], match[2]);
      }
    } else if (spec.startsWith("npm:")) {
      const raw = spec.slice(4);
      const slash = raw.indexOf("/");
      if (slash !== -1) {
        const scope = raw.slice(0, slash);
        const pkg = raw.slice(slash + 1).split("@")[0];
        resolvedRoot = join(agentDir, "npm", "node_modules", scope, pkg);
      }
    }

    const manifestName = await manifestNameAt(resolvedRoot);
    if (isLegacyPackageName(manifestName)) {
      legacySurfaces.push({ kind: "pi-settings", detail: spec });
    } else if (isCanonicalPackageName(manifestName)) {
      canonicalSurfaces.push({ kind: "pi-settings", detail: spec });
    } else if (spec.startsWith("npm:")) {
      if (spec.includes(LEGACY_NPM_SCOPE)) {
        legacySurfaces.push({ kind: "pi-settings", detail: spec });
      } else if (spec.includes(CANONICAL_NPM_SCOPE)) {
        canonicalSurfaces.push({ kind: "pi-settings", detail: spec });
      } else {
        legacySurfaces.push({ kind: "pi-settings", detail: spec });
      }
    } else if (spec.startsWith("git:github.com/")) {
      if (spec.includes(`${LEGACY_GITHUB_OWNER}/`) || spec.includes(LEGACY_NPM_SCOPE)) {
        legacySurfaces.push({ kind: "pi-settings", detail: spec });
      } else if (spec.includes(`${CANONICAL_GITHUB_OWNER}/`)) {
        if (isCanonicalGitSpec(spec)) {
          canonicalSurfaces.push({ kind: "pi-settings", detail: spec });
        } else {
          legacySurfaces.push({ kind: "pi-settings", detail: spec });
        }
      } else {
        legacySurfaces.push({ kind: "pi-settings", detail: spec });
      }
    }
  }

  // 2. Git checkouts
  for (const adapter of ADAPTERS) {
    for (const owner of [LEGACY_GITHUB_OWNER, CANONICAL_GITHUB_OWNER]) {
      const checkout = join(agentDir, "git", "github.com", owner, adapter.repo);
      if (await exists(join(checkout, "package.json"))) {
        const manifestName = await manifestNameAt(checkout);
        if (isLegacyPackageName(manifestName)) {
          legacySurfaces.push({ kind: "git-checkout", detail: checkout });
        } else if (isCanonicalPackageName(manifestName)) {
          canonicalSurfaces.push({ kind: "git-checkout", detail: checkout });
        } else if (owner === LEGACY_GITHUB_OWNER) {
          legacySurfaces.push({ kind: "git-checkout", detail: checkout });
        } else if (owner === CANONICAL_GITHUB_OWNER) {
          canonicalSurfaces.push({ kind: "git-checkout", detail: checkout });
        }
      }
    }
  }

  // 3. Managed and global node_modules
  for (const adapter of ADAPTERS) {
    for (const scope of [LEGACY_NPM_SCOPE, CANONICAL_NPM_SCOPE]) {
      const managed = join(agentDir, "npm", "node_modules", scope, adapter.repo);
      if (await exists(join(managed, "package.json"))) {
        const manifestName = await manifestNameAt(managed);
        if (isLegacyPackageName(manifestName) || (manifestName === undefined && scope === LEGACY_NPM_SCOPE)) {
          legacySurfaces.push({ kind: "node-modules", detail: managed });
        } else if (isCanonicalPackageName(manifestName) || (manifestName === undefined && scope === CANONICAL_NPM_SCOPE)) {
          canonicalSurfaces.push({ kind: "node-modules", detail: managed });
        }
      }

      if (options.globalRoot) {
        const global = join(options.globalRoot, scope, adapter.repo);
        if (await exists(join(global, "package.json"))) {
          const manifestName = await manifestNameAt(global);
          if (isLegacyPackageName(manifestName) || (manifestName === undefined && scope === LEGACY_NPM_SCOPE)) {
            legacySurfaces.push({ kind: "node-modules", detail: global });
          } else if (isCanonicalPackageName(manifestName) || (manifestName === undefined && scope === CANONICAL_NPM_SCOPE)) {
            canonicalSurfaces.push({ kind: "node-modules", detail: global });
          }
        }
      }
    }
  }

  // 4. Global bin links
  for (const dir of options.pathDirs ?? []) {
    for (const binary of ["coi", "cci", "agent-intercom-fleet"] as const) {
      const link = join(dir, binary);
      if (!(await exists(link))) continue;
      let target: string;
      try {
        target = await realpath(link);
      } catch {
        continue;
      }
      let foundName: string | undefined;
      for (const scope of [CANONICAL_NPM_SCOPE, LEGACY_NPM_SCOPE]) {
        for (const repo of ["agent-intercom-codex", "agent-intercom-claude", "agent-intercom-orchestrator"]) {
          const root = await packageRootFrom(target, `${scope}/${repo}`);
          if (root) {
            foundName = await manifestNameAt(root);
            break;
          }
        }
        if (foundName) break;
      }
      if (isLegacyPackageName(foundName)) {
        legacySurfaces.push({ kind: "global-bin", detail: `${link} -> ${target}` });
      } else if (isCanonicalPackageName(foundName)) {
        canonicalSurfaces.push({ kind: "global-bin", detail: `${link} -> ${target}` });
      } else if (target.includes(LEGACY_NPM_SCOPE) || target.includes(`${LEGACY_GITHUB_OWNER}/agent-intercom-`)) {
        legacySurfaces.push({ kind: "global-bin", detail: `${link} -> ${target}` });
      } else if (target.includes(CANONICAL_NPM_SCOPE) || target.includes(`${CANONICAL_GITHUB_OWNER}/agent-intercom-`)) {
        canonicalSurfaces.push({ kind: "global-bin", detail: `${link} -> ${target}` });
      }
    }
  }

  return {
    legacySurfaces: dedupeSurfaces(legacySurfaces),
    canonicalSurfaces: dedupeSurfaces(canonicalSurfaces),
  };
}

/**
 * Fail-closed classification of the 0.11.0-connect.1 (@dataforxyz/*) -> @ctliz/* migration.
 *
 * - legacy only  -> MIGRATION_REQUIRED (blocked; uninstall-then-install plan)
 * - both present -> DUPLICATE_INSTALL  (blocked; dual-load hard error)
 *
 * A legacy surface is never reported as current/healthy and is never upgraded
 * in place, so setup and update cannot silently overwrite a 0.11.0-connect.1 install.
 */
export async function diagnoseNamespaceMigration(options: {
  agentDir: string;
  globalRoot?: string;
  pathDirs?: string[];
}): Promise<MigrationDiagnosis> {
  const { legacySurfaces, canonicalSurfaces } = await scanAllInstallSurfaces({
    agentDir: options.agentDir,
    globalRoot: options.globalRoot,
    pathDirs: options.pathDirs,
  });

  if (legacySurfaces.length > 0 && canonicalSurfaces.length > 0) {
    return {
      code: "DUPLICATE_INSTALL",
      blocked: true,
      summary:
        `Both ${LEGACY_NPM_SCOPE}/* (0.11.0-connect.1) and ${CANONICAL_NPM_SCOPE}/* install surfaces are present. `
        + "Across npm/global/project/active-session surfaces they can load as separate extensions with conflicting binaries and separate broker registration paths.",
      legacySurfaces,
      canonicalSurfaces,
      remediation: [
        "Stop or close the installed broker-capable adapters.",
        `Remove every ${LEGACY_NPM_SCOPE}/* spec, package, and binary link listed above.`,
        "Re-run this check and confirm no legacy surface remains.",
        "Only then reload or restart, and verify exactly one broker is running.",
      ],
    };
  }

  if (legacySurfaces.length > 0) {
    return {
      code: "MIGRATION_REQUIRED",
      blocked: true,
      summary: `Only ${LEGACY_NPM_SCOPE}/* (0.11.0-connect.1) install surfaces are present; canonical uses ${CANONICAL_NPM_SCOPE}/*.`,
      legacySurfaces,
      canonicalSurfaces,
      remediation: [
        "Back up the exact specs, lock files, and settings of every installed component.",
        "Stop or close the installed broker-capable adapters.",
        `Remove the ${LEGACY_NPM_SCOPE}/* specs, packages, and binary links listed above.`,
        `Install the ${CANONICAL_NPM_SCOPE}/* exact tags for the components you actually use.`,
        "Reload or restart, then verify exactly one broker is running.",
      ],
    };
  }

  return {
    code: "OK",
    blocked: false,
    summary: canonicalSurfaces.length > 0
      ? `Only ${CANONICAL_NPM_SCOPE}/* (connect.2) install surfaces are present.`
      : "No Agent Intercom install surfaces were found for this user.",
    legacySurfaces,
    canonicalSurfaces,
    remediation: [],
  };
}

export async function fetchLatestNpmVersion(packageName: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    const body = await response.json() as { version?: unknown };
    return typeof body.version === "string" ? body.version : undefined;
  } catch {
    return undefined;
  }
}

function statusFor(current: string | undefined, latest: string | undefined): AdapterVersion["status"] {
  if (!current) return "missing";
  if (!latest) return "unknown";
  if (current === latest) return "current";
  const comparison = current.localeCompare(latest, undefined, { numeric: true, sensitivity: "base" });
  return comparison < 0 ? "outdated" : "ahead";
}

export async function inspectAdapterFamily(options: {
  agentDir: string;
  currentPackageRoot: string;
  commandPaths?: Partial<Record<"coi" | "cci", string>>;
  home?: string;
  latest?: (packageName: string) => Promise<string | undefined>;
  globalNpmRoot?: string;
}): Promise<AdapterVersion[]> {
  const latestResolver = options.latest ?? fetchLatestNpmVersion;
  const piSources = await piPackageSources(options.agentDir);
  const globalRoot = options.globalNpmRoot ?? npmGlobalRoot();
  const results: AdapterVersion[] = [];
  const latestByPackage = new Map(await Promise.all(ADAPTERS.map(async (adapter) => [adapter.packageName, await latestResolver(adapter.packageName)] as const)));

  for (const adapter of ADAPTERS) {
    const sourceSpec = piSources.find((source) => sourceMatches(source, adapter));
    let root = sourceSpec ? rootFromPiSource(options.agentDir, sourceSpec, adapter) : undefined;
    if (adapter.id === "orchestrator") root = root ?? options.currentPackageRoot;
    if (adapter.binary) root = root ?? await packageRootFrom(options.commandPaths?.[adapter.binary], adapter.packageName);
    if (adapter.id === "opencode") root = root ?? await configuredOpenCodePluginRoot(options.home, adapter.packageName);
    root = root ?? (globalRoot ? await packageRootFrom(join(globalRoot, CANONICAL_NPM_SCOPE, adapter.repo), adapter.packageName) : undefined);
    if (root && !(await exists(root))) root = undefined;

    const current = await versionAt(root);
    const installedName = root ? (await readJson(join(root, "package.json")))?.name : undefined;
    const legacyInstalled = isLegacyPackageName(installedName)
      || (installedName === undefined && sourceSpec ? sourceIsLegacy(sourceSpec, adapter) : false);
    const latest = latestByPackage.get(adapter.packageName);
    let source: AdapterVersion["source"] = "missing";
    if (sourceSpec?.startsWith("git:")) source = "pi-git";
    else if (sourceSpec?.startsWith("npm:")) source = "pi-npm";
    else if (root && globalRoot && resolve(root).startsWith(`${resolve(globalRoot)}/`)) source = "npm-global";
    else if (root && gitRoot(root)) source = "git";
    else if (root) source = "local";

    let update: UpdateCommand | undefined;
    let blockedReason: string | undefined;
    if (legacyInstalled) {
      // Fail closed: a retired-namespace install is never "current" and is
      // never upgraded in place. Migration must remove it first.
      blockedReason =
        `MIGRATION_REQUIRED: ${legacyPackageName(adapter)} (0.11.0-connect.1) is installed. `
        + `canonical ships as ${adapter.packageName}. Remove the legacy install before installing canonical; `
        + "side-by-side installation is not supported.";
    } else if (sourceSpec) {
      if (/@v?\d+\.\d+\.\d+(?:$|[#?])/.test(sourceSpec)) {
        blockedReason = `Pi package source is pinned: ${sourceSpec}`;
      } else {
        update = commandSpec("pi", ["update", "--extension", sourceSpec]);
      }
    } else if (source === "npm-global") {
      update = commandSpec("npm", ["install", "-g", `${adapter.packageName}@${latest ?? "latest"}`]);
    } else if (source === "missing" && (adapter.id === "pi" || adapter.id === "orchestrator")) {
      update = commandSpec("pi", ["install", `npm:${adapter.packageName}@${latest ?? "latest"}`]);
    } else if (source === "missing") {
      update = commandSpec("npm", ["install", "-g", `${adapter.packageName}@${latest ?? "latest"}`]);
    } else if (source === "git" && root) {
      const repository = gitRoot(root)!;
      if (gitDirty(repository)) blockedReason = `Git checkout is dirty: ${repository}`;
      else update = commandSpec("git", ["-C", repository, "pull", "--ff-only"]);
    } else if (source === "local") {
      blockedReason = `Local package source is not safely updateable: ${root}`;
    }

    const legacySurfaces: LegacySurface[] | undefined = legacyInstalled
      ? [
          ...(sourceSpec && sourceIsLegacy(sourceSpec, adapter)
            ? [{ kind: "pi-settings" as const, detail: sourceSpec }]
            : []),
          ...(root ? [{ kind: "node-modules" as const, detail: root }] : []),
        ]
      : undefined;

    results.push({
      id: adapter.id,
      packageName: adapter.packageName,
      current,
      latest,
      source,
      root,
      sourceSpec,
      status: legacyInstalled ? "migration-required" : statusFor(current, latest),
      update,
      blockedReason,
      legacySurfaces,
    });
  }
  return results;
}

export function formatAdapterVersions(adapters: AdapterVersion[]): string {
  const lines = ["Agent Intercom adapters:"];
  for (const adapter of adapters) {
    lines.push(`- ${adapter.id}: installed=${adapter.current ?? "missing"} latest=${adapter.latest ?? "unknown"} source=${adapter.source} status=${adapter.status}`);
  }
  return lines.join("\n");
}

export function formatUpdatePlan(adapters: AdapterVersion[]): string {
  // Legacy installs are surfaced first and can never be reported as current.
  const migrating = adapters.filter((adapter) => adapter.status === "migration-required");
  const pending = adapters.filter((adapter) => adapter.status === "outdated" || adapter.status === "missing");
  if (migrating.length > 0) {
    const lines = [
      `MIGRATION_REQUIRED: ${migrating.length} adapter(s) still use the retired ${LEGACY_NPM_SCOPE}/* namespace.`,
      `Side-by-side installation is not supported. Remove legacy 0.11.0-connect.1 (${LEGACY_NPM_SCOPE}/*) before installing canonical ${CANONICAL_NPM_SCOPE}/*.`,
    ];
    for (const adapter of migrating) {
      lines.push(`- ${adapter.id}: ${adapter.blockedReason ?? "legacy install detected"}`);
      for (const surface of adapter.legacySurfaces ?? []) {
        lines.push(`  ${surface.kind}: ${surface.detail}`);
      }
    }
    return lines.join("\n");
  }
  if (!pending.length) return "All detected Agent Intercom adapters are current.";
  const lines = ["Agent Intercom update plan:"];
  for (const adapter of pending) {
    lines.push(`- ${adapter.id}: ${adapter.current ?? "missing"} -> ${adapter.latest ?? "latest"}`);
    if (adapter.update) lines.push(`  ${adapter.update.display}`);
    else lines.push(`  blocked: ${adapter.blockedReason ?? "no safe update command detected"}`);
  }
  return lines.join("\n");
}

export function detectHarnessVersions(commandPaths: Partial<Record<"pi" | "codex" | "claude" | "opencode", string | HarnessRuntime>>): HarnessVersion[] {
  return (["pi", "codex", "claude", "opencode"] as const).map((harness) => {
    const runtime = commandPaths[harness];
    if (!runtime) return { harness };
    const command = typeof runtime === "string" ? runtime : runtime.command;
    const args = typeof runtime === "string" ? undefined : runtime.args;
    const source = typeof runtime === "string" ? undefined : runtime.source;
    let version = typeof runtime === "string" ? undefined : runtime.version;
    if (!version) {
      const result = spawnSync(command, [...(args ?? []), "--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
      version = result.status === 0 ? result.stdout.trim().split(/\r?\n/, 1)[0] : undefined;
    }
    return { harness, command, ...(args ? { args } : {}), ...(source ? { source } : {}), ...(version ? { version } : {}) };
  });
}

export function formatHarnessVersions(harnesses: HarnessVersion[]): string {
  return ["Harness CLIs:", ...harnesses.map((entry) => {
    if (entry.source) {
      const command = entry.command ? [entry.command, ...(entry.args ?? [])].map(shellQuote).join(" ") : "not detected";
      return `- ${entry.harness}: version=${entry.version ?? "not detected"} command=${command} source=${entry.source}`;
    }
    return `- ${entry.harness}: ${entry.version ?? "not detected"}${entry.command ? ` (${entry.command})` : ""}`;
  })].join("\n");
}
