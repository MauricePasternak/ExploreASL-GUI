import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NativeGuiSession } from "./session";

const client = new Client({ name: "native-gui-smoke", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "server.ts"],
  env: {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    // Default launches must ignore stale desktop-session credentials.
    DISPLAY: ":65534",
    XAUTHORITY: "/nonexistent-native-gui-smoke/Xauthority",
  },
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
  await call("wait", { selector: '[data-testid="welcome-card"]' });
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
  await call("close");

  // Missing executables must stay invalid; seeding must not bypass native validation.
  const profile = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    type: "matlab",
    label: "Seeded smoke profile",
    matlabPath: "/nonexistent-native-gui-smoke/matlab",
    exploreAslPath: "/nonexistent-native-gui-smoke/ExploreASL",
  };
  const template = path.join(launched.workspace, "profile-template.json");
  const original = JSON.stringify({
    executionProfiles: [profile],
    recentProjects: [{ path: "/personal/project.easl" }],
    tokenSubDelimiters: [";"],
  });
  await writeFile(template, original);
  const seeded = JSON.parse(resultText(await call("launch", { profile_template: template })));
  assert.notEqual(seeded.workspace, launched.workspace);
  await call("wait", { selector: '[data-testid="welcome-card"]', state: "hidden" });
  await call("wait", { selector: '[data-testid="landing-invalid-profiles-alert"]' });
  await call("click", { selector: '[data-testid="layout-open-settings-btn"]' });
  await call("wait", { selector: `[data-testid="profile-invalid-${profile.id}"]` });
  await call("wait", { selector: '[data-testid="settings-delimiter-btn-;"]', state: "hidden" });
  const { identifier } = JSON.parse(
    await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const seededSettings = JSON.parse(
    await readFile(path.join(seeded.workspace, "data", identifier, "settings.json"), "utf8"),
  );
  assert.deepEqual(seededSettings.executionProfiles, [profile]);
  assert.deepEqual(seededSettings.recentProjects, []);
  assert.equal(await readFile(template, "utf8"), original);
  await call("close");
  const seededRelaunch = JSON.parse(resultText(await call("launch")));
  assert.equal(seededRelaunch.workspace, seeded.workspace);
  await call("wait", { selector: '[data-testid="landing-invalid-profiles-alert"]' });
  await call("close");
  const vanilla = JSON.parse(resultText(await call("launch", { fresh: true })));
  assert.notEqual(vanilla.workspace, seeded.workspace);
  await call("wait", { selector: '[data-testid="welcome-card"]' });
  await call("close");

  // Disabling Xvfb's server-side GLX must not disable the app's WebGL rendering.
  const rendering = new NativeGuiSession();
  try {
    await rendering.launch();
    const pixels = await rendering.browser.execute(() =>
      ["webgl", "webgl2"].map((kind) => {
        const gl = document.createElement("canvas").getContext(kind) as
          WebGLRenderingContext | WebGL2RenderingContext | null;
        if (!gl) return null;
        gl.clearColor(1, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const pixel = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return Array.from(pixel);
      }),
    );
    assert.deepEqual(pixels, [
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
  } finally {
    await rendering.close();
  }
  console.log(`Native GUI smoke passed. Artifacts: ${launched.workspace}`);
} finally {
  await Promise.allSettled([call("close"), call("close", {}, "ses_native_gui_smoke_b")]);
  await client.close();
}
