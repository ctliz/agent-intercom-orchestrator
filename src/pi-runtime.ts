import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { LaunchProfile } from "./types.ts";

// Keep this allowlist in sync with supported upstream Pi package renames.
const PI_PACKAGE_NAMES = new Set([
  "@earendil-works/pi-coding-agent",
  "@mariozechner/pi-coding-agent",
]);

export interface PiRuntime {
  command: string;
  args: string[];
  source: "manager-runtime" | "profile";
  version?: string;
}

type PackageManifest = {
  name?: unknown;
  version?: unknown;
  bin?: unknown;
};

function piBin(manifest: PackageManifest): string | undefined {
  if (typeof manifest.bin === "string") return manifest.bin;
  if (!manifest.bin || typeof manifest.bin !== "object" || Array.isArray(manifest.bin)) return undefined;
  const bin = (manifest.bin as Record<string, unknown>).pi;
  return typeof bin === "string" ? bin : undefined;
}

async function managerPiRuntime(entry: string | undefined, runtime: string): Promise<PiRuntime | undefined> {
  if (!entry || !isAbsolute(entry) || !isAbsolute(runtime)) return undefined;
  try {
    const [entryPath, runtimePath] = await Promise.all([realpath(entry), realpath(runtime)]);
    await access(runtimePath, fsConstants.X_OK);
    let directory = dirname(entryPath);
    const root = parse(directory).root;
    while (directory !== root) {
      try {
        const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as PackageManifest;
        if (PI_PACKAGE_NAMES.has(String(manifest.name))) {
          const declaredBin = piBin(manifest);
          if (!declaredBin || await realpath(resolve(directory, declaredBin)) !== entryPath) return undefined;
          return {
            command: runtimePath,
            args: [entryPath],
            source: "manager-runtime",
            ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
          };
        }
      } catch {
        // This directory is not a readable package root; keep walking upward.
      }
      directory = dirname(directory);
    }
  } catch {
    // Fall back to the configured profile when the manager runtime is not reusable.
  }
  return undefined;
}

export async function resolvePiRuntime(input: {
  profileName: string;
  profile: LaunchProfile;
  configuredExecutable?: string;
  builtInProfile: LaunchProfile;
  managerEntry?: string;
  managerExecutable?: string;
}): Promise<PiRuntime | undefined> {
  const fallback = input.configuredExecutable
    ? { command: input.configuredExecutable, args: [], source: "profile" as const }
    : undefined;
  const usesUnmodifiedBuiltInCommand = input.profileName === "pi-peer"
    && input.profile.command === input.builtInProfile.command;
  if (!usesUnmodifiedBuiltInCommand) return fallback;
  return await managerPiRuntime(
    input.managerEntry ?? process.argv[1],
    input.managerExecutable ?? process.execPath,
  ) ?? fallback;
}
