import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { copyProject, inspectDom, NativeGuiSession } from "./session";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
const selector = z
  .string()
  .min(1)
  .max(4096)
  .describe('Unique CSS selector, preferably [data-testid="..."].');
const text = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

export function createServer() {
  const server = new McpServer(
    { name: "exploreasl-native-gui", version: "0.1.0" },
    {
      instructions:
        "Controls disposable native Linux Tauri windows, not Chromium. Launch first, inspect for CSS selectors, then act. Each OpenCode session owns a separate window. Real filesystem is read-only; writable paths are returned by launch. Native dialogs are not automated. Close when finished.",
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
          .then(() => run(args as z.output<z.ZodObject<S>>, session.gui));
        session.pending = result;
        return result;
      },
    );
  }

  register(
    "launch",
    "Launch separate native window with isolated settings, private D-Bus and read-only host filesystem. Uses existing E2E_APP_PATH build; never rebuilds the app.",
    {},
    async (_, gui) => text(await gui.launch()),
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
    "Inspect visible DOM, text, input values, labels and actionable CSS selectors. Password values redacted. Offscreen elements report inViewport=false.",
    {
      selector: z.string().min(1).max(4096).default("body"),
      limit: z.number().int().min(1).max(500).default(150),
    },
    async (args, gui) => text(await gui.browser.execute(inspectDom, args.selector, args.limit)),
  );

  register(
    "screenshot",
    "Return PNG image of native webview and save it inside disposable workspace. Native dialogs and window decorations are not included.",
    {},
    async (_, gui) => {
      const image = await gui.browser.takeScreenshot();
      const directory = path.join(gui.workspace!, "screenshots");
      await mkdir(directory, { recursive: true });
      const filename = path.join(directory, `${Date.now()}.png`);
      await writeFile(filename, Buffer.from(image, "base64"));
      return {
        content: [
          { type: "image", data: image, mimeType: "image/png" },
          { type: "text", text: filename },
        ],
      };
    },
  );

  register(
    "click",
    "Click unique visible element. Scrolls into view and uses real WebDriver input.",
    { selector },
    async (args, gui) => {
      await (await gui.element(args.selector)).click();
      return text({ clicked: args.selector });
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
