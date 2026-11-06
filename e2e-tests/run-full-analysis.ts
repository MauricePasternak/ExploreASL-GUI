import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isolatedAnalysisEnvironment,
  prepareAnalysisProject,
  verifyFile,
} from "./test/support/full-analysis-fixture";
import {
  createBuildArguments,
  createBuildEnvironment,
  resolveArtifactDirectory,
  resolvePnpmCommand,
  resolveTauriDriver,
  shouldSkipBuild,
} from "./wdio.config.helpers";

const e2eRoot = fileURLToPath(new URL(".", import.meta.url));
if (process.platform !== "linux")
  throw new Error("Full analysis currently requires Linux + Apptainer.");
const sif = process.env.E2E_SIF_PATH;
const checksum = process.env.E2E_SIF_SHA256;
if (!sif || !path.isAbsolute(sif) || !checksum) {
  throw new Error(
    "Full analysis requires E2E_SIF_PATH (absolute) and E2E_SIF_SHA256; no public SIF URL is assumed.",
  );
}
await verifyFile(sif, checksum);
if (!shouldSkipBuild(process.env)) {
  const built = spawnSync(resolvePnpmCommand(process.platform), createBuildArguments(), {
    cwd: path.resolve(e2eRoot, ".."),
    env: createBuildEnvironment(process.env),
    stdio: "inherit",
  });
  if (built.error) throw built.error;
  if (built.status !== 0) throw new Error(`E2E build failed: ${built.status}`);
}
const artifacts = path.resolve(resolveArtifactDirectory(process.env, e2eRoot));
await mkdir(artifacts, { recursive: true });
const root = await mkdtemp(path.join(artifacts, "full-analysis-"));
// Short OS-temp paths also avoid Unix socket limits in WebKit/MATLAB Runtime.
const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "easl-full-"));
const env = isolatedAnalysisEnvironment(process.env, runtimeRoot);
env.E2E_ANALYSIS_PROJECT = path.join(root, "ds003151");
// Resolve before replacing HOME; driver installation remains read-only.
env.E2E_TAURI_DRIVER = resolveTauriDriver({
  env: process.env,
  homeDirectory: os.homedir(),
  platform: process.platform,
  resolveFromPath: (name) => {
    const result = spawnSync("which", [name], { encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : undefined;
  },
});
env.E2E_ARTIFACT_DIR = root;
env.E2E_SKIP_BUILD = "1";
for (const key of [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  "TMPDIR",
  "APPTAINER_CACHEDIR",
]) {
  await mkdir(env[key]!, { recursive: true, mode: 0o700 });
}
console.log(
  `[full-analysis] Project/log artifacts: ${root}; isolated runtime/home: ${runtimeRoot}`,
);
await prepareAnalysisProject(env.E2E_ANALYSIS_PROJECT!, process.env.E2E_ANALYSIS_DATASET);
const child = spawn(
  process.execPath,
  [
    path.join(e2eRoot, "node_modules/@wdio/cli/bin/wdio.js"),
    "run",
    path.join(e2eRoot, "wdio.full-analysis.conf.ts"),
  ],
  {
    // Do not let Apptainer's automatic CWD bind expose the repository or source dataset.
    cwd: env.TMPDIR,
    env,
    stdio: "inherit",
  },
);
// Never remove the project or runtime automatically, even after failure/interrupted workers.
const [code, signal] = await once(child, "exit");
for (const folder of ["config", "data", "state"]) {
  await cp(path.join(runtimeRoot, folder), path.join(root, folder), { recursive: true });
}
if (signal) console.error(`[full-analysis] WDIO ended with ${signal}; retained ${root}`);
process.exitCode = code ?? 1;
