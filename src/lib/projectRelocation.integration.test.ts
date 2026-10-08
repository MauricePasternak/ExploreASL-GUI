import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMatlabProfile } from "../test/profileFixtures";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { readSessionCheckpoint } from "./sessionCheckpoint";
import { resolveLogicalSource } from "./projectPaths";
import { resetProjectLifecycleForTests } from "./projectLifecycle";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import { projectFixture } from "../test/projectFixtures";

const roots: string[] = [];

function projectBytes(dataSource: "bids" | "dicom", oldRoot: string): string {
  const fixture = projectFixture(`relocated-${dataSource}`, `Relocated ${dataSource}`, oldRoot, {
    mappingState: {
      sourceDataPath: dataSource === "bids" ? "." : "./sourcedata",
      rawPaths: dataSource === "dicom" ? ["sub-01/ASL"] : [],
      pathPatterns: [],
    },
  });
  fixture.document.projectMeta.dataSource = dataSource;
  return JSON.stringify(fixture.document);
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
  resetProjectLifecycleForTests();
  useProjectStore.setState(useProjectStore.getInitialState(), true);
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
});

afterEach(async () => {
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.each(["bids", "dicom"] as const)("%s project relocation", (dataSource) => {
  it("uses only the opened location for owned reads and saves; native owns watchers", async () => {
    const { oldRoot, newRoot, easlPath } = await makeMovedProject(dataSource);
    const before = await readFile(easlPath, "utf8");
    const opened = projectFixture(`relocated-${dataSource}`, `Relocated ${dataSource}`, newRoot, {
      mappingState: {
        sourceDataPath: dataSource === "bids" ? "." : "./sourcedata",
        rawPaths: dataSource === "dicom" ? ["sub-01/ASL"] : [],
        pathPatterns: [],
      },
    });
    opened.document.projectMeta.dataSource = dataSource;
    const edited = structuredClone(opened);
    edited.acceptedRevision = 1;
    edited.document.uiState.navbarCollapsed = false;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "inspect_project")
        return {
          candidateId: "moved",
          projectId: opened.document.projectMeta.id,
          name: opened.document.projectMeta.name,
          rootPath: newRoot,
          recoveredFromBackup: false,
          duplicatePath: null,
          movedFrom: null,
          setupRecovered: 0,
        };
      if (command === "activate_project") return opened;
      if (command === "accept_project_edit") return edited;
      if (command === "save_project") return { ...edited, persistedRevision: 1 };
      if (command === "get_active_import_run" || command === "get_active_run") return null;
      if (command === "read_import_status") return [];
      throw new Error(`Unexpected command ${command}`);
    });

    await useProjectStore.getState().loadProject(easlPath);
    const project = useProjectStore.getState().project!;
    expect(project.projectMeta.rootPath).toBe(newRoot);
    expect(
      resolveLogicalSource(newRoot, project.mappingState.sourceDataPath ?? "", dataSource),
    ).toBe(dataSource === "bids" ? newRoot : join(newRoot, "sourcedata"));
    expect(readSessionCheckpoint()?.easlPath).toBe(easlPath);
    expect(await readFile(easlPath, "utf8")).toBe(before);

    await useProjectStore.getState().toggleNavbar();
    await useProjectStore.getState().saveProject();
    expect(JSON.parse(await readFile(easlPath, "utf8")).projectMeta.rootPath).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("inspect_project", { path: easlPath, recents: [] });
    expect(invoke).toHaveBeenCalledWith("save_project", { generation: 1 });
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain(oldRoot);
  });
});
