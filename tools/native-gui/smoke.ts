import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const client = new Client({ name: "native-gui-smoke", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "server.ts"],
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ),
  stderr: "inherit",
});
await client.connect(transport);

async function call(
  name: string,
  args: Record<string, unknown> = {},
  session = "ses_native_gui_smoke_a",
) {
  const result = (await client.callTool({
    name,
    arguments: args,
    _meta: { "ai.opencode/sessionID": session },
  })) as CallToolResult;
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result;
}

function resultText(result: CallToolResult) {
  const content = result.content.find((item) => item.type === "text");
  assert.ok(content?.type === "text");
  return content.text;
}

try {
  const launched = JSON.parse(resultText(await call("launch")));
  await call("click", { selector: '[data-testid="layout-open-settings-btn"]' });
  await call("wait", { selector: '[data-testid="settings-modal"]' });
  await call("fill", { selector: '[data-testid="settings-add-delimiter-input"]', value: ";" });
  const inspected = JSON.parse(
    resultText(await call("inspect", { selector: '[data-testid="settings-modal"]' })),
  );
  assert.ok(inspected.elements.some((element: { value?: string }) => element.value === ";"));
  await call("click", { selector: '[data-testid="settings-add-delimiter-btn"]' });
  await call("wait", {
    selector: '[data-testid="settings-delimiter-btn-;"]',
    state: "text",
    text: ";",
  });
  const screenshot = await call("screenshot");
  assert.ok(screenshot.content.some((item) => item.type === "image" && item.data.length > 100));

  // Same MCP connection, different OpenCode session: private bus avoids single-instance collision.
  const second = JSON.parse(resultText(await call("launch", {}, "ses_native_gui_smoke_b")));
  assert.notEqual(second.workspace, launched.workspace);
  const secondDom = JSON.parse(resultText(await call("inspect", {}, "ses_native_gui_smoke_b")));
  assert.ok(
    !secondDom.elements.some((element: { selector: string }) =>
      element.selector.includes("settings-modal"),
    ),
  );
  await call("close", {}, "ses_native_gui_smoke_b");
  await call("click", { selector: '[data-testid="settings-save-close-btn"]' });
  await call("wait", { selector: '[data-testid="settings-modal"]', state: "hidden" });
  await call("navigate", { route: "/overview" });
  await call("wait", { selector: '[data-testid="overview-page"]' });
  await call("keys", { keys: ["Tab"] });
  await call("close");
  const relaunched = JSON.parse(resultText(await call("launch")));
  assert.equal(relaunched.workspace, launched.workspace);
  await call("click", { selector: '[data-testid="layout-open-settings-btn"]' });
  await call("wait", { selector: '[data-testid="settings-delimiter-btn-;"]' });
  await call("click", { selector: '[data-testid="settings-save-close-btn"]' });
  console.log(`Native GUI smoke passed. Artifacts: ${launched.workspace}`);
} finally {
  await Promise.allSettled([call("close"), call("close", {}, "ses_native_gui_smoke_b")]);
  await client.close();
}
