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
  const opened = JSON.parse(
    resultText(await call("click", { selector: '[data-testid="layout-open-settings-btn"]' })),
  );
  assert.equal(typeof opened.observed.route, "string");
  await call("wait", { selector: '[data-testid="settings-modal"]' });
  const filled = JSON.parse(
    resultText(
      await call("fill", { selector: '[data-testid="settings-add-delimiter-input"]', value: ";" }),
    ),
  );
  assert.equal(filled.observed.value, ";");
  assert.equal(filled.observed.focus, '[data-testid="settings-add-delimiter-input"]');
  const compact = JSON.parse(
    resultText(await call("inspect", { selector: '[data-testid="settings-modal"]' })),
  );
  assert.ok(compact.elements.length > 0);
  assert.ok(
    compact.elements.every(
      (element: { bounds?: unknown; center_hit?: unknown }) =>
        !element.bounds && !element.center_hit,
    ),
  );
  console.log(
    "Compact vs geometry inspection bytes:",
    resultText(await call("inspect", {})).length,
    resultText(await call("inspect", { geometry: true })).length,
  );
  const ambiguous = (await client.callTool({
    name: "click",
    arguments: { selector: "button" },
    _meta: { "ai.opencode/sessionID": "ses_native_gui_smoke_a" },
  })) as CallToolResult;
  assert.equal(ambiguous.isError, true);
  const ambiguity = JSON.parse(resultText(ambiguous));
  assert.match(ambiguity.error, /Selector is ambiguous: matched \d+ elements.*First matches: \S/);
  assert.equal(ambiguity.input, "not_sent");
  const inspected = JSON.parse(
    resultText(
      await call("inspect", {
        selector: '[data-testid="settings-modal"]',
        styles: ["display", "color"],
        include_hidden: true,
        geometry: true,
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
  assert.match(failure.error, /Timed out waiting.*element does not exist/);
  assert.equal(failure.evidence.errors.length, 0);
  assert.equal(failure.evidence.artifacts.length, 3);
  assert.equal(failure.evidence.target.selector, '[data-testid="missing-smoke-element"]');
  assert.match(failure.evidence.target.unavailable, /Target absent:/);
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

    // Browser-side fixture only: exercise trusted native pointer/wheel events on a canvas
    // and an actual nested scrolling region, without changing application state.
    await rendering.browser.execute(() => {
      const canvas = document.createElement("canvas");
      canvas.dataset.testid = "pointer-smoke";
      canvas.style.cssText =
        "position:fixed;left:20px;top:20px;width:200px;height:150px;z-index:2147483647;background:white";
      for (const kind of [
        "pointerenter",
        "pointermove",
        "pointerdown",
        "pointerup",
        "click",
        "wheel",
      ]) {
        canvas.addEventListener(kind, (event) => {
          const pointer = event as PointerEvent;
          canvas.dataset[kind] = JSON.stringify({
            trusted: event.isTrusted,
            x: pointer.offsetX,
            y: pointer.offsetY,
            button: pointer.button,
            delta: (event as WheelEvent).deltaY,
          });
        });
      }
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
      document.body.append(canvas);
      const region = document.createElement("div");
      region.dataset.testid = "scroll-smoke";
      region.style.cssText =
        "position:fixed;left:250px;top:20px;width:150px;height:100px;overflow:auto;z-index:2147483647;background:white";
      const content = document.createElement("div");
      content.style.height = "2000px";
      region.append(content);
      document.body.append(region);
      setTimeout(() => {
        const button = document.createElement("button");
        button.dataset.testid = "delayed-smoke";
        button.style.cssText = "position:fixed;left:420px;top:20px;z-index:2147483647";
        button.textContent = "Delayed action";
        button.onclick = () => {
          button.dataset.clicks = String(Number(button.dataset.clicks ?? 0) + 1);
        };
        document.body.append(button);
      }, 300);
    });
    await rendering.click('[data-testid="delayed-smoke"]');
    assert.equal(
      await rendering.browser.$('[data-testid="delayed-smoke"]').getAttribute("data-clicks"),
      "1",
    );
    const canvas = '[data-testid="pointer-smoke"]';
    await rendering.hover(canvas, { x: 10, y: 10 });
    await rendering.click(canvas, { x: 30, y: 40 });
    const clicked = await rendering.browser.$(canvas).getAttribute("data-click");
    assert.deepEqual(JSON.parse(clicked!), { trusted: true, x: 30, y: 40, button: 0 });
    await rendering.drag(canvas, { x: 20, y: 30 }, { x: 80, y: 90 }, 200);
    await rendering.scroll(canvas, 0, 120, { x: 10, y: 10 });
    const events = await rendering.browser.execute(() => ({
      ...document.querySelector<HTMLElement>('[data-testid="pointer-smoke"]')!.dataset,
    }));
    assert.equal(JSON.parse(events.pointerenter!).trusted, true);
    assert.deepEqual(JSON.parse(events.pointerup!), { trusted: true, x: 80, y: 90, button: 0 });
    assert.equal(JSON.parse(events.wheel!).delta, 120);
    await rendering.scroll('[data-testid="scroll-smoke"]', 0, 250);
    await rendering.browser.waitUntil(
      async () =>
        Number(await rendering.browser.$('[data-testid="scroll-smoke"]').getProperty("scrollTop")) >
        0,
      { timeout: 3000 },
    );
    console.log(
      "Trusted canvas pointer/wheel, nested scroll, and delayed single-click checks passed.",
    );
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
