import assert from "node:assert/strict";
import test from "node:test";

test("Pi coworker kill switch prevents fleet tools and lifecycle hooks without a worker permission profile", async () => {
  const previousDisabled = process.env.AGENT_INTERCOM_ORCHESTRATOR_DISABLED;
  const previousPermissionProfile = process.env.AGENT_INTERCOM_PERMISSION_PROFILE;
  process.env.AGENT_INTERCOM_ORCHESTRATOR_DISABLED = "1";
  delete process.env.AGENT_INTERCOM_PERMISSION_PROFILE;
  try {
    const registered: string[] = [];
    const pi: any = {
      on(name: string) { registered.push(`event:${name}`); },
      registerTool(tool: any) { registered.push(`tool:${tool.name}`); },
      registerCommand(name: string) { registered.push(`command:${name}`); },
    };
    const extensionUrl = new URL(`../src/index.ts?disabled=${Date.now()}`, import.meta.url);
    const { default: extension } = await import(extensionUrl.href);
    extension(pi);
    assert.deepEqual(registered, []);
  } finally {
    if (previousDisabled === undefined) delete process.env.AGENT_INTERCOM_ORCHESTRATOR_DISABLED;
    else process.env.AGENT_INTERCOM_ORCHESTRATOR_DISABLED = previousDisabled;
    if (previousPermissionProfile === undefined) delete process.env.AGENT_INTERCOM_PERMISSION_PROFILE;
    else process.env.AGENT_INTERCOM_PERMISSION_PROFILE = previousPermissionProfile;
  }
});
