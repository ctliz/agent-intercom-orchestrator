import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("coagent browser is compact by default and expands details on Enter", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "coagent-browser-test-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    const stateDir = join(agentDir, "intercom", "orchestrator");
    await mkdir(stateDir, { recursive: true });
    const now = Date.now();
    await writeFile(join(stateDir, "workers.json"), JSON.stringify({ version: 1, workers: [{
      id: "browser-worker",
      harness: "codex",
      role: "builder",
      state: "ready",
      task: "Implement and verify the compact coworker browser without changing worker lifecycle state.",
      cwd: "/home/example/worktrees/browser-project",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      permissionProfile: "builder-restricted",
      intercomTarget: "browser-worker",
      unit: "agent-intercom-worker-browser-worker.service",
      mainPid: 1234,
      managerSessionId: "manager-session-id",
      updatedAt: now,
      idleDeadlineAt: now + 60_000,
    }] }));

    const commands = new Map<string, any>();
    const pi: any = {
      registerCommand(name: string, command: any) { commands.set(name, command); },
    };
    const extensionUrl = new URL(`../src/coagent-browser.ts?test=${Date.now()}`, import.meta.url);
    const { default: extension } = await import(extensionUrl.href);
    extension(pi);

    let collapsed = "";
    let expanded = "";
    const backgroundColors: string[] = [];
    const theme = {
      fg(_color: string, text: string) { return text; },
      bg(color: string, text: string) { backgroundColors.push(color); return text; },
      bold(text: string) { return text; },
    };
    const ctx: any = {
      mode: "tui",
      ui: {
        notify() {},
        async custom(factory: any) {
          return await new Promise<void>((resolve) => {
            const component = factory({ requestRender() {} }, theme, {}, resolve);
            collapsed = component.render(100).join("\n");
            component.handleInput("\r");
            expanded = component.render(100).join("\n");
            component.handleInput("\x1b");
          });
        },
      },
    };

    await commands.get("coagents").handler("", ctx);
    assert.match(collapsed, /1 live/);
    assert.match(collapsed, /browser-worker/);
    assert.match(collapsed, /cwd\s+browser-project/);
    assert.doesNotMatch(collapsed, /\/home\/example\/worktrees\/browser-project/);
    assert.match(collapsed, /enter expand details/);
    assert.match(expanded, /\/home\/example\/worktrees\/browser-project/);
    assert.match(expanded, /intercom\s+browser-worker/);
    assert.match(expanded, /manager\s+manager-session-id/);
    assert.match(expanded, /enter collapse/);
    assert.ok(backgroundColors.includes("customMessageBg"));
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});
