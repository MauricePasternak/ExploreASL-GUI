import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeMatlabProfile } from "../test/profileFixtures";
import { useGlobalStore } from "./globalStore";
import { useImportStore } from "./importStore";
import { useProjectStore } from "./projectStore";
import { projectView } from "../schemas/project";
import { projectFixture } from "../test/projectFixtures";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { resetProjectLifecycleForTests } from "../lib/projectLifecycle";

function seedValidProfileGate() {
  const profile = makeMatlabProfile();
  useGlobalStore.setState({
    loaded: true,
    settings: {
      ...DEFAULT_SETTINGS,
      executionProfiles: [profile],
    },
    profileValidationState: {
      [profile.id]: { valid: true, errors: [] },
    },
  });
  return profile;
}

const native = projectFixture("project-1", "Demo Project", "/tmp/demo-project");
native.document.uiState.import = {
  selectedProfileId: "valid-profile",
  bidsReviewConfirmed: false,
  mostRecentConfig: null,
};
const inspection = {
  candidateId: "candidate",
  projectId: "project-1",
  name: "Demo Project",
  rootPath: "/tmp/demo-project",
  recoveredFromBackup: false,
  duplicatePath: null,
  movedFrom: null,
  setupRecovered: 0,
};

describe("useProjectStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useProjectStore.getState().cancelAutosave();
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    resetProjectLifecycleForTests();
    seedValidProfileGate();
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
      recovery: null,
      recoveredFromBackup: false,
    });

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "shutdown_project_runtime") {
        return {
          success: true,
          importProcess: { success: true },
          processingWorkers: { success: true },
          lockWatcher: { success: true },
        };
      }
      if (command === "get_active_import_run") return null;
      if (command === "get_active_run") return null;
      if (command === "read_import_status") return [];
      if (command === "create_project" || command === "inspect_project") return inspection;
      if (command === "activate_project") return native;
      throw new Error(`Unexpected command ${command}`);
    });
  });

  it("defaults import selectedProfileId to the first valid profile on create", async () => {
    const valid = makeMatlabProfile({ id: "valid-profile", label: "Valid" });
    const invalid = makeMatlabProfile({ id: "invalid-profile", label: "Invalid" });
    useGlobalStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        executionProfiles: [invalid, valid],
      },
      profileValidationState: {
        [invalid.id]: { valid: false, errors: ["bad"] },
        [valid.id]: { valid: true, errors: [] },
      },
    });

    await useProjectStore
      .getState()
      .createProject("/tmp/demo-project", "Demo Project", { dataSource: "dicom" });

    expect(useProjectStore.getState().project?.uiState.import?.selectedProfileId).toBe(valid.id);
    expect(invoke).toHaveBeenCalledWith("create_project", {
      root: "/tmp/demo-project",
      name: "Demo Project",
      source: "dicom",
      profileId: valid.id,
    });
  });

  it("throws when creating a project without a valid execution profile", async () => {
    useGlobalStore.setState({
      settings: DEFAULT_SETTINGS,
      profileValidationState: {},
    });

    await expect(
      useProjectStore
        .getState()
        .createProject("/tmp/no-profile", "No Profile", { dataSource: "dicom" }),
    ).rejects.toThrow(/valid execution profile/i);
    expect(useProjectStore.getState().project).toBeNull();
  });

  it("throws when loading a project without a valid execution profile", async () => {
    useGlobalStore.setState({
      settings: DEFAULT_SETTINGS,
      profileValidationState: {},
    });

    await expect(
      useProjectStore.getState().loadProject("/tmp/loaded/project.easl"),
    ).rejects.toThrow(/valid execution profile/i);
    expect(useProjectStore.getState().project).toBeNull();
  });

  it("requests native defaults in reviewed creation preflight", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "preflight_bids_project_mutations") {
        const { rootPath, mode } = args as { rootPath: string; mode: "bids" | "dicom" };
        return {
          planId: "opaque-plan",
          rootPath,
          mode,
          operations: [],
          warnings: [],
          conflicts: [],
          projectSummary: null,
          preservesReadme: true,
          temporaryArtifacts: [],
        };
      }
      return null;
    });
    await useProjectStore.getState().preflightProjectSetup("/dataset", "Dataset", "bids");

    expect(invoke).toHaveBeenCalledWith(
      "preflight_bids_project_mutations",
      expect.objectContaining({
        rootPath: "/dataset",
        mode: "bids",
        name: "Dataset",
        profileId: useGlobalStore.getState().settings.executionProfiles[0]!.id,
      }),
    );
  });

  it("hydrates only committed BIDS bytes and never separately writes the project or bidsignore", async () => {
    const committed = projectFixture("committed-id", "Committed", "/canonical", {
      mappingState: { sourceDataPath: "." },
    });
    committed.document.projectMeta.dataSource = "bids";
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "commit_bids_project_mutations") {
        return {
          outcome: "committed",
          projectPath: "/canonical/project.easl",
          projectDocument: committed.document,
          candidateId: "committed-candidate",
          directorySyncSupported: true,
        };
      }
      if (command === "activate_project") return committed;
      if (command === "get_active_import_run" || command === "get_active_run") return null;
      if (command === "read_import_status") return [];
      throw new Error(`Unexpected command ${command}`);
    });

    await useProjectStore.getState().createProject("/caller-path", "Ignored draft", {
      dataSource: "bids",
      planId: "opaque-plan",
    });

    expect(invoke).toHaveBeenCalledWith("commit_bids_project_mutations", { planId: "opaque-plan" });
    expect(invoke).toHaveBeenCalledWith("activate_project", {
      candidateId: "committed-candidate",
      confirmBackup: false,
    });
    expect(useProjectStore.getState().project).toMatchObject({
      projectMeta: { id: "committed-id", name: "Committed", rootPath: "/canonical" },
    });
  });

  it("preserves the active project when BIDS commit fails before activation", async () => {
    const prior = projectView(projectFixture("prior", "Prior", "/prior"));
    useProjectStore.setState({ project: prior, loaded: true, isDirty: false });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("stale plan"));

    await expect(
      useProjectStore
        .getState()
        .createProject("/dataset", "Dataset", { dataSource: "bids", planId: "stale" }),
    ).rejects.toThrow("stale plan");
    expect(useProjectStore.getState().project).toBe(prior);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("commit_bids_project_mutations", {
      planId: "stale",
    });
  });

  it("missing options.dataSource throws and no project is created", async () => {
    await expect(
      useProjectStore.getState().createProject("/tmp/no-ds", "No DS", {} as any),
    ).rejects.toThrow(/dataSource/);
    expect(useProjectStore.getState().project).toBeNull();
  });

  describe("current source availability on opening", () => {
    it.each([
      ["/external", true, true, "/external", "available"],
      ["./source", false, false, "/project/source", "missing"],
      ["/restricted", true, false, "/restricted", "unreadable"],
    ] as const)(
      "opens %s without changing accepted mappings",
      async (source, exists, readable, absolutePath, status) => {
        const mapping = {
          sourceDataPath: source,
          rawPaths: ["sub-01/scan"],
          tokenizerConfigs: { saved: [] },
        };
        const opened = projectFixture("project-1", "Demo Project", "/project", {
          mappingState: mapping,
        });
        vi.mocked(invoke).mockImplementation(async (command) => {
          if (command === "inspect_project") return { ...inspection, rootPath: "/project" };
          if (command === "activate_project") return opened;
          if (command === "inspect_source_path")
            return {
              absolutePath,
              exists,
              readable,
              isDirectory: exists,
              ownership: exists ? "external" : "missing",
              projectRelativePath: null,
            };
          if (command === "get_active_import_run" || command === "get_active_run") return null;
          if (command === "read_import_status") return [];
          throw new Error(`Unexpected command ${command}`);
        });
        await useProjectStore.getState().loadProject("/project/project.easl");
        expect(useProjectStore.getState().project?.mappingState).toEqual(mapping);
        expect(useProjectStore.getState().isDirty).toBe(false);
        expect(useImportStore.getState().sourceAvailability).toMatchObject({
          status,
          savedPath: source,
          ...(readable ? { message: null } : {}),
        });
        expect(invoke).not.toHaveBeenCalledWith("save_project", expect.anything());
      },
    );
    it("opens with saved visualization settings without eager mirror hydration", async () => {
      const dataVis = {
        qcbfSource: { relativePath: "Population/Stats/qcbf.tsv", fileHash: "qcbf" },
        joinConfig: {
          externalSource: {
            absolutePath: "/media/missing/clinical.csv",
            fileHash: "external",
            sheetName: null,
          },
          keys: [{ left: "participant_id", right: "SubjectID" }],
          dropRightOn: true,
          naTokens: [""],
          delimiter: ",",
        },
        columnTypes: { Diagnosis: "nominal" },
        levelOrderings: { Diagnosis: ["Control", "Patient"] },
        axisAssignment: { x: "Diagnosis", y: "qCBF", colorBy: null },
        domainFilters: { xMin: null, xMax: null, yMin: 10, yMax: 90 },
        stage: "visualize",
      };
      const opened = projectFixture("project-1", "Demo Project", "/project", {
        uiState: { dataVis },
      });
      vi.mocked(invoke)
        .mockResolvedValueOnce({ ...inspection, rootPath: "/project" })
        .mockResolvedValueOnce(opened);
      await useProjectStore.getState().loadProject("/project/project.easl");

      expect(useProjectStore.getState().project?.uiState.dataVis).toMatchObject(dataVis);
      expect(useProjectStore.getState().isDirty).toBe(false);
    });
  });

  describe("backup recovery", () => {
    it("preserves any prior project while waiting for recovery confirmation or decline", async () => {
      const prior = projectView(native);
      useProjectStore.setState({ project: prior, loaded: true });
      vi.mocked(invoke).mockRejectedValueOnce({ message: "Native inspection failed" });
      await expect(
        useProjectStore.getState().loadProject("/tmp/recovery/project.easl"),
      ).rejects.toThrow("Native inspection failed");
      expect(useProjectStore.getState().project).toBe(prior);
      expect(invoke).toHaveBeenCalledExactlyOnceWith("inspect_project", {
        path: "/tmp/recovery/project.easl",
        recents: [],
      });
      vi.mocked(invoke).mockResolvedValueOnce({
        ...inspection,
        rootPath: "/tmp/recovery",
        recoveredFromBackup: true,
      });

      await useProjectStore.getState().loadProject("/tmp/recovery/project.easl");
      expect(useProjectStore.getState()).toMatchObject({
        project: prior,
        isDirty: false,
        loaded: true,
        recovery: { easlPath: "/tmp/recovery/project.easl" },
      });

      useProjectStore.getState().declineRecovery();
      expect(useProjectStore.getState()).toMatchObject({
        project: prior,
        isDirty: false,
        loaded: true,
        recovery: null,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // confirmBidsReview
  // ---------------------------------------------------------------------------
});
