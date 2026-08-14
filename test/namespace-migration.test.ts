import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CANONICAL_GITHUB_OWNER,
  CANONICAL_NPM_SCOPE,
  LEGACY_GITHUB_OWNER,
  LEGACY_NPM_SCOPE,
  diagnoseNamespaceMigration,
  formatUpdatePlan,
  inspectAdapterFamily,
} from "../src/updates.ts";
import type { AdapterVersion } from "../src/updates.ts";

// Every fixture is built inside an isolated temporary HOME/agent dir. Nothing
// here reads or mutates the operator's real connect.1 installation.
type Surface = "pi-settings" | "git-checkout" | "node-modules" | "global-bin";
type Flavour = "legacy" | "canonical";

interface Fixture {
  agentDir: string;
  globalRoot: string;
  binDir: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "agent-intercom-ns-"));
  const agentDir = join(base, "agent");
  const globalRoot = join(base, "global-node-modules");
  const binDir = join(base, "bin");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(globalRoot, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  return { agentDir, globalRoot, binDir, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function scopeOf(flavour: Flavour): string {
  return flavour === "legacy" ? LEGACY_NPM_SCOPE : CANONICAL_NPM_SCOPE;
}

function ownerOf(flavour: Flavour): string {
  return flavour === "legacy" ? LEGACY_GITHUB_OWNER : CANONICAL_GITHUB_OWNER;
}

function writeManifest(dir: string, name: string, version: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version }));
}

function install(fixture: Fixture, surface: Surface, flavour: Flavour): void {
  const scope = scopeOf(flavour);
  const owner = ownerOf(flavour);
  const version = flavour === "legacy" ? "0.11.0-connect.1" : "0.11.0-connect.2";
  const pkg = `${scope}/agent-intercom-pi`;

  if (surface === "pi-settings") {
    writeFileSync(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [`git:github.com/${owner}/agent-intercom-pi@v${version}`] }),
    );
    return;
  }
  if (surface === "git-checkout") {
    writeManifest(join(fixture.agentDir, "git", "github.com", owner, "agent-intercom-pi"), pkg, version);
    return;
  }
  if (surface === "node-modules") {
    writeManifest(join(fixture.agentDir, "npm", "node_modules", scope, "agent-intercom-pi"), pkg, version);
    return;
  }
  // global-bin: a real symlink whose realpath carries the namespace.
  const target = join(fixture.globalRoot, scope, "agent-intercom-codex", "dist", "coi.mjs");
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, "#!/usr/bin/env node\n");
  chmodSync(target, 0o755);
  symlinkSync(target, join(fixture.binDir, "coi"));
}

const SURFACES: Surface[] = ["pi-settings", "git-checkout", "node-modules", "global-bin"];

