import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import "@wdio/types";

import {
  createBuildArguments,
  createBuildEnvironment,
  resolveApplicationPath,
  resolveArtifactDirectory,
  resolvePnpmCommand,
  resolveTauriDriver,
  sanitizeArtifactName,
  shouldSkipBuild,
  waitForTcpPort,
} from "./wdio.config.helpers";

type TauriConfig = Omit<WebdriverIO.Config, "capabilities"> & {
  capabilities: Array<WebdriverIO.Capabilities & { "tauri:options": { application: string } }>;
};

const e2eRoot = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = path.resolve(e2eRoot, "..");
const applicationPath = resolveApplicationPath({
  env: process.env,
  platform: process.platform,
  projectRoot,
});
const artifactDirectory = resolveArtifactDirectory(process.env, e2eRoot);

let tauriDriver: ChildProcess | undefined;
let stoppingDriver = false;

function findOnPath(executable: string): string | undefined {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, [executable], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  if (result.status !== 0) return undefined;
  return result.stdout.split(/\r?\n/).find(Boolean)?.trim();
}

function getTauriDriverPath(): string {
  return resolveTauriDriver({
    env: process.env,
    homeDirectory: os.homedir(),
    platform: process.platform,
    resolveFromPath: findOnPath,
  });
}

function assertExecutableExists(executable: string, label: string): void {
  if (!existsSync(executable)) {
    throw new Error(
      `${label} not found at ${executable}. Set the matching E2E_* override or install it.`,
    );
  }
}

function buildApplication(): void {
  if (shouldSkipBuild(process.env)) return;

  const result = spawnSync(resolvePnpmCommand(process.platform), createBuildArguments(), {
    cwd: projectRoot,
    env: createBuildEnvironment(process.env),
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) throw new Error(`Tauri E2E build could not start: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`Tauri E2E build failed with exit code ${result.status ?? "signal"}.`);
}

function closeTauriDriver(): Promise<void> {
  const driver = tauriDriver;
  tauriDriver = undefined;
  stoppingDriver = true;
  if (!driver || driver.exitCode !== null || driver.signalCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      driver.kill("SIGKILL");
      resolve();
    }, 5_000);
    driver.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    driver.kill("SIGTERM");
  });
}

function diagnosticError(error: unknown): Record<string, string> | null {
  if (!error) return null;
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? "" };
  return { message: String(error), stack: "" };
}

async function captureFailureArtifacts(
  test: { title: string; fullTitle?: string },
  error: unknown,
): Promise<void> {
  try {
    mkdirSync(artifactDirectory, { recursive: true });
    const artifactBase = `${sanitizeArtifactName(test.fullTitle ?? test.title)}-${Date.now()}`;
    const screenshotPath = path.join(artifactDirectory, `${artifactBase}.png`);
    const [url, pageSource, diagnostics] = await Promise.all([
      browser.getUrl(),
      browser.getPageSource(),
      browser.execute(() => {
        const globals = window as Window & {
          __E2E__?: { currentRoute: string | null; currentScenario: string | null };
          __DEBUG__?: { route?: unknown; log?: unknown };
        };
        const e2e = globals.__E2E__;
        const debug = globals.__DEBUG__;
        return {
          e2e: e2e
            ? { currentRoute: e2e.currentRoute, currentScenario: e2e.currentScenario }
            : null,
          debug: debug ? { route: debug.route ?? null, log: debug.log ?? null } : null,
          hash: window.location.hash,
        };
      }),
    ]);

    await browser.saveScreenshot(screenshotPath);
    writeFileSync(path.join(artifactDirectory, `${artifactBase}.html`), pageSource);
    writeFileSync(
      path.join(artifactDirectory, `${artifactBase}.json`),
      `${JSON.stringify({ error: diagnosticError(error), url, diagnostics }, null, 2)}\n`,
    );
  } catch (artifactError) {
    console.warn("[e2e] Failed to capture failure artifacts:", artifactError);
  }
}

const signalExitCode = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGBREAK: 131 } as const;
for (const signal of Object.keys(signalExitCode) as (keyof typeof signalExitCode)[]) {
  process.once(signal, () => {
    void closeTauriDriver().finally(() => {
      process.exit(signalExitCode[signal]);
    });
  });
}
process.once("exit", () => {
  stoppingDriver = true;
  tauriDriver?.kill();
});

export const config: TauriConfig = {
  hostname: "127.0.0.1",
  port: 4444,
  path: "/",
  specs: ["./test/specs/**/*.ts"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": { application: applicationPath },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
  waitforTimeout: 15_000,

  onPrepare: () => {
    buildApplication();
    assertExecutableExists(applicationPath, "Tauri E2E application");
  },

  beforeSession: async () => {
    const driverPath = getTauriDriverPath();
    assertExecutableExists(driverPath, "tauri-driver");
    stoppingDriver = false;
    tauriDriver = spawn(driverPath, [], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    tauriDriver.stdout?.pipe(process.stdout);
    tauriDriver.stderr?.pipe(process.stderr);
    tauriDriver.once("error", (error) => {
      console.error("[e2e] tauri-driver failed:", error);
    });
    tauriDriver.once("exit", (code, signal) => {
      if (!stoppingDriver) {
        console.error(`[e2e] tauri-driver exited unexpectedly (code ${code}, signal ${signal}).`);
      }
    });
    try {
      await waitForTcpPort({ host: "127.0.0.1", port: 4444, timeoutMs: 15_000 });
    } catch (error) {
      await closeTauriDriver();
      throw error;
    }
  },

  afterTest: async (test, _context, result) => {
    if (result.error) await captureFailureArtifacts(test, result.error);
  },

  afterSession: async () => {
    await closeTauriDriver();
  },

  onComplete: async () => {
    await closeTauriDriver();
  },
};
