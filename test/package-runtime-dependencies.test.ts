import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const CORE_VERSION = "0.2.0";
const EXPECTED_CORE_INTEGRITY = "sha512-bpifL9cc8cwMm74fpvjgRBarXMwn6BY4cST4ry6HrGtfpRTXyiJOtwfNnhORF6xTKwQNOWakxS1sZALczInvkQ==";
const EXPECTED_TEAM_MANIFEST_HASH = "28b5e6c7b2fa583b82adc23a3dcc7389e83818c544c5ddb4a3f7701f8fd8ee27";
const PI_RUNTIME_PEERS = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
] as const;

test("package follows Pi's peer contract and bundles exact Core runtime", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as Record<string, any>;
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8")) as Record<string, any>;
  const lockRoot = lock.packages?.[""];

  assert.equal(manifest.version, "0.12.0-connect.1");
  assert.equal(lockRoot?.version, "0.12.0-connect.1");
  assert.equal(manifest.bin?.["agent-intercom-boss-setup"], "src/boss-setup-cli.mjs");
  assert.equal(lockRoot?.bin?.["agent-intercom-boss-setup"], "src/boss-setup-cli.mjs");
  assert.equal(manifest.dependencies?.["@ctliz/agent-intercom-core"], CORE_VERSION);
  assert.deepEqual(manifest.bundledDependencies, ["@ctliz/agent-intercom-core"]);
  assert.equal(lockRoot?.dependencies?.["@ctliz/agent-intercom-core"], CORE_VERSION);
  assert.deepEqual(lockRoot?.bundleDependencies, ["@ctliz/agent-intercom-core"]);

  for (const name of PI_RUNTIME_PEERS) {
    assert.equal(manifest.peerDependencies?.[name], "*");
    assert.equal(manifest.dependencies?.[name], undefined);
    assert.equal(lockRoot?.peerDependencies?.[name], "*");
  }

  const core = lock.packages?.["node_modules/@ctliz/agent-intercom-core"];
  assert.equal(core?.version, CORE_VERSION);
  assert.equal(core?.inBundle, true);
  assert.equal(core?.integrity, EXPECTED_CORE_INTEGRITY);
  assert.equal(core?.dependencies, undefined);
  assert.equal(lock.packages?.["node_modules/@ctliz/agent-intercom-core/node_modules/@types/node"], undefined);
  assert.equal(lock.packages?.["node_modules/@ctliz/agent-intercom-core/node_modules/undici-types"], undefined);
  assert.match(core?.resolved ?? "", /^https:\/\/registry\.npmjs\.org\/@ctliz\/agent-intercom-core\/-\/agent-intercom-core-0\.2\.0\.tgz$/);

  const teamManifestContent = readFileSync(new URL("node_modules/@ctliz/agent-intercom-core/dist/team-manifest.js", root));
  const teamManifestHash = createHash("sha256").update(teamManifestContent).digest("hex");
  assert.equal(teamManifestHash, EXPECTED_TEAM_MANIFEST_HASH);
});

test("packed active install docs/skills/examples do not contain legacy install commands", () => {
  const fg = ["skills/agent-intercom-orchestrator/SKILL.md", "examples/opencode-manager-env.sh", "docs/boss-installation.md", "docs/example-manager-prompt.md", "docs/creating-and-supervising-worker-agents.md", "docs/boss-public-release-plan.md"];
  const legacyPattern = /(@dataforxyz\/agent-intercom-|dataforxyz\/agent-intercom-)/;

  const offenders: string[] = [];
  for (const rel of fg) {
    const content = readFileSync(new URL(rel, root), "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (legacyPattern.test(line)) {
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `Legacy install commands found in packaged docs/skills/examples:\n${offenders.join("\n")}`);
});

test("package documentation accurately reflects three-line namespace history and excludes stale npm sentence", () => {
  const readme = readFileSync(new URL("README.md", root), "utf8");
  const changelog = readFileSync(new URL("CHANGELOG.md", root), "utf8");
  const updates = readFileSync(new URL("src/updates.ts", root), "utf8");

  // Reject the stale README sentence falsely claiming packages are not published on npm
  assert.doesNotMatch(readme, /These packages are not published on the npm registry yet/i);
  assert.doesNotMatch(readme, /not published on the npm registry yet/i);

  // Pin three-line namespace history in README, updates.ts, and CHANGELOG
  // Line 1: historical 0.11.0-connect.1 legacy (@dataforxyz)
  assert.match(readme, /legacy\s+`?@dataforxyz\/\*`?\s+\(historical\s+`?0\.11\.0-connect\.1`?\)/i);
  assert.match(updates, /Historical 0\.11\.0-connect\.1 shipped under `@dataforxyz\/\*`/);
  assert.match(changelog, /## 0\.11\.0-connect\.1/);
  assert.doesNotMatch(changelog, /## 0\.11\.0-connect\.1[^\n]*\n[^\n]*canonical ctliz distribution/);

  // Line 2: 0.11.0-connect.2 first canonical migration (@ctliz)
  assert.match(readme, /canonical\s+`?@ctliz\/\*`?\s+\(introduced in\s+`?0\.11\.0-connect\.2`?/i);
  assert.match(updates, /canonical `@ctliz\/\*`[\s*]+began with 0\.11\.0-connect\.2/);
  assert.match(changelog, /## 0\.11\.0-connect\.2/);

  // Line 3: 0.12.0-connect.1 canonical / coordinated current
  assert.match(readme, /continued in\s+`?0\.12\.0-connect\.1`?\)/i);
  assert.match(updates, /continues with coordinated 0\.12\.0-connect\.1/);
  assert.match(changelog, /## 0\.12\.0-connect\.1/);
});
