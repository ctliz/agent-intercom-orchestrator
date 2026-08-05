import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);

test("production installs include every package imported by extension and cleanup entrypoints", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as Record<string, any>;
  const lock = readFileSync(new URL("package-lock.json", root), "utf8");

  assert.equal(manifest.dependencies?.["@earendil-works/pi-ai"], "*");
  assert.equal(manifest.dependencies?.["@earendil-works/pi-coding-agent"], "*");
  assert.equal(manifest.dependencies?.["@earendil-works/pi-tui"], "*");
  assert.equal(manifest.dependencies?.typebox, "^1.1.24");

  for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"]) {
    assert.equal(manifest.peerDependencies?.[name], undefined);
    assert.equal(manifest.devDependencies?.[name], undefined);
  }

  assert.equal(lock.includes("git+ssh://git@github.com/dataforxyz/agent-intercom-core"), false);
});
