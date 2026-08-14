import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const CORE_COMMIT = "37e074970e2a9de32a16fc325607c3b476b0bd45";
const CORE_SPEC_REGEX = new RegExp(`^git\\+https://github\\.com/ctliz/agent-intercom-core\\.git#${CORE_COMMIT}$`);
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

  assert.equal(manifest.bin?.["agent-intercom-boss-setup"], "src/boss-setup-cli.mjs");
  assert.equal(lockRoot?.bin?.["agent-intercom-boss-setup"], "src/boss-setup-cli.mjs");
  assert.match(manifest.dependencies?.["@ctliz/agent-intercom-core"] ?? "", CORE_SPEC_REGEX);
  assert.deepEqual(manifest.bundledDependencies, ["@ctliz/agent-intercom-core"]);
  assert.match(lockRoot?.dependencies?.["@ctliz/agent-intercom-core"] ?? "", CORE_SPEC_REGEX);
  assert.deepEqual(lockRoot?.bundleDependencies, ["@ctliz/agent-intercom-core"]);

  for (const name of PI_RUNTIME_PEERS) {
    assert.equal(manifest.peerDependencies?.[name], "*");
    assert.equal(manifest.dependencies?.[name], undefined);
    assert.equal(lockRoot?.peerDependencies?.[name], "*");
  }

  const core = lock.packages?.["node_modules/@ctliz/agent-intercom-core"];
  assert.match(core?.resolved ?? "", new RegExp(`github\\.com/ctliz/agent-intercom-core\\.git#${CORE_COMMIT}$`));
  assert.equal(core?.inBundle, true);
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
