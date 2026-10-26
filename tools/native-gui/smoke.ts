import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NativeGuiSession } from "./session";
import { pngDimensions } from "./diagnostics";

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
  const launched = JSON.parse(
    resultText(
      await call("launch", {
        screen_size: { width: 3840, height: 3840 },
        window_size: { width: 800, height: 1200 },
      }),
    ),
  );
  assert.equal(launched.metrics.screen.width, 3840);
  assert.equal(launched.metrics.screen.height, 3840);
  assert.equal(launched.metrics.native_window.width, 800);
  assert.equal(launched.metrics.native_window.height, 1200);
  console.log("Portrait observed:", JSON.stringify(launched.metrics));
  const portraitShot = JSON.parse(resultText(await call("screenshot")));
  assert.equal(portraitShot.image.width, 800);
  assert.equal(portraitShot.image.height, launched.metrics.viewport.height);
  console.log("Portrait screenshot:", JSON.stringify(portraitShot));
  const large = JSON.parse(resultText(await call("resize", { width: 3840, height: 2160 })));
  assert.equal(large.native_window.width, 3840);
  assert.equal(large.native_window.height, 2160);
  console.log("4K observed:", JSON.stringify(large));
  const largeShot = await call("screenshot");
  const largeMetadata = JSON.parse(resultText(largeShot));
  const largeImage = largeShot.content.find((item) => item.type === "image");
  assert.ok(largeImage?.type === "image");
  assert.deepEqual(largeMetadata.image, pngDimensions(largeImage.data));
  assert.equal(
    largeMetadata.image.width,
    Math.round(largeMetadata.metrics.viewport.width * largeMetadata.metrics.device_pixel_ratio),
  );
  assert.equal(
    largeMetadata.image.height,
    Math.round(largeMetadata.metrics.viewport.height * largeMetadata.metrics.device_pixel_ratio),
  );
  console.log("4K screenshot:", JSON.stringify(largeMetadata));
  await call("resize", { width: 800, height: 1200 });
  await call("wait", { selector: '[data-testid="welcome-card"]' });
  await call("click", { selector: '[data-testid="layout-open-settings-btn"]' });
  await call("wait", { selector: '[data-testid="settings-modal"]' });
  await call("fill", { selector: '[data-testid="settings-add-delimiter-input"]', value: ";" });
  const inspected = JSON.parse(
    resultText(
      await call("inspect", {
        selector: '[data-testid="settings-modal"]',
        styles: ["display", "color"],
        include_hidden: true,
      }),
    ),
  );
  assert.ok(inspected.elements.some((element: { value?: string }) => element.value === ";"));
  assert.ok(
    inspected.elements.every(
      (element: { bounds?: unknown; styles?: unknown; center_hit?: unknown }) =>
        element.bounds && element.styles && element.center_hit,
    ),
  );
  const failed = (await client.callTool({
    name: "click",
    arguments: { selector: '[data-testid="missing-smoke-element"]' },
    _meta: { "ai.opencode/sessionID": "ses_native_gui_smoke_a" },
  })) as CallToolResult;
  assert.equal(failed.isError, true);
  const failure = JSON.parse(resultText(failed));
  assert.match(failure.error, /matched 0 elements/);
  assert.equal(failure.evidence.errors.length, 0);
  assert.equal(failure.evidence.artifacts.length, 3);
  for (const artifact of failure.evidence.artifacts) {
    assert.ok(artifact.startsWith(`${launched.workspace}/failures/`));
    assert.ok((await stat(artifact)).size > 0);
  }
  console.log("Failure evidence:", JSON.stringify(failure.evidence.artifacts));
  const oversized = await client.callTool({
    name: "resize",
    arguments: { width: 4096, height: 2160 },
    _meta: { "ai.opencode/sessionID": "ses_native_gui_smoke_a" },
  });
  assert.equal(oversized.isError, true);
  assert.match(JSON.stringify(oversized.content), /Explicitly close\/relaunch/);
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
  const closedDiagnostics = JSON.parse(resultText(await call("diagnostics")));
  assert.equal(closedDiagnostics.driver.process_running, false);
  assert.equal(closedDiagnostics.live.reachable, false);
  assert.ok(closedDiagnostics.logs.some((log: { text?: string }) => log.text !== undefined));
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
  await writeFile(template, "invalid JSON");
  const invalidTemplate = await client.callTool({
    name: "launch",
    arguments: { profile_template: template },
    _meta: { "ai.opencode/sessionID": "ses_native_gui_smoke_a" },
  });
  assert.equal(invalidTemplate.isError, true);
  assert.equal(
    JSON.parse(resultText(await call("diagnostics"))).workspace,
    launched.workspace,
    "Invalid profile template must preserve the reusable workspace.",
  );
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

  // A post-connection startup failure must capture the live webview before teardown.
  const startup = new NativeGuiSession();
  const startupError = new Error("Simulated post-connection startup failure");
  startup.metrics = async () => {
    throw startupError;
  };
  try {
    await assert.rejects(startup.launch(), (error: unknown) => {
      assert.equal(error, startupError);
      assert.ok(error instanceof Error && "evidence" in error);
      const evidence = error.evidence as Awaited<ReturnType<NativeGuiSession["failureEvidence"]>>;
      assert.equal(evidence.diagnostics.driver.process_running, true);
      assert.equal(evidence.artifacts.length, 3);
      assert.deepEqual(evidence.errors, []);
      console.log("Startup failure evidence:", JSON.stringify(evidence.artifacts));
      return true;
    });
    assert.equal((await startup.diagnostics()).driver.process_running, false);
    assert.throws(() => startup.browser, /Launch the native GUI first/);
  } finally {
    await startup.stopDriver();
  }

  // Disabling Xvfb's server-side GLX must not disable the app's WebGL rendering.
  const rendering = new NativeGuiSession();
  try {
    await rendering.launch({
      screen_size: { width: 3840, height: 2160 },
      window_size: { width: 3840, height: 2160 },
    });
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
    const marker = `native-gui-smoke-console-error-${Date.now()}`;
    await rendering.browser.execute((message) => console.error(message), marker);
    let diagnostics = await rendering.diagnostics();
    for (
      let attempt = 0;
      attempt < 20 &&
      !diagnostics.logs.some(
        (log) =>
          log.path !== path.join(rendering.workspace!, "driver.log") && log.text?.includes(marker),
      );
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      diagnostics = await rendering.diagnostics();
    }
    const nativeLogs = diagnostics.logs.filter(
      (log) =>
        log.path !== path.join(rendering.workspace!, "driver.log") && log.text?.includes(marker),
    );
    assert.ok(
      nativeLogs.length > 0,
      "Console bridge error missing from native logs (driver.log alone is insufficient).",
    );
    console.log("Native console logs:", nativeLogs.map((log) => log.path).join(", "));
    console.log("WebGL 1/2 pixels:", JSON.stringify(pixels));
  } finally {
    try {
      await rendering.close();
    } finally {
      await rendering.stopDriver();
    }
  }
  console.log(`Native GUI smoke passed. Artifacts: ${launched.workspace}`);
} finally {
  await Promise.allSettled([call("close"), call("close", {}, "ses_native_gui_smoke_b")]);
  await client.close();
}
