import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { cp, mkdir, mkdtemp, open, readFile, realpath, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remote, type Browser } from "webdriverio";
import { z } from "zod";
import { ExecutionProfileSchema } from "../../src/schemas/executionProfile";
import { errorText, pngDimensions, saveArtifact, tailLog } from "./diagnostics";
import {
  resolveApplicationPath,
  resolveTauriDriver,
  waitForTcpPort,
} from "../../e2e-tests/wdio.config.helpers";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
export const SizeSchema = z.object({
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
});
type Size = z.infer<typeof SizeSchema>;
export const PointSchema = z.object({
  x: z.number().int().min(0).max(4095),
  y: z.number().int().min(0).max(4095),
});
type Point = z.infer<typeof PointSchema>;

// Passed directly to WebDriver; measurements are CSS pixels, not PNG/image pixels.
export function viewportMetrics() {
  return {
    url: location.href.slice(0, 4096),
    route: location.hash.slice(0, 4096),
    viewport: { width: innerWidth, height: innerHeight, units: "CSS pixels" },
    screen: {
      width: screen.width,
      height: screen.height,
      available_width: screen.availWidth,
      available_height: screen.availHeight,
      units: "CSS pixels",
    },
    device_pixel_ratio: devicePixelRatio,
    visual_viewport: window.visualViewport
      ? {
          width: visualViewport!.width,
          height: visualViewport!.height,
          scale: visualViewport!.scale,
        }
      : null,
  };
}