for (const surface of SURFACES) {
  test(`${surface}: legacy only is MIGRATION_REQUIRED and blocks`, async () => {
    const fixture = makeFixture();
    try {
      install(fixture, surface, "legacy");
      const result = await diagnoseNamespaceMigration({
        agentDir: fixture.agentDir,
        globalRoot: fixture.globalRoot,
        pathDirs: [fixture.binDir],
      });
      assert.equal(result.code, "MIGRATION_REQUIRED");
      assert.equal(result.blocked, true);
      assert.ok(result.legacySurfaces.length > 0, "legacy surface must be detected");
      assert.equal(result.canonicalSurfaces.length, 0);
      assert.ok(result.remediation.length > 0, "must give a remove-then-install plan");
      // Must never be described as healthy/current.
      assert.doesNotMatch(result.summary, /current|healthy|up to date/i);
    } finally {
      fixture.cleanup();
    }
  });

  test(`${surface}: canonical only is OK and does not block`, async () => {
    const fixture = makeFixture();
    try {
      install(fixture, surface, "canonical");
      const result = await diagnoseNamespaceMigration({
        agentDir: fixture.agentDir,
        globalRoot: fixture.globalRoot,
        pathDirs: [fixture.binDir],
      });
      assert.equal(result.code, "OK");
      assert.equal(result.blocked, false);
      assert.equal(result.legacySurfaces.length, 0);
      assert.ok(result.canonicalSurfaces.length > 0);
    } finally {
      fixture.cleanup();
    }
  });

  test(`${surface}: both namespaces present is a dual-load hard error`, async () => {
    const fixture = makeFixture();
    try {
      // pi-settings holds a single spec list, so seed both entries explicitly.
      if (surface === "pi-settings") {
        writeFileSync(
          join(fixture.agentDir, "settings.json"),
          JSON.stringify({
            packages: [
              `git:github.com/${LEGACY_GITHUB_OWNER}/agent-intercom-pi@v0.11.0-connect.1`,
              `git:github.com/${CANONICAL_GITHUB_OWNER}/agent-intercom-pi@v0.11.0-connect.2`,
            ],
          }),
        );
      } else if (surface === "global-bin") {
        for (const flavour of ["legacy", "canonical"] as const) {
          const target = join(fixture.globalRoot, scopeOf(flavour), "agent-intercom-codex", "dist", "coi.mjs");
          mkdirSync(join(target, ".."), { recursive: true });
          writeFileSync(target, "#!/usr/bin/env node\n");
        }
        symlinkSync(
          join(fixture.globalRoot, LEGACY_NPM_SCOPE, "agent-intercom-codex", "dist", "coi.mjs"),
          join(fixture.binDir, "coi"),
        );
        symlinkSync(
          join(fixture.globalRoot, CANONICAL_NPM_SCOPE, "agent-intercom-codex", "dist", "coi.mjs"),
          join(fixture.binDir, "cci"),
        );
      } else {
        install(fixture, surface, "legacy");
        install(fixture, surface, "canonical");
      }

      const result = await diagnoseNamespaceMigration({
        agentDir: fixture.agentDir,
        globalRoot: fixture.globalRoot,
        pathDirs: [fixture.binDir],
      });
      assert.equal(result.code, "DUPLICATE_INSTALL");
      assert.equal(result.blocked, true, "dual load must refuse setup/update/install");
      assert.ok(result.legacySurfaces.length > 0);
      assert.ok(result.canonicalSurfaces.length > 0);
      assert.match(result.summary, /separate extensions|conflicting binaries|broker registration/i);
    } finally {
      fixture.cleanup();
    }
  });

  test(`${surface}: neither namespace present is OK and not blocked`, async () => {
    const fixture = makeFixture();
    try {
      const result = await diagnoseNamespaceMigration({
        agentDir: fixture.agentDir,
        globalRoot: fixture.globalRoot,
        pathDirs: [fixture.binDir],
      });
      assert.equal(result.code, "OK");
      assert.equal(result.blocked, false);
      assert.equal(result.legacySurfaces.length, 0);
      assert.equal(result.canonicalSurfaces.length, 0);
    } finally {
      fixture.cleanup();
    }
  });
}

test("a legacy install is never reported as current and yields no in-place update", async () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [`git:github.com/${LEGACY_GITHUB_OWNER}/agent-intercom-pi`] }),
    );
    writeManifest(
      join(fixture.agentDir, "git", "github.com", LEGACY_GITHUB_OWNER, "agent-intercom-pi"),
      `${LEGACY_NPM_SCOPE}/agent-intercom-pi`,
      "0.11.0-connect.1",
    );

    const adapters = await inspectAdapterFamily({
      agentDir: fixture.agentDir,
      currentPackageRoot: join(fixture.agentDir, "nonexistent-orchestrator"),
      globalNpmRoot: fixture.globalRoot,
      latest: async () => "0.11.0-connect.2",
    });

    const pi = adapters.find((adapter) => adapter.id === "pi") as AdapterVersion;
    assert.equal(pi.status, "migration-required");
    assert.notEqual(pi.status, "current");
    assert.equal(pi.update, undefined, "legacy installs must not be upgraded in place");
    assert.match(pi.blockedReason ?? "", /MIGRATION_REQUIRED/);
    assert.match(pi.blockedReason ?? "", /side-by-side installation is not supported/i);
    assert.ok((pi.legacySurfaces ?? []).length > 0);

    const plan = formatUpdatePlan(adapters);
    assert.match(plan, /MIGRATION_REQUIRED/);
    assert.doesNotMatch(plan, /All detected Agent Intercom adapters are current\./);
  } finally {
    fixture.cleanup();
  }
});

