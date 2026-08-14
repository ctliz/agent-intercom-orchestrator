import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const CORE_COMMIT = "aad1985e125516b318181560293145bf2507cc6d";
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
  assert.match(manifest.dependencies?.["@dataforxyz/agent-intercom-core"] ?? "", CORE_SPEC_REGEX);
  assert.deepEqual(manifest.bundledDependencies, ["@dataforxyz/agent-intercom-core"]);
  assert.match(lockRoot?.dependencies?.["@dataforxyz/agent-intercom-core"] ?? "", CORE_SPEC_REGEX);
  assert.deepEqual(lockRoot?.bundleDependencies, ["@dataforxyz/agent-intercom-core"]);

  for (const name of PI_RUNTIME_PEERS) {
    assert.equal(manifest.peerDependencies?.[name], "*");
    assert.equal(manifest.dependencies?.[name], undefined);
    assert.equal(lockRoot?.peerDependencies?.[name], "*");
  }

  const core = lock.packages?.["node_modules/@dataforxyz/agent-intercom-core"];
  assert.match(core?.resolved ?? "", new RegExp(`github\\.com/ctliz/agent-intercom-core\\.git#${CORE_COMMIT}$`));
  assert.equal(core?.inBundle, true);
});
