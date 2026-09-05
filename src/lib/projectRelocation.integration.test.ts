import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMatlabProfile } from "../test/profileFixtures";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { readSessionCheckpoint } from "./sessionCheckpoint";
import { resolveLogicalSource } from "./projectPaths";
import { runProcessingPipeline, watchLockDir } from "./processingEvents";
import { resetProjectLifecycleForTests } from "./projectLifecycle";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore, __resetProjectRevisionForTests } from "../stores/projectStore";

const roots: string[] = [];
const accessedPaths: string[] = [];

function projectBytes(dataSource: "bids" | "dicom", oldRoot: string): string {
  return JSON.stringify({
    version: "0.1.0",
    projectMeta: {
      id: `relocated-${dataSource}`,
      name: `Relocated ${dataSource}`,
      rootPath: oldRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastOpened: "2026-01-01T00:00:00.000Z",
      currentPhase: "processing",
      dataSource,
    },
    uiState: {},
    mappingState: {
      sourceDataPath: dataSource === "bids" ? oldRoot : "./sourcedata",
      rawPaths: dataSource === "dicom" ? ["sub-01/ASL"] : [],
      pathPatterns: [],
    },
    dataPar: {},
  });
}

async function makeMovedProject(dataSource: "bids" | "dicom") {
  const parent = await mkdtemp(join(tmpdir(), "exploreasl-relocation-"));
  roots.push(parent);
  const oldRoot = join(parent, "former-project");
  const newRoot = join(parent, "moved-project");
  await mkdir(join(oldRoot, "sourcedata", "sub-01", "ASL"), { recursive: true });
  await writeFile(join(oldRoot, "project.easl"), projectBytes(dataSource, oldRoot));
  await rename(oldRoot, newRoot);
  return { oldRoot, newRoot, easlPath: join(newRoot, "project.easl") };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  accessedPaths.length = 0;
  resetProjectLifecycleForTests();
  __resetProjectRevisionForTests();
  useProjectStore.setState({
    project: null,
    isDirty: false,
    loaded: false,
    recovery: null,
    recoveredFromBackup: false,
  });
  const profile = makeMatlabProfile();
  useGlobalStore.setState({
    loaded: true,
    settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
    profileValidationState: { [profile.id]: { valid: true, errors: [] } },
  });

  vi.mocked(readTextFile).mockImplementation(async (path) => {
    const value = String(path);
    accessedPaths.push(value);
    return readFile(value, "utf8");
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "shutdown_project_runtime") {
      return {
        success: true,
        importProcess: { success: true },
        processingWorkers: { success: true },
        lockWatcher: { success: true },
      };
    }
    if (command === "inspect_source_path") {
      const { projectRoot, sourcePath } = args as { projectRoot: string; sourcePath: string };
      const absolutePath = resolve(projectRoot, sourcePath);
      accessedPaths.push(projectRoot, absolutePath);
      const projectRelativePath = `./${relative(projectRoot, absolutePath).replace(/\\/g, "/")}`;
      return {
        absolutePath,
        exists: true,
        readable: true,
        isDirectory: true,
        ownership: "internal",
        projectRelativePath,
      };
    }
    if (command === "atomic_write_project") {
      const { projectPath, canonicalBytes } = args as {
        projectPath: string;
        canonicalBytes: string;
      };
      accessedPaths.push(projectPath);
      await writeFile(projectPath, canonicalBytes);
      return null;
    }
    if (command === "run_pipeline" || command === "watch_lock_dir") {
      return {
        runId: "processing-run-relocation",
        lifecycle: "running",
        projectRoot: "/native-derived-root",
        selectedModules: ["structural"],
        selectedSubjectSessions: ["sub-01_01"],
        startTime: 1,
        workers: [1234],
        exitEvidence: [],
        watcherOwned: command === "watch_lock_dir",
      };
    }
    return null;
  });
});

afterEach(async () => {
  resetProjectLifecycleForTests();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.each(["bids", "dicom"] as const)("%s project relocation", (dataSource) => {
  it("uses only the opened location for owned reads, saves, processing, and watcher roots", async () => {
    const { oldRoot, newRoot, easlPath } = await makeMovedProject(dataSource);

    await useProjectStore.getState().loadProject(easlPath);
    const project = useProjectStore.getState().project!;
    expect(project.projectMeta.rootPath).toBe(newRoot);
    expect(
      resolveLogicalSource(newRoot, project.mappingState.sourceDataPath ?? "", dataSource),
    ).toBe(dataSource === "bids" ? newRoot : join(newRoot, "sourcedata"));
    expect(readSessionCheckpoint()?.easlPath).toBe(easlPath);

    useProjectStore.getState().toggleNavbar();
    await useProjectStore.getState().saveProject();
    const profile = useGlobalStore.getState().settings.executionProfiles[0];
    await runProcessingPipeline(
      "processing-run-relocation",
      {
        subjects: ["sub-01_01"],
        modules: ["structural"],
        selectedProfileId: profile.id,
        workers: 1,
      },
      profile,
    );
    await watchLockDir("processing-run-relocation");

    expect(JSON.parse(await readFile(easlPath, "utf8")).projectMeta.rootPath).toBeUndefined();
    expect(accessedPaths).toContain(easlPath);
    // Processing and watcher IPC now carry native run identity, not a renderer
    // project root. Root authority remains in the active native project record.
    expect(accessedPaths).not.toContain(oldRoot);
    expect(accessedPaths.every((path) => !path.startsWith(oldRoot))).toBe(true);
  });
});