test("the canonical namespace resolves normally without migration flags", async () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [`git:github.com/${CANONICAL_GITHUB_OWNER}/agent-intercom-pi`] }),
    );
    writeManifest(
      join(fixture.agentDir, "git", "github.com", CANONICAL_GITHUB_OWNER, "agent-intercom-pi"),
      `${CANONICAL_NPM_SCOPE}/agent-intercom-pi`,
      "0.11.0-connect.2",
    );

    const adapters = await inspectAdapterFamily({
      agentDir: fixture.agentDir,
      currentPackageRoot: join(fixture.agentDir, "nonexistent-orchestrator"),
      globalNpmRoot: fixture.globalRoot,
      latest: async () => "0.11.0-connect.2",
    });

    const pi = adapters.find((adapter) => adapter.id === "pi") as AdapterVersion;
    assert.equal(pi.status, "current");
    assert.equal(pi.legacySurfaces, undefined);
    assert.equal(pi.blockedReason, undefined);
  } finally {
    fixture.cleanup();
  }
});

test("exact local connect.1 fixture (ctliz repo path with @dataforxyz manifest name) diagnoses as MIGRATION_REQUIRED", async () => {
  const fixture = makeFixture();
  try {
    // Settings has git:github.com/ctliz/agent-intercom-pi@v0.10.1-tmuxdeck.1
    writeFileSync(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [`git:github.com/${CANONICAL_GITHUB_OWNER}/agent-intercom-pi@v0.10.1-tmuxdeck.1`] }),
    );
    // Checkout directory is under ctliz/agent-intercom-pi, but its manifest name is @dataforxyz/agent-intercom-pi
    writeManifest(
      join(fixture.agentDir, "git", "github.com", CANONICAL_GITHUB_OWNER, "agent-intercom-pi"),
      `${LEGACY_NPM_SCOPE}/agent-intercom-pi`,
      "0.10.1-tmuxdeck.1",
    );

    const result = await diagnoseNamespaceMigration({
      agentDir: fixture.agentDir,
      globalRoot: fixture.globalRoot,
      pathDirs: [fixture.binDir],
    });

    assert.equal(result.code, "MIGRATION_REQUIRED", "Must prioritize manifest name over git repository owner");
    assert.equal(result.blocked, true);
    assert.ok(result.legacySurfaces.length > 0);
    assert.equal(result.canonicalSurfaces.length, 0);
    assert.ok(result.legacySurfaces.some((s) => s.kind === "git-checkout" || s.kind === "pi-settings"));
  } finally {
    fixture.cleanup();
  }
});

test("same ctliz repo path with @ctliz manifest name diagnoses as OK", async () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [`git:github.com/${CANONICAL_GITHUB_OWNER}/agent-intercom-pi@v0.11.0-connect.2`] }),
    );
    writeManifest(
      join(fixture.agentDir, "git", "github.com", CANONICAL_GITHUB_OWNER, "agent-intercom-pi"),
      `${CANONICAL_NPM_SCOPE}/agent-intercom-pi`,
      "0.11.0-connect.2",
    );

    const result = await diagnoseNamespaceMigration({
      agentDir: fixture.agentDir,
      globalRoot: fixture.globalRoot,
      pathDirs: [fixture.binDir],
    });

    assert.equal(result.code, "OK");
    assert.equal(result.blocked, false);
    assert.equal(result.legacySurfaces.length, 0);
    assert.ok(result.canonicalSurfaces.length > 0);
  } finally {
    fixture.cleanup();
  }
});

test("missing manifest with non-connect.2 ctliz git spec fails closed to MIGRATION_REQUIRED", async () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [`git:github.com/${CANONICAL_GITHUB_OWNER}/agent-intercom-pi@v0.10.1-tmuxdeck.1`] }),
    );

    const result = await diagnoseNamespaceMigration({
      agentDir: fixture.agentDir,
      globalRoot: fixture.globalRoot,
      pathDirs: [fixture.binDir],
    });

    assert.equal(result.code, "MIGRATION_REQUIRED");
    assert.equal(result.blocked, true);
    assert.ok(result.legacySurfaces.some((s) => s.kind === "pi-settings"));
    assert.equal(result.canonicalSurfaces.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("missing manifest with exact connect.2 ctliz git spec is recognized as OK", async () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [`git:github.com/${CANONICAL_GITHUB_OWNER}/agent-intercom-pi@v0.11.0-connect.2`] }),
    );

    const result = await diagnoseNamespaceMigration({
      agentDir: fixture.agentDir,
      globalRoot: fixture.globalRoot,
      pathDirs: [fixture.binDir],
    });

    assert.equal(result.code, "OK");
    assert.equal(result.blocked, false);
    assert.equal(result.legacySurfaces.length, 0);
    assert.ok(result.canonicalSurfaces.some((s) => s.kind === "pi-settings"));
  } finally {
    fixture.cleanup();
  }
});

