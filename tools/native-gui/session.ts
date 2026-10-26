import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { constants, createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
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
  const profiles = z
    .object({ executionProfiles: z.array(ExecutionProfileSchema).min(1) })
    .parse(template);
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
    const log = createWriteStream(logPath, { flags: "a" });
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
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.driver = driver;
    driver.once("exit", (code, signal) => {
      this.lastDriverExit = { code, signal };
    });
    driver.stdout!.pipe(log, { end: false });
    driver.stderr!.pipe(log, { end: false });
    driver.once("close", () => log.end());
    try {
      await Promise.race([
        waitForTcpPort({ host: "127.0.0.1", port, timeoutMs: 15_000 }),
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

  async failureEvidence() {
    const diagnostics = await this.diagnostics();
    const artifacts: string[] = [];
    const errors: string[] = [];
    if (!this.workspace) return { diagnostics, artifacts, errors };
    const prefix = `failures/${Date.now()}-${crypto.randomUUID()}`;
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
              script: `return (${inspectDom.toString()})("body", 40, [], false);`,
              args: [],
            });
            artifacts.push(
              await saveArtifact(this.workspace!, `${prefix}.dom.json`, JSON.stringify(dom)),
            );
          } catch (error) {
            errors.push(`DOM: ${errorText(error)}`);
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
    return { diagnostics, artifacts, errors };
  }

  async close(): Promise<void> {
    if (this.connection) {
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

  async element(selector: string) {
    // Validate CSS before WDIO interprets selector strategies; reject script/XPath selectors.
    const count = await this.browser.execute(
      (css) => document.querySelectorAll(css).length,
      selector,
    );
    if (count !== 1)
      throw new Error(`Selector matched ${count} elements; use a unique CSS selector.`);
    const element = this.browser.$(selector);
    await element.waitForDisplayed({ timeout: 15_000 });
    await element.scrollIntoView({ block: "center", inline: "center" });
    return element;
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

// Passed directly to WebDriver; keep browser-side logic self-contained.
export function inspectDom(
  selector: string,
  limit: number,
  styles: string[] = [],
  includeHidden = false,
) {
  const roots = document.querySelectorAll(selector);
  if (roots.length !== 1)
    throw new Error(`Selector matched ${roots.length} elements; use a unique CSS selector.`);
  const root = roots[0];
  const helpers = {
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
  };
  const candidates = [
    root,
    ...root.querySelectorAll(
      "button, input, textarea, select, a, [role], [tabindex], [data-testid]",
    ),
  ].filter((node) => node instanceof HTMLElement && (includeHidden || helpers.visible(node)));
  return {
    url: window.location.href.slice(0, 4096),
    text: (root as HTMLElement).innerText?.slice(0, 8000) ?? "",
    focus: document.activeElement ? helpers.locator(document.activeElement) : null,
    scroll: { x: scrollX, y: scrollY },
    hit_test_note:
      "Center-point sample only; not a guarantee of clickability. Hidden, offscreen and covered are distinct.",
    total: candidates.length,
    elements: candidates.slice(0, limit).map((node) => {
      const control = node as HTMLInputElement;
      const rect = node.getBoundingClientRect();
      const rendered = helpers.visible(node as HTMLElement);
      const inViewport =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const centerInViewport = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
      const hit = rendered && centerInViewport ? document.elementFromPoint(x, y) : null;
      return {
        selector: helpers.locator(node),
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute("role")?.slice(0, 200) ?? null,
        label: (
          node.getAttribute("aria-label") ??
          control.labels?.[0]?.textContent?.trim() ??
          ""
        ).slice(0, 200),
        text: (node as HTMLElement).innerText?.trim().slice(0, 200),
        value:
          control.type === "password"
            ? "[redacted]"
            : typeof control.value === "string"
              ? control.value.slice(0, 2000)
              : control.value,
        disabled: control.disabled || node.getAttribute("aria-disabled") === "true",
        checked: control.checked,
        inViewport,
        visible: rendered,
        focused: document.activeElement === node,
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
          target: hit ? helpers.locator(hit) : null,
        },
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
    }),
  };
}
