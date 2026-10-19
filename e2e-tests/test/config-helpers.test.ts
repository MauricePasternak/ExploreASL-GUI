import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import path from "node:path";

import {
  createBuildArguments,
  createBuildEnvironment,
  resolveApplicationPath,
  resolveArtifactDirectory,
  resolvePnpmCommand,
  sanitizeArtifactName,
  resolveTauriDriver,
  shouldSkipBuild,
  signalDriver,
  stopDriver,
  waitForTcpPort,
} from "../wdio.config.helpers";

const projectRoot = path.resolve("/workspace/ExploreASL_GUI");
const e2eRoot = path.join(projectRoot, "e2e-tests");

test("resolves the Linux debug application path", () => {
  assert.equal(
    resolveApplicationPath({ env: {}, platform: "linux", projectRoot }),
    path.join(projectRoot, "src-tauri", "target", "debug", "exploreasl_gui"),
  );
});

test("adds the Windows executable suffix", () => {
  assert.equal(
    resolveApplicationPath({ env: {}, platform: "win32", projectRoot }),
    path.join(projectRoot, "src-tauri", "target", "debug", "exploreasl_gui.exe"),
  );
});

test("uses the application path override unchanged", () => {
  assert.equal(
    resolveApplicationPath({
      env: { E2E_APP_PATH: "D:\\builds\\ExploreASL GUI.exe" },
      platform: "win32",
      projectRoot,
    }),
    "D:\\builds\\ExploreASL GUI.exe",
  );
});

test("uses the tauri driver override before PATH or cargo home", () => {
  assert.equal(
    resolveTauriDriver({
      env: { E2E_TAURI_DRIVER: "/custom/tauri-driver" },
      homeDirectory: "/home/tester",
      platform: "linux",
      resolveFromPath: () => "/usr/local/bin/tauri-driver",
    }),
    "/custom/tauri-driver",
  );
});

test("resolves tauri-driver from PATH before cargo home", () => {
  assert.equal(
    resolveTauriDriver({
      env: {},
      homeDirectory: "/home/tester",
      platform: "linux",
      resolveFromPath: () => "/usr/local/bin/tauri-driver",
    }),
    "/usr/local/bin/tauri-driver",
  );
});

test("falls back to the platform-aware cargo-home driver path", () => {
  assert.equal(
    resolveTauriDriver({
      env: {},
      homeDirectory: "/home/tester",
      platform: "win32",
      resolveFromPath: () => undefined,
    }),
    path.join("/home/tester", ".cargo", "bin", "tauri-driver.exe"),
  );
});

test("uses CARGO_HOME when PATH has no driver", () => {
  assert.equal(
    resolveTauriDriver({
      env: { CARGO_HOME: "/opt/cargo" },
      homeDirectory: "/home/tester",
      platform: "linux",
      resolveFromPath: () => undefined,
    }),
    path.join("/opt/cargo", "bin", "tauri-driver"),
  );
});

test("skips the build only for E2E_SKIP_BUILD=1", () => {
  assert.equal(shouldSkipBuild({ E2E_SKIP_BUILD: "1" }), true);
  assert.equal(shouldSkipBuild({ E2E_SKIP_BUILD: "true" }), false);
  assert.equal(shouldSkipBuild({}), false);
});

test("adds the exact E2E gate without dropping inherited environment", () => {
  assert.deepEqual(createBuildEnvironment({ KEEP_ME: "yes", VITE_E2E: "0" }), {
    KEEP_ME: "yes",
    VITE_E2E: "1",
  });
});

test("passes debug build flags to Tauri rather than Cargo", () => {
  assert.deepEqual(createBuildArguments(), ["tauri", "build", "--debug", "--no-bundle"]);
});

test("uses the Windows pnpm command shim without a shell", () => {
  assert.equal(resolvePnpmCommand("win32"), "pnpm.cmd");
  assert.equal(resolvePnpmCommand("linux"), "pnpm");
});

test("uses an e2e-local artifact directory unless overridden", () => {
  assert.equal(resolveArtifactDirectory({}, e2eRoot), path.join(e2eRoot, "artifacts"));
  assert.equal(resolveArtifactDirectory({ E2E_ARTIFACT_DIR: "/results" }, e2eRoot), "/results");
});

test("waits until the native driver port accepts connections", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    await waitForTcpPort({ host: "127.0.0.1", port: address.port, timeoutMs: 100 });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("keeps artifact file names below filesystem limits", () => {
  const name = "test ".repeat(100);
  assert.ok(sanitizeArtifactName(name).length <= 120);
});

test(
  "stops driver-owned applications even when session startup or the driver has failed",
  { skip: process.platform === "win32", timeout: 15_000 },
  async () => {
    for (const exitEarly of [false, true]) {
      const application = `process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000);`;
      const driver = spawn(
        process.execPath,
        [
          "-e",
          `const { spawn } = require("node:child_process");
          spawn(process.execPath, ["-e", ${JSON.stringify(application)}], { stdio: ["ignore", "inherit", "inherit"] });
          ${exitEarly ? "process.exit(1);" : "setInterval(() => {}, 1000);"}`,
        ],
        { detached: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const exited = once(driver, "exit");
      const closed = once(driver, "close", { signal: AbortSignal.timeout(10_000) });
      try {
        const [output] = await once(driver.stdout!, "data");
        assert.equal(output.toString().trim(), "ready");
        if (exitEarly) await exited;
        await stopDriver(driver);
        // The application inherits the pipe; close cannot fire while it is still alive.
        await closed;
        assert.notEqual(driver.exitCode ?? driver.signalCode, null);
      } finally {
        signalDriver(driver, "SIGKILL");
      }
    }
  },
);
