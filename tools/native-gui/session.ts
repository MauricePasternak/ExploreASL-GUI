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
import {
  resolveApplicationPath,
  resolveTauriDriver,
  waitForTcpPort,
} from "../../e2e-tests/wdio.config.helpers";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

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

export function sandboxArguments(workspace: string): string[] {
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

  get browser(): Browser {
    if (!this.connection) throw new Error("Launch the native GUI first.");
    return this.connection;
  }

  async launch({
    fresh = false,
    profile_template,
  }: {
    fresh?: boolean;
    profile_template?: string;
  } = {}): Promise<{ workspace: string; application: string }> {
    if (this.driver) throw new Error("Window already launched; close it before relaunching.");
    if (process.platform !== "linux")
      throw new Error("Native agent controller currently supports Linux only.");
    if (!process.env.DISPLAY)
      throw new Error("DISPLAY missing. Run OpenCode under Xvfb for headless interaction.");
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
    const [port, nativePort] = await Promise.all([freePort(), freePort()]);
    const log = createWriteStream(path.join(workspace, "driver.log"));
    const driver = spawn(
      bwrap,
      [
        ...sandboxArguments(workspace),
        "--",
        dbus,
        "--",
        driverPath,
        "--port",
        String(port),
        "--native-port",
        String(nativePort),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.driver = driver;
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
      return { workspace, application };
    } catch (error) {
      await this.stopDriver();
      const diagnostics = await readFile(path.join(workspace, "driver.log"), "utf8").catch(
        () => "",
      );
      throw new Error(
        `${error instanceof Error ? error.message : error}\n${diagnostics.slice(-4000)}`,
        { cause: error },
      );
    }
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
export function inspectDom(selector: string, limit: number) {
  const root = document.querySelector(selector);
  if (!root) throw new Error(`No element matches ${selector}`);
  function locator(element: Element): string {
    const testId = element.getAttribute("data-testid");
    if (testId) {
      const css = `[data-testid=${JSON.stringify(testId)}]`;
      if (document.querySelectorAll(css).length === 1) return css;
    }
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1)
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
    return parts.join(" > ");
  }
  const candidates = [
    root,
    ...root.querySelectorAll(
      "button, input, textarea, select, a, [role], [tabindex], [data-testid]",
    ),
  ].filter(
    (node) =>
      node instanceof HTMLElement &&
      node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility !== "hidden",
  );
  return {
    url: window.location.href,
    text: (root as HTMLElement).innerText?.slice(0, 8000) ?? "",
    total: candidates.length,
    elements: candidates.slice(0, limit).map((node) => {
      const control = node as HTMLInputElement;
      const rect = node.getBoundingClientRect();
      return {
        selector: locator(node),
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute("role"),
        label: node.getAttribute("aria-label") ?? control.labels?.[0]?.textContent?.trim() ?? "",
        text: (node as HTMLElement).innerText?.trim().slice(0, 200),
        value: control.type === "password" ? "[redacted]" : control.value,
        disabled: control.disabled || node.getAttribute("aria-disabled") === "true",
        checked: control.checked,
        inViewport:
          rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
      };
    }),
  };
}
