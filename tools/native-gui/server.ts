import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { copyProject, inspectDom, NativeGuiSession, PointSchema, SizeSchema } from "./session";
import { errorText, pngDimensions, saveArtifact } from "./diagnostics";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
const selector = z
  .string()
  .min(1)
  .max(4096)
  .describe('Unique CSS selector, preferably [data-testid="..."].');
const point = PointSchema.describe(
  "CSS-pixel offset from target element's top-left, after scrolling. Not screenshot pixels.",
);
const text = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

export function createServer() {
  const server = new McpServer(
    { name: "exploreasl-native-gui", version: "0.1.0" },
    {
      instructions:
        "Controls disposable native Linux Tauri windows, not Chromium. Launch first, inspect for CSS selectors, then act. Windows use private virtual displays by default; display: desktop explicitly uses the inherited graphical session. Launch defaults to vanilla settings for new sessions; profile_template seeds only execution profiles into a fresh workspace, and fresh starts an empty workspace. Each OpenCode session owns a separate window. Real filesystem is read-only; writable paths are returned by launch. Native dialogs are not automated; use the app's Enter path alternatives. Pointer offsets use CSS pixels, not screenshot pixels. Close when finished.",
    },
  );
  const sessions = new Map<string, { gui: NativeGuiSession; pending: Promise<unknown> }>();

  function state(extra: Extra) {
    const id = extra._meta?.["ai.opencode/sessionID"];
    if (id !== undefined && (typeof id !== "string" || !id))
      throw new Error("Invalid OpenCode session metadata.");
    const key = id ?? "stdio-client";
    if (!sessions.has(key))
      sessions.set(key, { gui: new NativeGuiSession(), pending: Promise.resolve() });
    return sessions.get(key)!;
  }

  function register<S extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S,
    run: (args: z.output<z.ZodObject<S>>, gui: NativeGuiSession) => Promise<CallToolResult>,
  ) {
    server.registerTool<z.ZodRawShape, z.ZodObject<S>>(
      name,
      { description, inputSchema: z.object(inputSchema) },
      async (args, extra) => {
        const session = state(extra);
        // Serialize only this window; separate agents remain independent.
        const result = session.pending
          .catch(() => {})
          .then(async () => {
            try {
              return await run(args as z.output<z.ZodObject<S>>, session.gui);
            } catch (error) {
              // Never re-enter tool dispatch or let evidence replace the original failure.
              const evidence =
                error instanceof Error && "evidence" in error
                  ? error.evidence
                  : await session.gui.failureEvidence().catch((captureError: unknown) => ({
                      unavailable: errorText(captureError),
                    }));
              return {
                ...text({
                  error: String(error instanceof Error ? error.message : error),
                  evidence,
                }),
                isError: true,
              };
            }
          });
        session.pending = result;
        return result;
      },
    );
  }

  register(
    "launch",
    "Launch separate native window with isolated settings, private D-Bus, authenticated virtual display and read-only host filesystem. display: desktop opts into the inherited desktop instead. Default relaunch preserves settings; fresh forces vanilla, profile_template starts fresh with saved profiles and normal validation. Close current window before switching. Uses existing E2E_APP_PATH build; never rebuilds the app.",
    {
      display: z
        .enum(["virtual", "desktop"])
        .optional()
        .describe(
          "Defaults to a private virtual display (no desktop login needed). Use desktop only for a visible window with current DISPLAY and XAUTHORITY.",
        ),
      fresh: z
        .boolean()
        .optional()
        .describe(
          "Start a new empty workspace instead of reusing saved settings. Previous workspace is retained.",
        ),
      profile_template: z
        .string()
        .trim()
        .min(1)
        .max(4096)
        .optional()
        .describe(
          "JSON file containing executionProfiles (for example saved settings.json); absolute or repository-relative path. Always starts a fresh workspace. Imports no other settings.",
        ),
      window_size: SizeSchema.optional().describe(
        "Requested native window width/height, 1–4096 each. Not an exact CSS viewport; docked devtools and OS constraints may shrink it.",
      ),
      screen_size: SizeSchema.optional().describe(
        "Virtual framebuffer pixels, 1–4096 each; default 1920x1080. Select capacity at launch (e.g. 3840x2160 or 2160x3840). Virtual mode only.",
      ),
    },
    async (args, gui) => text(await gui.launch(args)),
  );

  register(
    "resize",
    "Resize native window via WebDriver; return observed window/CSS viewport/screen/DPR. Cannot exceed launch-time virtual screen capacity; close/relaunch explicitly for more. Does not resize desktop or emulate devices.",
    { ...SizeSchema.shape },
    async (args, gui) => text(await gui.resize(args)),
  );

  register(
    "diagnostics",
    "Read session workspace/driver status, live route/metrics when reachable, and bounded tails (16 KiB/100 lines each) of fixed own driver/native logs. Works before launch and after close/failure; no arbitrary path input.",
    {},
    async (_, gui) => text(await gui.diagnostics()),
  );

  register(
    "close",
    "Gracefully close this session's project and native window. Refuses closure if project shutdown fails. Disposable files remain for inspection.",
    {},
    async (_, gui) => {
      await gui.close();
      return text({ closed: true, workspace: gui.workspace });
    },
  );

  register(
    "inspect",
    "Read-only DOM inspection: text/labels/values (passwords redacted), unique selectors, CSS bounds, focus/scroll and visibility/center hit-test overlap. Offscreen differs from hidden/covered; sampled hit testing does not guarantee clickability. Optional bounded computed styles/hidden elements. Never scrolls or focuses.",
    {
      selector: z.string().min(1).max(4096).default("body"),
      limit: z.number().int().min(1).max(500).default(150),
      styles: z
        .array(
          z
            .string()
            .min(1)
            .max(80)
            .regex(/^-{0,2}[a-z][a-z0-9-]*$/i),
        )
        .max(12)
        .default([])
        .describe(
          "At most 12 computed CSS property names; each returned value capped at 500 characters.",
        ),
      include_hidden: z.boolean().default(false),
    },
    async (args, gui) =>
      text(
        await gui.browser.execute(
          inspectDom,
          args.selector,
          args.limit,
          args.styles,
          args.include_hidden,
        ),
      ),
  );

  register(
    "screenshot",
    "Return PNG image of native webview and save it inside disposable workspace. Native dialogs and window decorations are not included.",
    {},
    async (_, gui) => {
      const image = await gui.browser.takeScreenshot();
      const filename = await saveArtifact(
        gui.workspace!,
        `screenshots/${Date.now()}-${randomUUID()}.png`,
        Buffer.from(image, "base64"),
      );
      const metrics = await gui
        .metrics()
        .catch((error: unknown) => ({ unavailable: errorText(error) }));
      return {
        content: [
          { type: "image", data: image, mimeType: "image/png" },
          {
            type: "text",
            text: JSON.stringify({ path: filename, image: pngDimensions(image), metrics }),
          },
        ],
      };
    },
  );

  register(
    "click",
    "Click unique visible element, waiting for async appearance. Optional point targets a CSS-pixel offset from its top-left. Scrolls into view; real WebDriver input, no action retries.",
    { selector, point: point.optional() },
    async (args, gui) => {
      await gui.click(args.selector, args.point);
      return text({ clicked: args.selector });
    },
  );

  register(
    "hover",
    "Move real mouse pointer over unique visible element, optionally at a CSS-pixel offset from top-left. Scrolls target into view; does not click or focus.",
    { selector, point: point.optional() },
    async (args, gui) => {
      const target = await gui.hover(args.selector, args.point);
      return text({ hovered: args.selector, viewport_point: target });
    },
  );

  register(
    "scroll",
    "Send real mouse-wheel input at target's visible center or optional top-left CSS-pixel offset. Does not recenter target first; works with nested scroll regions and canvas wheel handlers. Positive delta_y scrolls down.",
    {
      selector,
      point: point.optional(),
      delta_x: z.number().int().min(-10_000).max(10_000).default(0),
      delta_y: z.number().int().min(-10_000).max(10_000).default(0),
    },
    async (args, gui) => {
      await gui.scroll(args.selector, args.delta_x, args.delta_y, args.point);
      return text({ scrolled: args.selector, delta_x: args.delta_x, delta_y: args.delta_y });
    },
  );

  register(
    "drag",
    "Left-button drag within a unique visible element using real mouse input. from/to are CSS-pixel offsets from target top-left, not screenshot pixels. Scrolls into view; endpoints must be uncovered and inside viewport. Buttons released even on failure. Non-primary buttons are unsupported by this native driver.",
    {
      selector,
      from: point,
      to: point,
      duration_ms: z.number().int().min(0).max(5000).default(500),
    },
    async (args, gui) => {
      const points = await gui.drag(args.selector, args.from, args.to, args.duration_ms);
      return text({ dragged: args.selector, viewport_points: points });
    },
  );

  register(
    "fill",
    "Replace text in unique visible input or textarea using WebDriver input events.",
    { selector, value: z.string().max(100_000) },
    async (args, gui) => {
      await (await gui.element(args.selector)).setValue(args.value);
      return text({ filled: args.selector });
    },
  );

  register(
    "select",
    "Select option by value in native HTML select. For Mantine/custom dropdowns use click on trigger, inspect, then click option.",
    { selector, value: z.string().max(4096) },
    async (args, gui) => {
      await (await gui.element(args.selector)).selectByAttribute("value", args.value);
      return text({ selected: args.selector });
    },
  );

  register(
    "keys",
    'Send WebDriver keys to focused element. Examples: ["Tab"], ["Escape"], ["Control","s"]. Modifiers released after command.',
    {
      keys: z.array(z.string().min(1).max(100)).min(1).max(16),
    },
    async (args, gui) => {
      await gui.browser.keys(args.keys);
      return text({ sent: args.keys });
    },
  );

  register(
    "wait",
    "Wait for CSS selector state; text condition means text contains supplied string. Hidden succeeds when no matching displayed element remains.",
    {
      selector,
      state: z.enum(["visible", "hidden", "enabled", "text"]).default("visible"),
      text: z.string().max(8000).optional(),
      timeout_ms: z.number().int().min(1).max(60_000).default(15_000),
    },
    async (args, gui) => {
      if (args.state === "text" && args.text === undefined)
        throw new Error("text is required for text state.");
      await gui.browser.execute((css) => {
        document.querySelectorAll(css);
      }, args.selector);
      await gui.browser.waitUntil(
        async () => {
          const elements = await gui.browser.$$(args.selector).getElements();
          if (args.state === "hidden")
            return (await elements.map((element) => element.isDisplayed())).every(
              (displayed) => !displayed,
            );
          if (elements.length !== 1) return false;
          const element = elements[0];
          if (!(await element.isDisplayed())) return false;
          if (args.state === "enabled") return element.isEnabled();
          // Native E2E tests use textContent too: WebKit can return empty getText() for buttons.
          if (args.state === "text")
            return (
              await gui.browser.execute(
                (css) => document.querySelector(css)?.textContent ?? "",
                args.selector,
              )
            ).includes(args.text!);
          return true;
        },
        {
          timeout: args.timeout_ms,
          timeoutMsg: `Timed out waiting for ${args.selector}: ${args.state}`,
        },
      );
      return text({ matched: args.selector, state: args.state });
    },
  );

  register(
    "navigate",
    "Navigate logical hash-router path. Reuses E2E navigation/readiness bridge when present. Does not load projects or bypass access gates.",
    {
      route: z
        .string()
        .max(4096)
        .regex(/^\/(?!\/)/)
        .describe("App route such as /overview; no URL or hash prefix."),
    },
    async (args, gui) => {
      await gui.navigate(args.route);
      return text({ route: args.route });
    },
  );

  register(
    "copy_project",
    "Copy existing project directory into writable workspace and add copy to isolated Recent Projects. Source untouched; symlinks preserved and external targets read-only. Open copy through Recent Projects; normal profile/access checks apply.",
    {
      source_root: z.string().min(1).max(4096),
    },
    async (args, gui) => {
      const browser = gui.browser;
      const projectFile = await copyProject(args.source_root, gui.workspace!);
      await browser.execute(async (filename) => {
        const debug = (
          window as unknown as {
            __DEBUG__?: {
              stores: {
                globalStore: {
                  addRecentProject(path: string): void;
                  saveSettings(): Promise<void>;
                };
              };
            };
          }
        ).__DEBUG__;
        if (!debug)
          throw new Error(
            "App debug API unavailable; copy exists but could not add Recent Projects entry.",
          );
        debug.stores.globalStore.addRecentProject(filename);
        await debug.stores.globalStore.saveSettings();
      }, projectFile);
      return text({ project_file: projectFile, added_to_recent_projects: true });
    },
  );

  async function shutdown() {
    await Promise.allSettled(
      Array.from(sessions.values(), async ({ gui, pending }) => {
        await pending.catch(() => {});
        try {
          await gui.close();
        } catch (error) {
          console.error("Native GUI shutdown failed; disposing isolated test processes:", error);
          await gui.stopDriver();
        }
      }),
    );
  }
  return { server, shutdown };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, shutdown } = createServer();
  server.server.onclose = () => {
    void shutdown();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown().then(() => server.close());
    });
  }
  await server.connect(new StdioServerTransport());
}