function executable(name: string): string {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Required executable missing: ${name}`);
  return result.stdout.trim();
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  // ponytail: release before driver bind; retry launch if another process claims this ephemeral port.
  return port;
}

export function sandboxArguments(workspace: string, xauthority?: string): string[] {
  const sandboxAuthority = path.join(workspace, "runtime", "Xauthority");
  return [
    "--die-with-parent",
    "--unshare-pid",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    tmpdir(),
    "--bind",
    workspace,
    workspace,
    "--chdir",
    workspace,
    "--setenv",
    "HOME",
    path.join(workspace, "home"),
    "--setenv",
    "XDG_CONFIG_HOME",
    path.join(workspace, "config"),
    "--setenv",
    "XDG_DATA_HOME",
    path.join(workspace, "data"),
    "--setenv",
    "XDG_CACHE_HOME",
    path.join(workspace, "cache"),
    "--setenv",
    "XDG_RUNTIME_DIR",
    path.join(workspace, "runtime"),
    "--setenv",
    "TMPDIR",
    workspace,
    "--setenv",
    "GDK_BACKEND",
    "x11",
    ...(xauthority
      ? ["--ro-bind", xauthority, sandboxAuthority, "--setenv", "XAUTHORITY", sandboxAuthority]
      : []),
  ];
}

export async function copyProject(sourceRoot: string, workspace: string): Promise<string> {
  const source = await realpath(path.resolve(projectRoot, sourceRoot));
  const relative = path.relative(source, workspace);
  if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) {
    throw new Error("Source contains the agent workspace; refusing recursive self-copy.");
  }
  if (!(await stat(path.join(source, "project.easl"))).isFile()) {
    throw new Error("Source must contain a project.easl file.");
  }
  const parent = await mkdtemp(path.join(workspace, "project-"));
  const destination = path.join(parent, path.basename(source));
  await cp(source, destination, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
  return path.join(destination, "project.easl");
}

export async function seedProfiles(source: string, workspace: string): Promise<void> {
  const template: unknown = JSON.parse(await readFile(path.resolve(projectRoot, source), "utf8"));
  const profiles = {
    executionProfiles: ExecutionProfileSchema.array()
      .min(1)
      .parse(z.object({ executionProfiles: z.unknown() }).parse(template).executionProfiles),
  };
  const { identifier } = JSON.parse(
    await readFile(path.join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"),
  ) as { identifier: string };
  const directory = path.join(workspace, "data", identifier);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "settings.json"), JSON.stringify(profiles), {
    mode: 0o600,
    flag: "wx",
  });
}

export class NativeGuiSession {
  workspace?: string;
  private driver?: ChildProcess;
  private connection?: Browser;
  private port?: number;
  private display?: "virtual" | "desktop";
  private screenSize?: Size;
  private requestedSize?: Size;
  private lastDriverExit?: { code: number | null; signal: NodeJS.Signals | null };

  get browser(): Browser {
    if (!this.connection) throw new Error("Launch the native GUI first.");
    return this.connection;
  }

  async launch({
    fresh = false,
    profile_template,
    display = "virtual",
    window_size,
    screen_size,
  }: {
    fresh?: boolean;
    profile_template?: string;
    display?: "virtual" | "desktop";
    window_size?: Size;
    screen_size?: Size;
  } = {}) {
    if (this.driver) throw new Error("Window already launched; close it before relaunching.");
    const capacity = SizeSchema.parse(screen_size ?? { width: 1920, height: 1080 });
    if (window_size) SizeSchema.parse(window_size);
    if (display === "desktop" && screen_size)
      throw new Error("screen_size is virtual-only; desktop mode never resizes your desktop.");
    if (
      display === "virtual" &&
      window_size &&
      (window_size.width > capacity.width || window_size.height > capacity.height)
    )
      throw new Error(
        "window_size exceeds screen_size; explicitly request a larger virtual screen.",
      );
    if (process.platform !== "linux")
      throw new Error("Native agent controller currently supports Linux only.");
    if (display === "desktop" && !process.env.DISPLAY)
      throw new Error(
        "Desktop mode requires DISPLAY. Omit display to use a private virtual display.",
      );
    const xauthority =
      display === "desktop"
        ? await realpath(process.env.XAUTHORITY || path.join(homedir(), ".Xauthority")).catch(
            (cause: unknown) => {
              throw new Error(
                "Desktop Xauthority unavailable. Launch from the current graphical session, or use the default virtual display.",
                { cause },
              );
            },
          )
        : undefined;
    const xvfb = display === "virtual" ? executable("xvfb-run") : undefined;
    if (xvfb) {
      executable("Xvfb");
      executable("xauth");
    }
    const bwrap = executable("bwrap");
    const dbus = executable("dbus-run-session");
    const driverPath = resolveTauriDriver({
      env: process.env,
      platform: process.platform,
      homeDirectory: homedir(),
      resolveFromPath: (name) => {
        try {
          return executable(name);
        } catch {
          return undefined;
        }
      },
    });
    const application = await realpath(
      resolveApplicationPath({ env: process.env, platform: process.platform, projectRoot }),
    );
    const base = process.env.NATIVE_GUI_TMPDIR ?? path.join(tmpdir(), "opencode");
    await mkdir(base, { recursive: true });
    const workspace =
      this.workspace && !fresh && !profile_template
        ? this.workspace
        : await realpath(await mkdtemp(path.join(base, "native-gui-")));
    await Promise.all(
      ["home", "config", "data", "cache", "runtime"].map((name) =>
        mkdir(path.join(workspace, name), { mode: 0o700, recursive: true }),
      ),
    );
    if (profile_template) await seedProfiles(profile_template, workspace);
    this.workspace = workspace;
    this.display = display;
    this.screenSize = display === "virtual" ? capacity : undefined;
    this.requestedSize = window_size;
    this.lastDriverExit = undefined;
    const [port, nativePort] = await Promise.all([freePort(), freePort()]);
    this.port = port;
    const logPath = path.join(workspace, "driver.log");
    const log = await open(
      logPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const driver = spawn(
        bwrap,
        [
          ...sandboxArguments(workspace, xauthority),
          "--",
          dbus,
          "--",
          // Start inside the sandbox so its private temporary mount cannot hide the auth file.
          ...(xvfb
            ? [
                xvfb,
                "-a",
                "-e",
                logPath,
                "-s",
                // Server GLX probes inaccessible host GPUs; WebKit still provides WebGL through EGL.
                `-screen 0 ${capacity.width}x${capacity.height}x24 -nolisten tcp -extension GLX`,
                "--",
              ]
            : []),
          driverPath,
          "--port",
          String(port),
          "--native-port",
          String(nativePort),
        ],
        { stdio: ["ignore", log.fd, log.fd] },
      );
      this.driver = driver;
      driver.once("exit", (code, signal) => {
        this.lastDriverExit = { code, signal };
        if (this.driver === driver) {
          this.driver = undefined;
          this.connection = undefined;
        }
      });
      await Promise.race([
        Promise.all(
          [port, nativePort].map((port) =>
            waitForTcpPort({ host: "127.0.0.1", port, timeoutMs: 15_000 }),
          ),
        ),
        new Promise<never>((_, reject) => {
          driver.once("error", reject);
          driver.once("exit", (code) => reject(new Error(`Native driver exited (${code}).`)));
        }),
      ]);
      const capabilities: WebdriverIO.Capabilities & { "tauri:options": { application: string } } =
        { "tauri:options": { application } };
      this.connection = await remote({
        hostname: "127.0.0.1",
        port,
        path: "/",
        logLevel: "silent",
        connectionRetryCount: 0,
        connectionRetryTimeout: 30_000,
        capabilities,
      });
      await this.browser.$('[data-testid="app-ready"]').waitForExist({ timeout: 30_000 });
      // E2E bootstrap starts with defaults; restore this controller session's own saved settings.
      await this.browser.execute(async () => {
        const app = window as unknown as {
          __E2E__?: unknown;
          __DEBUG__?: { stores: { globalStore: { loadSettings(): Promise<void> } } };
        };
        if (app.__E2E__) await app.__DEBUG__?.stores.globalStore.loadSettings();
      });
      const metrics = window_size ? await this.resize(window_size) : await this.metrics();
      return { workspace, application, metrics };
    } catch (error) {
      // Capture while the webview is still available; the tool wrapper reuses this evidence.
      const evidence = await this.failureEvidence().catch((captureError: unknown) => ({
        unavailable: errorText(captureError),
      }));
      await this.stopDriver();
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { evidence });
    } finally {
      await log.close();
    }
  }

  async resize(size: Size) {
    SizeSchema.parse(size);
    const browser = this.browser;
    if (
      this.screenSize &&
      (size.width > this.screenSize.width || size.height > this.screenSize.height)
    )
      throw new Error(
        `Requested window exceeds virtual screen ${this.screenSize.width}x${this.screenSize.height}. Explicitly close/relaunch with larger screen_size; live resize never resets state.`,
      );
    // Native window command only; no CSS transforms or display reconfiguration.
    await browser.setWindowSize(size.width, size.height);
    this.requestedSize = size;
    return this.metrics();
  }

  // Short, abortable read-only protocol calls: evidence cannot inherit WDIO's 30s retry timeout.
  private async probe<T>(command: string, body?: unknown): Promise<T> {
    if (!this.connection || !this.port) throw new Error("No connected native browser.");
    const response = await fetch(
      `http://127.0.0.1:${this.port}/session/${encodeURIComponent(this.connection.sessionId)}/${command}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(1500),
      },
    );
    const chunks: Uint8Array[] = [];
    const maximum = command === "screenshot" ? 96 * 1024 * 1024 : 1024 * 1024;
    let size = 0;
    for await (const chunk of response.body!) {
      size += chunk.length;
      if (size > maximum) throw new Error("Native evidence response exceeds byte limit.");
      chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      value: T & { error?: string; message?: string };
    };
    if (!response.ok || result.value?.error)
      throw new Error(result.value?.message ?? `Native probe failed: HTTP ${response.status}`);
    return result.value;
  }

  async metrics() {
    const [page, nativeWindow] = await Promise.all([
      this.probe<ReturnType<typeof viewportMetrics>>("execute/sync", {
        script: `return (${viewportMetrics.toString()})();`,
        args: [],
      }),
      this.probe<{ x: number; y: number; width: number; height: number }>("window/rect"),
    ]);
    return {
      ...page,
      native_window: { ...nativeWindow, units: "WebDriver window units (not image pixels)" },
      requested_window: this.requestedSize ?? null,
      virtual_screen_capacity: this.screenSize ?? null,
      display: this.display,
    };
  }

  async diagnostics() {
    const driver = this.driver;
    const status = {
      workspace: this.workspace ?? null,
      driver: {
        pid: driver?.pid ?? null,
        process_running: !!driver?.pid && driver.exitCode === null && driver.signalCode === null,
        last_exit: this.lastDriverExit ?? null,
      },
    };
    const live = this.connection
      ? await this.metrics().then(
          (metrics) => ({ reachable: true as const, metrics }),
          (error: unknown) => ({ reachable: false as const, unavailable: errorText(error) }),
        )
      : { reachable: false as const, unavailable: "No connected native browser." };
    const config = JSON.parse(
      await readFile(path.join(projectRoot, "src-tauri/tauri.conf.json"), "utf8"),
    ) as { identifier: string; productName: string };
    const logs = this.workspace
      ? await Promise.all(
          [
            "driver.log",
            "exploreasl-gui-logs/dev.log",
            `data/${config.identifier}/logs/${config.productName}.log`,
          ].map((relative) => tailLog(this.workspace!, relative)),
        )
      : [];
    return { ...status, live, logs };
  }

  async failureEvidence(selector?: string) {
    const diagnostics = await this.diagnostics();
    const artifacts: string[] = [];
    const errors: string[] = [];
    let target:
      | { selector: string; inspection?: ReturnType<typeof inspectDom>; unavailable?: string }
      | undefined;
    if (!this.workspace) return { diagnostics, artifacts, errors };
    const prefix = `failures/${Date.now()}-${randomUUID()}`;
    if (this.connection) {
      await Promise.all([
        (async () => {
          try {
            const image = await this.probe<string>("screenshot");
            pngDimensions(image);
            artifacts.push(
              await saveArtifact(this.workspace!, `${prefix}.png`, Buffer.from(image, "base64")),
            );
          } catch (error) {
            errors.push(`screenshot: ${errorText(error)}`);
          }
        })(),
        (async () => {
          try {
            const dom = await this.probe<ReturnType<typeof inspectDom>>("execute/sync", {
              script: pageScript(inspectDom),
              args: ["body", { limit: 40 }],
            });
            artifacts.push(
              await saveArtifact(this.workspace!, `${prefix}.dom.json`, JSON.stringify(dom)),
            );
          } catch (error) {
            errors.push(`DOM: ${errorText(error)}`);
          }
        })(),
        (async () => {
          if (!selector) return;
          try {
            const inspection = await this.probe<ReturnType<typeof inspectDom>>("execute/sync", {
              script: pageScript(inspectDom),
              args: [
                selector,
                {
                  limit: 1,
                  styles: [
                    "display",
                    "visibility",
                    "opacity",
                    "pointer-events",
                    "position",
                    "z-index",
                    "overflow",
                  ],
                  includeHidden: true,
                  geometry: true,
                },
              ],
            });
            target = { selector, inspection };
          } catch (error) {
            target = { selector, unavailable: errorText(error) };
          }
        })(),
      ]);
    }
    try {
      artifacts.push(
        await saveArtifact(
          this.workspace,
          `${prefix}.diagnostics.json`,
          JSON.stringify(diagnostics),
        ),
      );
    } catch (error) {
      errors.push(`diagnostics file: ${errorText(error)}`);
    }
    return { diagnostics, target, artifacts, errors };
  }

  async close(): Promise<void> {
    if (this.connection) {
      try {
        // Keep the window alive if ordinary project shutdown fails.
        await this.browser.execute(async () => {
          const debug = (
            window as unknown as {
              __DEBUG__?: { stores: { projectStore: { closeProject(): Promise<void> } } };
            }
          ).__DEBUG__;
          if (!debug) throw new Error("App debug API unavailable; close the window manually.");
          await debug.stores.projectStore.closeProject();
        });
        await this.browser.deleteSession();
      } catch (error) {
        // WDIO maps the protocol error code to name; messages can contain arbitrary app errors.
        if (
          !(error instanceof Error) ||
          (error.name !== "invalid session id" && error.name !== "no such window")
        )
          throw error;
      }
    }
    await this.stopDriver();
  }

  async stopDriver(): Promise<void> {
    this.connection = undefined;
    const driver = this.driver;
    this.driver = undefined;
    if (!driver || driver.exitCode !== null || driver.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => driver.kill("SIGKILL"), 5_000);
      driver.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      driver.kill("SIGTERM");
    });
  }

  async element(selector: string, scroll = true) {
    // Validate CSS before WDIO interprets selector strategies; reject script/XPath selectors.
    let count = await this.browser.execute(
      (css) => document.querySelectorAll(css).length,
      selector,
    );
    if (count === 0) {
      await this.browser.waitUntil(
        async () => {
          count = await this.browser.execute(
            (css) => document.querySelectorAll(css).length,
            selector,
          );
          return count > 0;
        },
        {
          timeout: 15_000,
          timeoutMsg: `Timed out waiting for ${selector}: element does not exist. Confirm navigation completed or inspect body for current selectors.`,
        },
      );
    }
    if (count !== 1) throw await this.ambiguityError(selector);
    const element = this.browser.$(selector);
    await element.waitForDisplayed({ timeout: 15_000 });
    if (scroll) await element.scrollIntoView({ block: "center", inline: "center" });
    return element;
  }

  async pointerPoints(selector: string, points: (Point | undefined)[], scroll = true) {
    await this.element(selector, scroll);
    return this.browser.execute(
      (css, offsets) => {
        const elements = document.querySelectorAll(css);
        if (elements.length !== 1)
          throw new Error("Pointer target must match exactly one element.");
        const element = elements[0];
        const rect = element.getBoundingClientRect();
        return offsets.map((point) => {
          if (point && (point.x >= rect.width || point.y >= rect.height))
            throw new Error("Pointer point lies outside the target element.");
          const x = Math.floor(
            point
              ? rect.left + point.x
              : (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2,
          );
          const y = Math.floor(
            point
              ? rect.top + point.y
              : (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2,
          );
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight)
            throw new Error(
              "Pointer point lies outside the viewport; scroll the target into view.",
            );
          const hit = document.elementFromPoint(x, y);
          if (!hit || !element.contains(hit))
            throw new Error("Pointer point is covered by another element.");
          return { x, y };
        });
      },
      selector,
      points.map((point) => point ?? null),
    );
  }

  async ambiguityError(selector: string): Promise<Error> {
    const message = (await this.browser.execute(
      pageScript((page, css: string) => page.ambiguous(css)),
      selector,
    )) as string;
    return new Error(message);
  }

  // Failures inside send() may follow partially delivered input; callers must not blindly retry.
  async dispatch<T>(send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        inputSent: "possibly",
      });
    }
  }

  async observe(selector?: string) {
    try {
      return (await this.browser.execute(pageScript(observeState), selector ?? null)) as ReturnType<
        typeof observeState
      >;
    } catch (error) {
      return { unavailable: errorText(error) };
    }
  }

  async performInput(action: { perform(): Promise<void> }) {
    await this.dispatch(async () => {
      try {
        await action.perform();
      } catch (error) {
        // A partially accepted drag must not leave a mouse button held down.
        await this.browser.releaseActions().catch(() => {});
        throw error;
      }
    });
  }

  async click(selector: string, point?: Point) {
    if (!point) {
      const element = await this.element(selector);
      await this.dispatch(() => element.click());
      return;
    }
    const [target] = await this.pointerPoints(selector, [point]);
    await this.performInput(
      this.browser
        .action("pointer")
        .move({ ...target, origin: "viewport" })
        .down()
        .up(),
    );
  }

  async hover(selector: string, point?: Point) {
    const [target] = await this.pointerPoints(selector, [point]);
    await this.performInput(this.browser.action("pointer").move({ ...target, origin: "viewport" }));
    return target;
  }

  async scroll(selector: string, deltaX: number, deltaY: number, point?: Point) {
    if (deltaX === 0 && deltaY === 0) throw new Error("Provide a nonzero scroll delta.");
    const [target] = await this.pointerPoints(selector, [point], false);
    await this.performInput(
      this.browser.action("wheel").scroll({ ...target, deltaX, deltaY, duration: 200 }),
    );
  }

  async drag(selector: string, from: Point, to: Point, duration: number) {
    const [start, end] = await this.pointerPoints(selector, [from, to]);
    await this.performInput(
      this.browser
        .action("pointer")
        .move({ ...start, origin: "viewport" })
        .down()
        .move({ ...end, origin: "viewport", duration })
        .up(),
    );
    return { from: start, to: end };
  }

  async navigate(route: string): Promise<void> {
    await this.browser.execute(async (target) => {
      const bridge = (
        window as unknown as {
          __E2E__?: { navigate(route: string): Promise<void>; ready(): Promise<void> };
        }
      ).__E2E__;
      if (bridge) {
        await bridge.navigate(target);
        await bridge.ready();
      } else {
        window.location.hash = `#${target}`;
      }
    }, route);
    await this.browser.waitUntil(async () => (await this.browser.getUrl()).endsWith(`#${route}`), {
      timeout: 15_000,
    });
  }
}

