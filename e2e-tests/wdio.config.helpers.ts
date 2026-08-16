import net from "node:net";
import path from "node:path";

type Environment = Record<string, string | undefined>;

interface ApplicationPathOptions {
  env: Environment;
  platform: NodeJS.Platform;
  projectRoot: string;
}

interface TauriDriverOptions {
  env: Environment;
  homeDirectory: string;
  platform: NodeJS.Platform;
  resolveFromPath: (executable: string) => string | undefined;
}

export function resolveApplicationPath({
  env,
  platform,
  projectRoot,
}: ApplicationPathOptions): string {
  if (env.E2E_APP_PATH) return env.E2E_APP_PATH;

  const executable = platform === "win32" ? "exploreasl_gui.exe" : "exploreasl_gui";
  return path.join(projectRoot, "src-tauri", "target", "debug", executable);
}

export function resolveTauriDriver({
  env,
  homeDirectory,
  platform,
  resolveFromPath,
}: TauriDriverOptions): string {
  if (env.E2E_TAURI_DRIVER) return env.E2E_TAURI_DRIVER;

  const executable = platform === "win32" ? "tauri-driver.exe" : "tauri-driver";
  return (
    resolveFromPath(executable) ??
    (env.CARGO_HOME
      ? path.join(env.CARGO_HOME, "bin", executable)
      : path.join(homeDirectory, ".cargo", "bin", executable))
  );
}

export function shouldSkipBuild(env: Environment): boolean {
  return env.E2E_SKIP_BUILD === "1";
}

export function createBuildEnvironment(env: Environment): NodeJS.ProcessEnv {
  return { ...env, VITE_E2E: "1" };
}

export function createBuildArguments(): string[] {
  return ["tauri", "build", "--debug", "--no-bundle"];
}

export function resolvePnpmCommand(platform: NodeJS.Platform): string {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function resolveArtifactDirectory(env: Environment, e2eRoot: string): string {
  return env.E2E_ARTIFACT_DIR ?? path.join(e2eRoot, "artifacts");
}

export function sanitizeArtifactName(name: string): string {
  return (
    name
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 120) || "unnamed-test"
  );
}

export function waitForTcpPort({
  host,
  port,
  timeoutMs,
  retryMs = 100,
}: {
  host: string;
  port: number;
  timeoutMs: number;
  retryMs?: number;
}): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for native driver at ${host}:${port}.`));
          return;
        }
        setTimeout(tryConnect, retryMs);
      });
    };
    tryConnect();
  });
}
