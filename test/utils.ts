import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import os from "node:os";

/**
 * Create a temporary directory whose path is already canonical.
 *
 * On macOS `os.tmpdir()` is `/var/folders/...`, and `/var` is a symlink to
 * `/private/var`. Production deliberately canonicalizes paths with `realpath`
 * (see `boss-resource.ts`, `boss-create-capabilities.ts`, `pi-runtime`), so a
 * raw `mkdtemp(join(tmpdir(), ...))` root makes tests compare an uncanonical
 * expectation against a canonical observation and fail on macOS only.
 *
 * Canonicalizing here fixes the TEST fixture, not the production behaviour:
 * `realpath` in src is correct and must not be weakened to make macOS pass.
 */
export async function makeCanonicalTempDir(prefix: string): Promise<string> {
  return realpathSync(await mkdtemp(join(tmpdir(), prefix)));
}

export function hasSystemdUserManager(): boolean {
  try {
    execSync("systemctl --user show-environment", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function hasFlock(): boolean {
  return existsSync("/usr/bin/flock");
}

export function hasProcfs(): boolean {
  return existsSync("/proc");
}

export function hasGitDaemon(): boolean {
    try {
        // Checking for actual git-daemon process or utility
        execSync("git daemon --help", { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

export function normalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