// Injected into page scripts by source (see pageScript); keep it self-contained.
// Object methods, not named arrow consts: tsx wraps those in a __name helper absent in the page.
export function pageHelpers() {
  const page = {
    locator(element: Element): string | null {
      const testId = element.getAttribute("data-testid");
      if (testId) {
        const css = `[data-testid=${JSON.stringify(testId)}]`;
        if (css.length <= 4096 && document.querySelectorAll(css).length === 1) return css;
      }
      if (
        element.id &&
        element.id.length <= 512 &&
        document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1
      )
        return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const siblings = node.parentElement
          ? Array.from(node.parentElement.children).filter(
              (sibling) => sibling.tagName === node!.tagName,
            )
          : [node];
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
      }
      const css = parts.join(" > ");
      return css.length <= 4096 ? css : null;
    },
    visible(node: HTMLElement): boolean {
      const style = getComputedStyle(node);
      if (!node.getClientRects().length || style.visibility !== "visible") return false;
      for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).opacity === "0") return false;
      }
      return true;
    },
    value(node: Element, limit: number): unknown {
      const control = node as HTMLInputElement;
      if (control.type === "password") return "[redacted]";
      return typeof control.value === "string" ? control.value.slice(0, limit) : control.value;
    },
    ambiguous(selector: string): string {
      const matches = Array.from(document.querySelectorAll(selector));
      const first = matches.slice(0, 5).map((node) => {
        const text = (node as HTMLElement).innerText?.trim().replace(/\s+/g, " ").slice(0, 60);
        const hidden = node instanceof HTMLElement && !page.visible(node) ? " [hidden]" : "";
        return `${page.locator(node) ?? node.tagName.toLowerCase()}${text ? ` "${text}"` : ""}${hidden}`;
      });
      return `Selector is ambiguous: matched ${matches.length} elements; narrow the CSS selector. First matches: ${first.join("; ")}`;
    },
  };
  return page;
}
export type PageHelpers = ReturnType<typeof pageHelpers>;

