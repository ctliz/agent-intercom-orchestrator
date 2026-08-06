#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
let cli = fileURLToPath(new URL("./boss-setup-cli.ts", import.meta.url));
let bridgeDir;
const nodeArgs = ["--experimental-strip-types"];

// Node deliberately refuses to strip TypeScript below node_modules. Pi loads the
// extension itself, but the package bin needs a path outside node_modules. Keep
// the package linked (not copied), and preserve that link for relative imports.
if (packageRoot.split(sep).includes("node_modules")) {
  bridgeDir = await mkdtemp(join(tmpdir(), "agent-intercom-boss-setup-"));
  const linkedPackage = join(bridgeDir, basename(packageRoot));
  await symlink(packageRoot, linkedPackage, "dir");
  cli = join(linkedPackage, "src", "boss-setup-cli.ts");
  nodeArgs.unshift("--preserve-symlinks", "--preserve-symlinks-main");
}

const cleanup = async () => {
  if (bridgeDir) await rm(bridgeDir, { recursive: true, force: true });
};
const child = spawn(process.execPath, [...nodeArgs, cli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
child.on("close", async (code, signal) => {
  await cleanup();
  if (signal) process.stderr.write(`Orc Boss setup terminated by ${signal}\n`);
  process.exitCode = code ?? 1;
});
child.on("error", async (error) => {
  await cleanup();
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
