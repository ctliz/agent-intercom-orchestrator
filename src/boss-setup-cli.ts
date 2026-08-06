import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyBossSetup, formatBossSetupReport, inspectBossSetup, type BossOnboardingInput } from "./boss-setup.ts";
import type { BossBaselineRole, Effort } from "./types.ts";

export interface BossSetupCliIO {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

const ROLES: BossBaselineRole[] = ["manager", "worker", "scout", "adversary"];
const VALUE_OPTIONS = new Set(["--handle-prefix", ...ROLES.flatMap((role) => [`--${role}-model`, `--${role}-effort`])]);

function parseArguments(argv: readonly string[]): { flags: Set<string>; values: Map<string, string>; error?: string } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equal = argument.indexOf("=");
    const name = equal < 0 ? argument : argument.slice(0, equal);
    if (VALUE_OPTIONS.has(name)) {
      const value = equal < 0 ? argv[++index] : argument.slice(equal + 1);
      if (!value || value.startsWith("--")) return { flags, values, error: `${name} requires a value.` };
      values.set(name, value);
    } else if (["--check", "--plan", "--json", "--help", "-h", "--apply", "--yes"].includes(name) && equal < 0) {
      flags.add(name);
    } else {
      return { flags, values, error: `Unknown option: ${argument}` };
    }
  }
  return { flags, values };
}

function onboardingFrom(values: Map<string, string>): BossOnboardingInput | undefined {
  if (!["--handle-prefix", ...ROLES.flatMap((role) => [`--${role}-model`, `--${role}-effort`])].every((key) => values.has(key))) return undefined;
  return {
    handlePrefix: values.get("--handle-prefix")!,
    roles: Object.fromEntries(ROLES.map((role) => [role, {
      model: values.get(`--${role}-model`)!,
      effort: values.get(`--${role}-effort`)! as Effort,
    }])) as BossOnboardingInput["roles"],
  };
}

function onboardingHelp(): string {
  return ["--handle-prefix PREFIX", ...ROLES.flatMap((role) => [`--${role}-model MODEL`, `--${role}-effort EFFORT`])].join(" ");
}

export async function runBossSetupCli(argv: readonly string[], io: BossSetupCliIO = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  const parsed = parseArguments(argv);
  if (parsed.error) {
    io.stderr.write(`${parsed.error}\n`);
    return 2;
  }
  const { flags, values } = parsed;
  if (flags.has("--help") || flags.has("-h")) {
    io.stdout.write(`Usage: agent-intercom-boss-setup [--check|--plan|--apply] [--json] [--yes] ${onboardingHelp()}\n\nPreview-first Orc Boss required-stack diagnostics. Apply requires all four explicit role model/effort choices and a handle prefix.\n`);
    return 0;
  }
  if (["--check", "--plan", "--apply"].filter((flag) => flags.has(flag)).length > 1) {
    io.stderr.write("Choose only one of --check, --plan, or --apply.\n");
    return 2;
  }
  const mode = flags.has("--check") ? "check" : flags.has("--apply") ? "apply" : "plan";
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || process.env.PI_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  const report = await inspectBossSetup({ agentDir });
  const onboarding = onboardingFrom(values);
  if (mode !== "check" && values.size > 0 && !onboarding) {
    io.stderr.write(`Incomplete onboarding options. Supply: ${onboardingHelp()}\n`);
    return 2;
  }
  const preview = `${formatBossSetupReport(report, mode === "check" ? "check" : "plan")}${onboarding ? `\n\nOnboarding config:\n${JSON.stringify(onboarding, null, 2)}` : "\n\nOnboarding config: not supplied (required for --apply)."}`;
  if (mode !== "apply") {
    io.stdout.write(flags.has("--json") ? `${JSON.stringify({ mode, report, onboarding: onboarding ?? null })}\n` : `${preview}\n`);
    return report.status === "ready" ? 0 : 1;
  }
  if (!onboarding) {
    io.stderr.write(`BOSS_SETUP_ONBOARDING_REQUIRED: supply ${onboardingHelp()}\n`);
    return 3;
  }
  if (report.blockers.length) {
    io.stderr.write(`${preview}\nBOSS_SETUP_BLOCKED: resolve the displayed dirty, pinned, duplicate, or invalid package entries first.\n`);
    return 3;
  }
  if (!flags.has("--yes")) {
    if (!process.stdin.isTTY) {
      io.stderr.write(`${preview}\nBOSS_SETUP_CONFIRMATION_REQUIRED: rerun with --yes after reviewing this exact plan.\n`);
      return 3;
    }
    io.stdout.write(`${preview}\n`);
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question("Apply this Orc Boss setup plan? Type 'yes' to continue: ");
    prompt.close();
    if (answer.trim().toLowerCase() !== "yes") {
      io.stderr.write("Setup cancelled; no changes were requested.\n");
      return 3;
    }
  }
  try {
    const result = await applyBossSetup({ agentDir, onboarding });
    const output = { mode, report: result.report, onboarding, applied: { installed: result.installed, configPath: result.configPath, onboardingChanged: result.onboardingChanged } };
    io.stdout.write(flags.has("--json") ? `${JSON.stringify(output)}\n` : `${formatBossSetupReport(result.report, "check")}\n\nApplied onboarding config: ${result.configPath}\nInstalled: ${result.installed.join(", ") || "none"}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runBossSetupCli(process.argv.slice(2));
}