// WebDriver serializes functions without their closures, so helpers travel as source.
export function pageScript(fn: (page: PageHelpers, ...args: never[]) => unknown): string {
  return `return (${fn.toString()})((${pageHelpers.toString()})(), ...arguments);`;
}

export type InspectOptions = {
  limit?: number;
  styles?: string[];
  includeHidden?: boolean;
  geometry?: boolean;
};

export type InspectedElement = {
  selector: string | null;
  tag: string;
  role?: string;
  label?: string;
  text?: string;
  value?: unknown;
  disabled?: true;
  checked?: boolean | string;
  focused?: true;
  hidden?: true;
  offscreen?: true;
  styles?: Record<string, string>;
  visible?: boolean;
  inViewport?: boolean;
  bounds?: Record<string, number | string>;
  scroll?: Record<string, number>;
  center_hit?: { status: string; target: string | null };
};

// Passed to WebDriver through pageScript; keep browser-side logic self-contained.
export function inspectDom(
  page: PageHelpers,
  selector: string,
  { limit = 150, styles = [], includeHidden = false, geometry = false }: InspectOptions = {},
) {
  const roots = document.querySelectorAll(selector);
  if (roots.length === 0)
    throw new Error(
      `Target absent: ${selector}. Current URL: ${window.location.href.slice(0, 4096)}. inspect does not wait; wait for the destination element after navigation, or inspect body for current selectors.`,
    );
  if (roots.length > 1) throw new Error(page.ambiguous(selector));
  const root = roots[0];
  const query = "button, input, textarea, select, a, [role], [tabindex], [data-testid]";
  const controlRoles =
    /^(button|link|tab|option|menuitem|menuitemcheckbox|menuitemradio|checkbox|radio|switch|treeitem)$/;
  const candidates = [root, ...root.querySelectorAll(query)].filter(
    (node) => node instanceof HTMLElement && (includeHidden || page.visible(node)),
  );
  // Containers repeat descendant text; keep it only when it differs from the nearest listed ancestor.
  const shownText = new Map<Element, string>();
  const elements = candidates.slice(0, limit).map((node): InspectedElement => {
    const control = node as HTMLInputElement;
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute("role")?.slice(0, 200) ?? "";
    const label = (
      node.getAttribute("aria-label") ??
      control.labels?.[0]?.textContent?.trim() ??
      ""
    ).slice(0, 200);
    const text = (node as HTMLElement).innerText?.trim().slice(0, 200) ?? "";
    const isControl =
      /^(button|a|option|summary|label)$/.test(tag) ||
      controlRoles.test(role) ||
      !node.querySelector(query);
    let ancestor = node.parentElement;
    while (ancestor && !shownText.has(ancestor)) ancestor = ancestor.parentElement;
    const containerText = text.slice(0, 80);
    const showText =
      node !== root &&
      !!text &&
      (isControl || !ancestor || shownText.get(ancestor) !== containerText);
    shownText.set(node, containerText);
    const value = page.value(node, geometry ? 2000 : 200);
    const checked =
      control.type === "checkbox" || control.type === "radio"
        ? control.checked
        : (node.getAttribute("aria-checked") ?? undefined);
    const rendered = page.visible(node as HTMLElement);
    const rect = node.getBoundingClientRect();
    const inViewport =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < innerHeight &&
      rect.right > 0 &&
      rect.left < innerWidth;
    const entry: InspectedElement = {
      selector: page.locator(node),
      tag,
      ...(role ? { role } : {}),
      ...(label ? { label } : {}),
      ...(showText ? { text: isControl ? text : containerText } : {}),
      ...(value !== undefined && value !== "" ? { value } : {}),
      ...(control.disabled || node.getAttribute("aria-disabled") === "true"
        ? { disabled: true as const }
        : {}),
      ...(checked !== undefined ? { checked } : {}),
      ...(document.activeElement === node ? { focused: true as const } : {}),
      ...(rendered ? {} : { hidden: true as const }),
      ...(rendered && !inViewport ? { offscreen: true as const } : {}),
      ...(styles.length
        ? {
            styles: Object.fromEntries(
              styles.map((property) => [
                property,
                getComputedStyle(node).getPropertyValue(property).slice(0, 500),
              ]),
            ),
          }
        : {}),
    };
    if (!geometry) return entry;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const centerInViewport = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
    const hit = rendered && centerInViewport ? document.elementFromPoint(x, y) : null;
    return {
      ...entry,
      visible: rendered,
      inViewport,
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        units: "CSS pixels",
      },
      scroll: {
        left: node.scrollLeft,
        top: node.scrollTop,
        width: node.scrollWidth,
        height: node.scrollHeight,
        client_width: node.clientWidth,
        client_height: node.clientHeight,
      },
      center_hit: {
        status: !rendered
          ? "hidden"
          : !centerInViewport
            ? "outside-viewport"
            : !hit
              ? "no-hit"
              : node.contains(hit)
                ? "uncovered"
                : "covered",
        target: hit ? page.locator(hit) : null,
      },
    };
  });
  return {
    url: window.location.href.slice(0, 4096),
    text: (root as HTMLElement).innerText?.slice(0, 8000) ?? "",
    focus: document.activeElement ? page.locator(document.activeElement) : null,
    scroll: { x: scrollX, y: scrollY },
    ...(geometry
      ? {
          hit_test_note:
            "Center-point sample only; not a guarantee of clickability. Hidden, offscreen and covered are distinct.",
        }
      : {}),
    total: candidates.length,
    elements,
  };
}

// Passed to WebDriver through pageScript. Values are observed immediately, not final.
export function observeState(page: PageHelpers, selector: string | null) {
  const focused = document.activeElement;
  const targets = selector ? document.querySelectorAll(selector) : [];
  return {
    route: location.hash.slice(1, 4097),
    focus: focused && focused !== document.body ? page.locator(focused) : null,
    ...(selector
      ? { value: targets.length === 1 ? (page.value(targets[0], 200) ?? null) : null }
      : {}),
  };
}
