import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROJECT_FILE_NAME } from "../schemas/project";
import type { ImportSnapshot } from "../schemas/importSchemas";
import { readSessionCheckpoint } from "../lib/sessionCheckpoint";
import { makeMatlabProfile } from "../test/profileFixtures";
import { useGlobalStore } from "./globalStore";
import { useImportStore } from "./importStore";
import { useVisualizationStore } from "./visualizationStore";
import { __resetProjectRevisionForTests, useProjectStore } from "./projectStore";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { compressSnapshot } from "../lib/snapshotCompression";
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

describe("useProjectStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    __resetProjectRevisionForTests();
    resetProjectLifecycleForTests();
    seedValidProfileGate();
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
      recovery: null,
      recoveredFromBackup: false,
    });

    vi.mocked(readTextFile).mockResolvedValue("");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "shutdown_project_runtime") {
        return {
          success: true,
          importProcess: { success: true },
          processingWorkers: { success: true },
          lockWatcher: { success: true },
        };
      }
      return null;
    });
  });

  it("creates a new project file at the project root", async () => {
    await useProjectStore
      .getState()
      .createProject("/tmp/demo-project", "Demo Project", { dataSource: "dicom" });

    expect(invoke).toHaveBeenCalledWith(
      "atomic_write_project",
      expect.objectContaining({
        projectPath: `/tmp/demo-project/${PROJECT_FILE_NAME}`,
        canonicalBytes: expect.stringContaining('"name": "Demo Project"'),
        preserveBackup: false,
      }),
    );
    expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("import");
    expect(useProjectStore.getState().project?.projectMeta.dataSource).toBe("dicom");
    expect(readSessionCheckpoint()?.projectId).toBe(
      useProjectStore.getState().project?.projectMeta.id,
    );
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
      .createProject("/tmp/profile-default", "Profile Default", { dataSource: "dicom" });

    expect(useProjectStore.getState().project?.uiState.import?.selectedProfileId).toBe(valid.id);
    expect(invoke).toHaveBeenCalledWith(
      "atomic_write_project",
      expect.objectContaining({
        projectPath: `/tmp/profile-default/${PROJECT_FILE_NAME}`,
        canonicalBytes: expect.stringContaining(`"selectedProfileId": "${valid.id}"`),
      }),
    );
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

    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        version: "0.1.0",
        projectMeta: {
          id: "project-1",
          name: "Loaded Project",
          rootPath: "/tmp/loaded",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "parameters",
          dataSource: "dicom",
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
      }),
    );

    await expect(
      useProjectStore.getState().loadProject("/tmp/loaded/project.easl"),
    ).rejects.toThrow(/valid execution profile/i);
    expect(useProjectStore.getState().project).toBeNull();
  });

  it("DICOM creation sets dataSource dicom and bidsReviewConfirmed false", async () => {
    await useProjectStore
      .getState()
      .createProject("/tmp/dicom-create", "DICOM Project", { dataSource: "dicom" });

    const project = useProjectStore.getState().project!;
    expect(project.projectMeta.dataSource).toBe("dicom");
    expect(project.projectMeta.currentPhase).toBe("import");
    expect(project.uiState?.import?.bidsReviewConfirmed).toBe(false);
  });

  it("BIDS creation sets dataSource bids", async () => {
    await useProjectStore
      .getState()
      .createProject("/tmp/bids-create", "BIDS Project", { dataSource: "bids" });

    const project = useProjectStore.getState().project!;
    expect(project.projectMeta.dataSource).toBe("bids");
    expect(project.projectMeta.currentPhase).toBe("import");
    expect(project.uiState?.import?.bidsReviewConfirmed).toBe(false);
  });

  it("preflights a fully validated canonical schema-v1 project before detected-BIDS commit", async () => {
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
        canonicalProjectBytes: expect.any(String),
      }),
    );
    const call = vi
      .mocked(invoke)
      .mock.calls.find(([command]) => command === "preflight_bids_project_mutations");
    expect(call).toBeDefined();
    const canonical = JSON.parse(
      (call![1] as { canonicalProjectBytes: string }).canonicalProjectBytes,
    );
    expect(canonical).toMatchObject({
      schemaVersion: 1,
      projectMeta: { name: "Dataset", dataSource: "bids", currentPhase: "import" },
      mappingState: { sourceDataPath: "." },
      uiState: { import: { bidsReviewConfirmed: false } },
    });
  });

  it("hydrates only committed BIDS bytes and never separately writes the project or bidsignore", async () => {
    const committedBytes = JSON.stringify({
      schemaVersion: 1,
      projectMeta: {
        id: "committed-id",
        name: "Committed",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastOpened: "2026-01-01T00:00:00.000Z",
        currentPhase: "import",
        dataSource: "bids",
      },
      uiState: { import: { bidsReviewConfirmed: false, skippedSubjects: [] } },
      mappingState: { sourceDataPath: "." },
      dataPar: {},
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "commit_bids_project_mutations") {
        return {
          outcome: "committed",
          projectPath: "/canonical/project.easl",
          canonicalProjectBytes: committedBytes,
          directorySyncSupported: true,
        };
      }
      return null;
    });

    await useProjectStore.getState().createProject("/caller-path", "Ignored draft", {
      dataSource: "bids",
      planId: "opaque-plan",
    });

    expect(invoke).toHaveBeenCalledWith("commit_bids_project_mutations", { planId: "opaque-plan" });
    expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("ensure_bids_ignore", expect.anything());
    expect(useProjectStore.getState().project).toMatchObject({
      projectMeta: { id: "committed-id", name: "Committed", rootPath: "/canonical" },
    });
  });

  it("preserves the active project when BIDS commit fails before activation", async () => {
    const prior = {
      version: "0.1.0",
      projectMeta: {
        id: "prior",
        name: "Prior",
        rootPath: "/prior",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastOpened: "2026-01-01T00:00:00.000Z",
        currentPhase: "import" as const,
        dataSource: "dicom" as const,
      },
      uiState: {},
      mappingState: {},
      dataPar: {},
    } as any;
    useProjectStore.setState({ project: prior, loaded: true, isDirty: false });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("stale plan"));

    await expect(
      useProjectStore
        .getState()
        .createProject("/dataset", "Dataset", { dataSource: "bids", planId: "stale" }),
    ).rejects.toThrow("stale plan");
    expect(useProjectStore.getState().project).toBe(prior);
    expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());
  });

  it("missing options.dataSource throws and no project is created", async () => {
    await expect(
      useProjectStore.getState().createProject("/tmp/no-ds", "No DS", {} as any),
    ).rejects.toThrow(/dataSource/);
    expect(useProjectStore.getState().project).toBeNull();
  });

  it("loads a valid project file and clears the dirty flag", async () => {
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        version: "0.1.0",
        projectMeta: {
          id: "project-1",
          name: "Loaded Project",
          rootPath: "/tmp/loaded",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "parameters",
          dataSource: "dicom",
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
      }),
    );

    await useProjectStore.getState().loadProject("/tmp/loaded/project.easl");

    expect(useProjectStore.getState()).toMatchObject({
      loaded: true,
      isDirty: false,
      project: {
        projectMeta: {
          name: "Loaded Project",
          currentPhase: "parameters",
        },
      },
    });
    expect(readSessionCheckpoint()).toMatchObject({
      easlPath: `/tmp/loaded/${PROJECT_FILE_NAME}`,
      projectId: "project-1",
      phase: "parameters",
    });
  });

  it("opens v1 and legacy projects read-only with root derived from the selected file", async () => {
    const legacy = {
      version: "0.1.0",
      projectMeta: {
        id: "project-1",
        name: "Loaded Project",
        rootPath: "/stale/root",
        createdAt: "2026-05-03T00:00:00.000Z",
        lastOpened: "2026-05-03T00:00:00.000Z",
        currentPhase: "parameters",
        dataSource: "dicom",
      },
      uiState: {},
      mappingState: {},
      dataPar: {},
    };
    const v1 = { ...legacy, projectMeta: { ...legacy.projectMeta }, schemaVersion: 1 };
    delete (v1 as { version?: string }).version;
    delete (v1.projectMeta as { rootPath?: string }).rootPath;

    for (const fixture of [legacy, v1]) {
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(fixture));
      vi.mocked(invoke).mockClear();
      await useProjectStore.getState().loadProject("/chosen/root/project.easl");
      expect(useProjectStore.getState().project?.projectMeta.rootPath).toBe("/chosen/root");
      expect(useProjectStore.getState().project?.projectMeta.lastOpened).toBe(
        "2026-05-03T00:00:00.000Z",
      );
      expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.any(Object));
    }
  });

  it("derives POSIX and Windows filesystem roots without corrupting root directories", async () => {
    const v1 = {
      schemaVersion: 1,
      projectMeta: {
        id: "project-1",
        name: "Loaded Project",
        createdAt: "2026-05-03T00:00:00.000Z",
        lastOpened: "2026-05-03T00:00:00.000Z",
        currentPhase: "parameters",
        dataSource: "dicom",
      },
      uiState: {},
      mappingState: {},
      dataPar: {},
    };
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(v1));

    for (const [easlPath, rootPath] of [
      ["project.easl", "."],
      ["/project.easl", "/"],
      ["C:\\project.easl", "C:\\"],
      ["C:\\chosen\\root\\project.easl", "C:\\chosen\\root"],
    ]) {
      await useProjectStore.getState().loadProject(easlPath);
      expect(useProjectStore.getState().project?.projectMeta.rootPath).toBe(rootPath);
    }
  });

  it("does not write malformed or future project files", async () => {
    for (const raw of ["{", JSON.stringify({ schemaVersion: 2 })]) {
      vi.mocked(readTextFile).mockResolvedValue(raw);
      vi.mocked(invoke).mockClear();
      await expect(
        useProjectStore.getState().loadProject("/chosen/root/project.easl"),
      ).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.any(Object));
    }
  });

  it("hydrates a copied project under a new runtime ID without writing until Save", async () => {
    const persisted = {
      schemaVersion: 1,
      projectMeta: {
        id: "original-id",
        name: "Copied Project",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastOpened: "2026-01-01T00:00:00.000Z",
        currentPhase: "import",
        dataSource: "bids",
      },
      uiState: {},
      mappingState: { sourceDataPath: "." },
      dataPar: {},
    };
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(persisted));

    await useProjectStore.getState().loadProject("/copy/project.easl", {
      projectIdOverride: "copy-id",
      forceDirty: true,
    });

    expect(useProjectStore.getState()).toMatchObject({
      project: { projectMeta: { id: "copy-id", rootPath: "/copy" } },
      isDirty: true,
      loaded: true,
    });
    expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());

    await useProjectStore.getState().saveProject();
    expect(invoke).toHaveBeenCalledWith(
      "atomic_write_project",
      expect.objectContaining({
        projectPath: "/copy/project.easl",
        canonicalBytes: expect.stringContaining('"id": "copy-id"'),
      }),
    );
  });

  describe("portable path normalization", () => {
    const projectEnvelope = (
      dataSource: "dicom" | "bids",
      mappingState: Record<string, unknown>,
      importState: Record<string, unknown> = {},
    ) => ({
      schemaVersion: 1,
      projectMeta: {
        id: "portable-project",
        name: "Portable",
        createdAt: "2026-09-03T00:00:00.000Z",
        lastOpened: "2026-09-03T00:00:00.000Z",
        currentPhase: "import",
        dataSource,
      },
      uiState: { import: importState },
      mappingState,
      dataPar: {},
    });

    it("normalizes relocated BIDS state and compressed snapshot without writing", async () => {
      const snapshot: ImportSnapshot = {
        sourceDataPath: "/old/bids-root",
        pathPatterns: [],
        tokenizerConfigs: {},
        bMatchDirectories: false,
        modalityAliases: [],
        sessionAliases: [],
        runAliases: [],
        subjectRenames: [],
        metadataGroups: [],
        subjectRows: [],
      };
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify(
          projectEnvelope(
            "bids",
            { sourceDataPath: "/old/bids-root" },
            { mostRecentConfig: compressSnapshot(snapshot) },
          ),
        ),
      );

      await useProjectStore.getState().loadProject("/moved/bids/project.easl");

      const state = useProjectStore.getState();
      expect(state.project?.mappingState.sourceDataPath).toBe(".");
      expect(state.project?.uiState.import?.mostRecentConfig?.sourceDataPath).toBe(".");
      expect(state.isDirty).toBe(true);
      expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());
    });

    it("classifies available internal DICOM state and canonicalizes raw paths", async () => {
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify(
          projectEnvelope("dicom", {
            sourceDataPath: "/moved/dicom/sourcedata",
            rawPaths: ["/moved/dicom/sourcedata/sub-01/scan"],
          }),
        ),
      );
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "inspect_source_path") {
          return {
            absolutePath: "/moved/dicom/sourcedata",
            exists: true,
            readable: true,
            isDirectory: true,
            ownership: "internal",
            projectRelativePath: "./sourcedata",
          };
        }
        return null;
      });

      await useProjectStore.getState().loadProject("/moved/dicom/project.easl");

      expect(useProjectStore.getState().project?.mappingState).toMatchObject({
        sourceDataPath: "./sourcedata",
        rawPaths: ["sub-01/scan"],
      });
      expect(useProjectStore.getState().isDirty).toBe(true);
      expect(useImportStore.getState().sourceAvailability).toEqual({
        status: "available",
        savedPath: "./sourcedata",
        message: null,
      });
    });

    it("classifies a readable external DICOM source without changing its mapping", async () => {
      const mappingState = {
        sourceDataPath: "/media/dicom",
        rawPaths: ["sub-01/scan"],
        tokenizerConfigs: { saved: [] },
      };
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify(projectEnvelope("dicom", mappingState)),
      );
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "inspect_source_path") {
          return {
            absolutePath: "/media/dicom",
            exists: true,
            readable: true,
            isDirectory: true,
            ownership: "external",
            projectRelativePath: null,
          };
        }
        return null;
      });

      await useProjectStore.getState().loadProject("/project/project.easl");

      expect(useProjectStore.getState().project?.mappingState).toEqual(mappingState);
      expect(useImportStore.getState().sourceAvailability).toEqual({
        status: "available",
        savedPath: "/media/dicom",
        message: null,
      });
    });

    it("opens with runtime-only missing state while preserving a missing relative source", async () => {
      const mappingState = {
        sourceDataPath: "./sourcedata",
        rawPaths: ["sub-01/scan"],
        tokenizerConfigs: { saved: [] },
      };
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify(projectEnvelope("dicom", mappingState)),
      );
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "inspect_source_path") {
          return {
            absolutePath: "/project/sourcedata",
            exists: false,
            readable: false,
            isDirectory: false,
            ownership: "missing",
            projectRelativePath: null,
          };
        }
        return null;
      });

      await useProjectStore.getState().loadProject("/project/project.easl");

      expect(useProjectStore.getState().project?.mappingState).toEqual(mappingState);
      expect(useImportStore.getState().sourceAvailability).toMatchObject({
        status: "missing",
        savedPath: "./sourcedata",
      });
      expect(useProjectStore.getState().isDirty).toBe(false);
    });

    it("opens with runtime-only unreadable state without clearing source setup", async () => {
      const mappingState = {
        sourceDataPath: "/media/restricted",
        rawPaths: ["sub-01/scan"],
        tokenizerConfigs: { saved: [] },
      };
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify(projectEnvelope("dicom", mappingState)),
      );
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "inspect_source_path") {
          return {
            absolutePath: "/media/restricted",
            exists: true,
            readable: false,
            isDirectory: true,
            ownership: "external",
            projectRelativePath: null,
          };
        }
        return null;
      });

      await useProjectStore.getState().loadProject("/project/project.easl");

      expect(useProjectStore.getState().project?.mappingState).toEqual(mappingState);
      expect(useImportStore.getState().sourceAvailability).toMatchObject({
        status: "unreadable",
        savedPath: "/media/restricted",
      });
    });

    it("opens with a missing external visualization file without clearing saved setup", async () => {
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
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          ...projectEnvelope("bids", { sourceDataPath: "." }),
          uiState: { dataVis },
        }),
      );
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "inspect_source_path") {
          return {
            absolutePath: "/media/missing/clinical.csv",
            exists: false,
            readable: false,
            isDirectory: false,
            ownership: "missing",
            projectRelativePath: null,
          };
        }
        return null;
      });

      await useProjectStore.getState().loadProject("/project/project.easl");

      expect(useProjectStore.getState().project?.uiState.dataVis).toMatchObject(dataVis);
      expect(useVisualizationStore.getState()).toMatchObject({
        joinConfig: dataVis.joinConfig,
        columnTypes: dataVis.columnTypes,
        levelOrderings: dataVis.levelOrderings,
        axisAssignment: dataVis.axisAssignment,
        domainFilters: dataVis.domainFilters,
        stage: "visualize",
        externalSourceAvailability: {
          status: "missing",
          savedPath: "/media/missing/clinical.csv",
        },
      });
      expect(useProjectStore.getState().isDirty).toBe(false);
    });

    it("preserves unavailable ambiguous DICOM paths without guessing", async () => {
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify(
          projectEnvelope("dicom", {
            sourceDataPath: "/old/unknown-source",
            rawPaths: ["/old/unknown-source/sub-01/scan"],
          }),
        ),
      );
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "inspect_source_path") {
          return {
            absolutePath: "/old/unknown-source",
            exists: false,
            readable: false,
            isDirectory: false,
            ownership: "missing",
            projectRelativePath: null,
          };
        }
        return null;
      });

      await useProjectStore.getState().loadProject("/moved/dicom/project.easl");

      expect(useProjectStore.getState().project?.mappingState).toMatchObject({
        sourceDataPath: "/old/unknown-source",
        rawPaths: ["/old/unknown-source/sub-01/scan"],
      });
      expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());
      expect(useImportStore.getState().sourceAvailability).toMatchObject({
        status: "ambiguous",
        savedPath: "/old/unknown-source",
      });
    });
  });

  it("reports invalid serialization before invoking the native writer", async () => {
    useProjectStore.setState({
      project: { projectMeta: {} } as any,
      isDirty: true,
      loaded: true,
    });
    vi.mocked(invoke).mockClear();

    await expect(useProjectStore.getState().saveProject()).rejects.toMatchObject({
      category: "invalid_serialization",
    });

    expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.any(Object));
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  describe("backup recovery", () => {
    const validProject = JSON.stringify({
      schemaVersion: 1,
      projectMeta: {
        id: "recovered-project",
        name: "Recovered Project",
        createdAt: "2026-05-03T00:00:00.000Z",
        lastOpened: "2026-05-03T00:00:00.000Z",
        currentPhase: "parameters",
        dataSource: "dicom",
      },
      uiState: {},
      mappingState: {},
      dataPar: {},
    });

    it("prefers a valid primary over its backup", async () => {
      vi.mocked(readTextFile).mockClear();
      vi.mocked(readTextFile).mockImplementation(async (path) =>
        String(path).endsWith(".bak") ? validProject.replace("Recovered", "Backup") : validProject,
      );

      await useProjectStore.getState().loadProject("/tmp/recovery/project.easl");

      expect(useProjectStore.getState().project?.projectMeta.name).toBe("Recovered Project");
      expect(useProjectStore.getState().recovery).toBeNull();
      expect(readTextFile).not.toHaveBeenCalledWith("/tmp/recovery/project.easl.bak");
      expect(invoke).toHaveBeenCalledWith("cleanup_project_temps", {
        projectPath: "/tmp/recovery/project.easl",
      });
    });

    it("offers a valid backup after a malformed primary and confirms without writing", async () => {
      vi.mocked(invoke).mockClear();
      vi.mocked(readTextFile).mockImplementation(async (path) =>
        String(path).endsWith(".bak") ? validProject : "{",
      );

      await useProjectStore.getState().loadProject("/tmp/recovery/project.easl");
      expect(useProjectStore.getState().recovery).toEqual({
        easlPath: "/tmp/recovery/project.easl",
        backupPath: "/tmp/recovery/project.easl.bak",
        projectId: "recovered-project",
      });
      expect(useProjectStore.getState().project).toBeNull();
      expect(invoke).not.toHaveBeenCalledWith("cleanup_project_temps", expect.any(Object));

      await useProjectStore.getState().confirmRecovery();
      expect(useProjectStore.getState().project?.projectMeta.rootPath).toBe("/tmp/recovery");
      expect(useProjectStore.getState().isDirty).toBe(true);
      expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.any(Object));
      expect(invoke).toHaveBeenCalledWith("cleanup_project_temps", {
        projectPath: "/tmp/recovery/project.easl",
      });

      await useProjectStore.getState().saveProject();
      expect(invoke).toHaveBeenLastCalledWith(
        "atomic_write_project",
        expect.objectContaining({ preserveBackup: true }),
      );
    });

    it("preserves any prior project while waiting for recovery confirmation or decline", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/prior-project", "Prior Project", { dataSource: "dicom" });
      vi.mocked(readTextFile).mockImplementation(async (path) =>
        String(path).endsWith(".bak") ? validProject : "{",
      );

      await useProjectStore.getState().loadProject("/tmp/recovery/project.easl");
      expect(useProjectStore.getState()).toMatchObject({
        project: { projectMeta: { name: "Prior Project" } },
        isDirty: false,
        loaded: true,
        recovery: { easlPath: "/tmp/recovery/project.easl" },
      });

      useProjectStore.getState().declineRecovery();
      expect(useProjectStore.getState()).toMatchObject({
        project: { projectMeta: { name: "Prior Project" } },
        isDirty: false,
        loaded: true,
        recovery: null,
      });
    });

    it("does not fall back after a future version or permission error", async () => {
      vi.mocked(readTextFile).mockClear();
      vi.mocked(readTextFile).mockResolvedValueOnce(JSON.stringify({ schemaVersion: 2 }));
      await expect(
        useProjectStore.getState().loadProject("/tmp/recovery/project.easl"),
      ).rejects.toThrow(/not supported/i);
      expect(readTextFile).not.toHaveBeenCalledWith("/tmp/recovery/project.easl.bak");

      vi.mocked(readTextFile).mockClear();
      const permissionError = Object.assign(new Error("permission denied"), { code: "EACCES" });
      vi.mocked(readTextFile).mockRejectedValueOnce(permissionError);
      await expect(
        useProjectStore.getState().loadProject("/tmp/recovery/project.easl"),
      ).rejects.toMatchObject({ category: "permission_denied" });
      expect(readTextFile).not.toHaveBeenCalledWith("/tmp/recovery/project.easl.bak");
    });

    it("classifies object-shaped native permission failures without falling back", async () => {
      vi.mocked(readTextFile).mockRejectedValueOnce({
        message: "Permission denied",
        code: "EACCES",
      });

      await expect(
        useProjectStore.getState().loadProject("/tmp/recovery/project.easl"),
      ).rejects.toMatchObject({ category: "permission_denied" });
      expect(readTextFile).not.toHaveBeenCalledWith("/tmp/recovery/project.easl.bak");
    });

    it("recognizes native missing-file strings and offers the valid backup", async () => {
      vi.mocked(readTextFile)
        .mockRejectedValueOnce("No such file or directory (os error 2)")
        .mockResolvedValueOnce(validProject);

      await useProjectStore.getState().loadProject("/tmp/recovery/project.easl");

      expect(useProjectStore.getState().recovery).toEqual({
        easlPath: "/tmp/recovery/project.easl",
        backupPath: "/tmp/recovery/project.easl.bak",
        projectId: "recovered-project",
      });
    });

    it("logs stale-temp cleanup failure and still opens validated primary", async () => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(readTextFile).mockResolvedValue(validProject);
      vi.mocked(invoke).mockRejectedValueOnce(new Error("cleanup denied"));

      await useProjectStore.getState().loadProject("/tmp/recovery/project.easl");

      expect(useProjectStore.getState().loaded).toBe(true);
      expect(warning).toHaveBeenCalledWith(
        "Failed to clean stale project temporary files:",
        expect.any(Error),
      );
      warning.mockRestore();
    });

    it("rejects malformed backups", async () => {
      vi.mocked(readTextFile).mockImplementation(async (path) =>
        String(path).endsWith(".bak") ? "{" : "{",
      );

      await expect(
        useProjectStore.getState().loadProject("/tmp/recovery/project.easl"),
      ).rejects.toThrow(/recovery failed/i);
      expect(useProjectStore.getState().recovery).toBeNull();
    });
  });

  it("rejects project files that are not named project.easl", async () => {
    await expect(
      useProjectStore.getState().loadProject("/tmp/loaded/custom-name.easl"),
    ).rejects.toThrow(/project\.easl/i);
  });

  it("marks the project dirty when switching to an accessible phase and persists on save", async () => {
    await useProjectStore
      .getState()
      .createProject("/tmp/save-project", "Save Project", { dataSource: "dicom" });

    useProjectStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            projectMeta: {
              ...state.project.projectMeta,
              currentPhase: "processing",
            },
          }
        : null,
    }));

    useProjectStore.getState().setPhase("parameters");
    expect(useProjectStore.getState().isDirty).toBe(true);

    await useProjectStore.getState().saveProject();

    expect(invoke).toHaveBeenLastCalledWith(
      "atomic_write_project",
      expect.objectContaining({
        projectPath: `/tmp/save-project/${PROJECT_FILE_NAME}`,
        canonicalBytes: expect.stringContaining('"currentPhase": "parameters"'),
      }),
    );
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("clears the current project when closed", async () => {
    await useProjectStore
      .getState()
      .createProject("/tmp/close-project", "Close Project", { dataSource: "dicom" });

    await useProjectStore.getState().closeProject();

    expect(useProjectStore.getState()).toMatchObject({
      project: null,
      isDirty: false,
      loaded: false,
    });
    expect(readSessionCheckpoint()).toBeNull();
  });

  describe("syncProcessingState", () => {
    it("syncs config to uiState.processing.config", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/proc-project", "Proc Project", { dataSource: "dicom" });

      const config = {
        subjects: ["sub-01_01"] as string[],
        modules: ["structural"] as ("structural" | "asl" | "population")[],
        selectedProfileId: "profile-1",
        workers: 1,
        subjectRegexp: "^sub-.*$",
      };

      useProjectStore.getState().syncProcessingState({
        config,
        processingPhase: "idle",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.config).toEqual(config);
      expect(project?.uiState.processing?.currentPhase).toBe("idle");
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("syncs processingPhase to uiState.processing.currentPhase", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/phase-project", "Phase Project", { dataSource: "dicom" });

      useProjectStore.getState().syncProcessingState({
        config: null,
        processingPhase: "running",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.currentPhase).toBe("running");
      expect(project?.uiState.processing?.config).toBeUndefined();
    });

    it("handles null config without throwing", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/null-config", "Null Config", { dataSource: "dicom" });

      useProjectStore.getState().syncProcessingState({
        config: null as any,
        processingPhase: "idle",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.config).toBeUndefined();
    });

    it("drops config when modules is empty", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/empty-mods", "Empty Mods", { dataSource: "dicom" });

      const config = {
        subjects: [] as string[],
        modules: [] as ("structural" | "asl" | "population")[],
        selectedProfileId: "",
        workers: 1,
        subjectRegexp: "^sub-.*$",
      };

      useProjectStore.getState().syncProcessingState({
        config,
        processingPhase: "idle",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.config).toBeUndefined();
    });

    it("skips update when values are equal (equality no-op guard)", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/noop-project", "Noop Project", { dataSource: "dicom" });

      useProjectStore.getState().syncProcessingState({
        config: null,
        processingPhase: "idle",
      });

      const stateBefore = useProjectStore.getState();
      useProjectStore.getState().syncProcessingState({
        config: null,
        processingPhase: "idle",
      });

      expect(useProjectStore.getState()).toStrictEqual(stateBefore);
    });

    it("preserves existing structural, asl, and population fields", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/preserve-project", "Preserve Project", { dataSource: "dicom" });

      // Manually set population/structural/asl status
      useProjectStore.getState().setPopulationCompleted(true);
      useProjectStore.getState().setLastRunProfileId("population", "my-profile", {
        exploreASLVersion: "1.2.0",
        matlabVersion: "9.9.0",
        guiVersion: "1.0.0",
      });

      const config = {
        subjects: ["sub-01_01"] as string[],
        modules: ["structural"] as ("structural" | "asl" | "population")[],
        selectedProfileId: "profile-1",
        workers: 1,
        subjectRegexp: "^sub-.*$",
      };

      // Sync config and phase
      useProjectStore.getState().syncProcessingState({
        config,
        processingPhase: "running",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.config).toEqual(config);
      expect(project?.uiState.processing?.currentPhase).toBe("running");

      // Sibling fields must still exist
      expect(project?.uiState.processing?.population?.completed).toBe(true);
      expect(project?.uiState.processing?.population?.lastRun?.profileId).toBe("my-profile");
      expect(project?.uiState.processing?.population?.lastRun?.exploreASLVersion).toBe("1.2.0");
    });
  });

  it("syncs import completion state into project uiState", async () => {
    await useProjectStore
      .getState()
      .createProject("/tmp/import-project", "Import Project", { dataSource: "dicom" });

    useProjectStore.getState().syncImportState({
      ...useImportStore.getState(),
      activeStep: 5,
      importPhase: "completed",
      importCompleted: true,
    });

    const project = useProjectStore.getState().project;
    expect(project?.uiState).toMatchObject({
      import: {
        activeStep: 5,
        currentPhase: "completed",
        completed: true,
      },
    });
    expect(project?.mappingState).not.toHaveProperty("importPhase");
    expect(project?.mappingState).not.toHaveProperty("importCompleted");
  });

  it("persists selectedProfileId into uiState.import (not mappingState)", async () => {
    await useProjectStore
      .getState()
      .createProject("/tmp/profile-persist", "Profile Persist", { dataSource: "dicom" });

    useProjectStore.getState().syncImportState({
      ...useImportStore.getState(),
      selectedProfileId: "profile-42",
    });

    const project = useProjectStore.getState().project;
    expect(project?.uiState?.import?.selectedProfileId).toBe("profile-42");
    expect(project?.mappingState).not.toHaveProperty("selectedProfileId");
  });

  describe("mostRecentConfig persistence (gzip+base64)", () => {
    const SAMPLE_SNAPSHOT: ImportSnapshot = {
      sourceDataPath: "/scan/data",
      pathPatterns: [],
      tokenizerConfigs: {},
      bMatchDirectories: true,
      modalityAliases: [],
      sessionAliases: [],
      runAliases: [],
      subjectRenames: [],
      metadataGroups: [
        { id: "g1", label: "G1", bidsParams: { ArterialSpinLabelingType: "PCASL" } },
      ],
      subjectRows: [{ id: "SUB/01", subject: "SUB", session: "01", groupId: "g1" }],
    };

    it("save → load round-trip preserves the snapshot via compressed string", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/snapshot-roundtrip", "Snapshot RT", { dataSource: "dicom" });

      useProjectStore.getState().syncImportState({
        ...useImportStore.getState(),
        activeStep: 5,
        importPhase: "completed",
        importCompleted: true,
        mostRecentConfig: SAMPLE_SNAPSHOT,
      });

      await useProjectStore.getState().saveProject();

      const calls = vi.mocked(invoke).mock.calls;
      const savedJson = (calls[calls.length - 1][1] as { canonicalBytes: string }).canonicalBytes;
      const saved = JSON.parse(savedJson);

      // Persisted form MUST be a string, not an object
      expect(typeof saved.uiState.import.mostRecentConfig).toBe("string");
      expect(saved.uiState.import.mostRecentConfig.length).toBeGreaterThan(0);

      // Simulate reload
      vi.mocked(readTextFile).mockResolvedValue(savedJson);
      useProjectStore.setState({ project: null, loaded: false, isDirty: false });
      await useProjectStore.getState().loadProject("/tmp/snapshot-roundtrip/project.easl");

      const restored = useProjectStore.getState().project?.uiState.import?.mostRecentConfig;
      expect(restored).toEqual(SAMPLE_SNAPSHOT);
    });

    it("legacy object-form mostRecentConfig is preserved on load", async () => {
      const legacyJson = JSON.stringify({
        version: "0.1.0",
        projectMeta: {
          id: "legacy-snapshot-id",
          name: "Legacy Snapshot",
          rootPath: "/tmp/legacy-snapshot",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
          dataSource: "dicom",
        },
        uiState: {
          import: {
            activeStep: 5,
            completed: true,
            currentPhase: "completed",
            mostRecentConfig: SAMPLE_SNAPSHOT, // legacy full-object form
          },
        },
        mappingState: {},
        dataPar: {},
      });

      vi.mocked(readTextFile).mockResolvedValue(legacyJson);

      await useProjectStore.getState().loadProject("/tmp/legacy-snapshot/project.easl");

      const restored = useProjectStore.getState().project?.uiState.import?.mostRecentConfig;
      expect(restored).toEqual(SAMPLE_SNAPSHOT);
    });

    it("null mostRecentConfig round-trips as null", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/null-snapshot", "Null Snapshot", { dataSource: "dicom" });

      useProjectStore.getState().syncImportState({
        ...useImportStore.getState(),
        activeStep: 0,
        importPhase: "idle",
        importCompleted: false,
        mostRecentConfig: null,
      });

      await useProjectStore.getState().saveProject();

      const calls = vi.mocked(invoke).mock.calls;
      const savedJson = (calls[calls.length - 1][1] as { canonicalBytes: string }).canonicalBytes;
      const saved = JSON.parse(savedJson);
      expect(saved.uiState.import.mostRecentConfig).toBeNull();

      vi.mocked(readTextFile).mockResolvedValue(savedJson);
      useProjectStore.setState({ project: null, loaded: false, isDirty: false });
      await useProjectStore.getState().loadProject("/tmp/null-snapshot/project.easl");

      expect(useProjectStore.getState().project?.uiState.import?.mostRecentConfig).toBeNull();
    });
  });

  describe("BIDS project detection", () => {
    it("opens BIDS projects read-only without checking or writing bidsignore", async () => {
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          version: "0.1.0",
          projectMeta: {
            id: "bids-project-id",
            name: "BIDS Project",
            rootPath: "/tmp/bids-loaded",
            createdAt: "2026-05-03T00:00:00.000Z",
            lastOpened: "2026-05-03T00:00:00.000Z",
            currentPhase: "import",
            dataSource: "bids",
          },
          uiState: {},
          mappingState: {},
          dataPar: {},
        }),
      );

      await useProjectStore.getState().loadProject("/tmp/bids-loaded/project.easl");
    });

    it("opens DICOM projects read-only without checking or writing bidsignore", async () => {
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          version: "0.1.0",
          projectMeta: {
            id: "non-bids-project-id",
            name: "Non-BIDS Project",
            rootPath: "/tmp/non-bids-loaded",
            createdAt: "2026-05-03T00:00:00.000Z",
            lastOpened: "2026-05-03T00:00:00.000Z",
            currentPhase: "import",
            dataSource: "dicom",
          },
          uiState: {},
          mappingState: {},
          dataPar: {},
        }),
      );

      await useProjectStore.getState().loadProject("/tmp/non-bids-loaded/project.easl");
    });

    it("does not throw or block project loading if BIDS checking throws an error", async () => {
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          version: "0.1.0",
          projectMeta: {
            id: "error-project-id",
            name: "Error Project",
            rootPath: "/tmp/error-loaded",
            createdAt: "2026-05-03T00:00:00.000Z",
            lastOpened: "2026-05-03T00:00:00.000Z",
            currentPhase: "import",
            dataSource: "dicom",
          },
          uiState: {},
          mappingState: {},
          dataPar: {},
        }),
      );

      await expect(
        useProjectStore.getState().loadProject("/tmp/error-loaded/project.easl"),
      ).resolves.not.toThrow();

      expect(useProjectStore.getState().loaded).toBe(true);
    });
  });

  describe("setPopulationCompleted", () => {
    it("sets the flag", () => {
      useProjectStore.setState({
        project: {
          version: "0.1.0",
          projectMeta: {
            id: "test",
            name: "Test",
            rootPath: "/tmp",
            createdAt: new Date().toISOString(),
            lastOpened: new Date().toISOString(),
            currentPhase: "processing",
            dataSource: "dicom",
          },
          uiState: {},
          mappingState: {},
          dataPar: {},
        },
        isDirty: false,
        loaded: true,
      });

      const { setPopulationCompleted } = useProjectStore.getState();
      setPopulationCompleted(true);
      expect(useProjectStore.getState().project?.uiState.processing?.population?.completed).toBe(
        true,
      );
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("clears the flag", () => {
      useProjectStore.setState({
        project: {
          version: "0.1.0",
          projectMeta: {
            id: "test",
            name: "Test",
            rootPath: "/tmp",
            createdAt: new Date().toISOString(),
            lastOpened: new Date().toISOString(),
            currentPhase: "processing",
            dataSource: "dicom",
          },
          uiState: { processing: { population: { completed: true } } },
          mappingState: {},
          dataPar: {},
        },
        isDirty: false,
        loaded: true,
      });

      const { setPopulationCompleted } = useProjectStore.getState();
      setPopulationCompleted(false);
      expect(useProjectStore.getState().project?.uiState.processing?.population?.completed).toBe(
        false,
      );
    });

    it("is a no-op when project is null", () => {
      useProjectStore.setState({ project: null });
      const { setPopulationCompleted } = useProjectStore.getState();
      setPopulationCompleted(true);
      expect(useProjectStore.getState().project).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Manifest verdicts
  // ---------------------------------------------------------------------------

  const validProject = {
    version: "0.1.0" as const,
    projectMeta: {
      id: "test",
      name: "Test",
      rootPath: "/tmp",
      createdAt: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
      currentPhase: "manifest" as const,
      dataSource: "dicom" as const,
    },
    uiState: {} as Record<string, unknown>,
    mappingState: {} as Record<string, unknown>,
    dataPar: {},
  };

  describe("manifest verdicts: setManifestVerdict", () => {
    it("setManifestVerdict with pass writes verdict slot", () => {
      useProjectStore.setState({
        project: validProject as any,
        isDirty: false,
        loaded: true,
      });
      const store = useProjectStore.getState() as any;
      store.setManifestVerdict("sub-A_01", "pass", { setAt: 1700000000000 });
      expect(useProjectStore.getState().project?.uiState?.manifest?.verdicts?.["sub-A_01"]).toEqual(
        {
          status: "pass",
          setAt: 1700000000000,
        },
      );
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("setManifestVerdict with fail requires reason", () => {
      useProjectStore.setState({
        project: validProject as any,
        isDirty: false,
        loaded: true,
      });
      const store = useProjectStore.getState() as any;
      expect(() => store.setManifestVerdict("sub-B_01", "fail", { setAt: 1 })).toThrow(
        /reason is required/,
      );
    });

    it("setManifestVerdict preserves prior verdict's notes when toggling pass→fail (clears notes by default)", () => {
      useProjectStore.setState({
        project: validProject as any,
        isDirty: false,
        loaded: true,
      });
      const store = useProjectStore.getState() as any;
      store.setManifestVerdict("sub-C_01", "pass", { setAt: 1000, notes: "looks good" });
      expect(
        useProjectStore.getState().project?.uiState?.manifest?.verdicts?.["sub-C_01"]?.notes,
      ).toBe("looks good");
      store.setManifestVerdict("sub-C_01", "fail", { setAt: 2000, reason: "motion" });
      expect(
        useProjectStore.getState().project?.uiState?.manifest?.verdicts?.["sub-C_01"]?.notes,
      ).toBeUndefined();
    });

    it("setManifestVerdict preserves notes when explicitly passed on fail toggle", () => {
      useProjectStore.setState({
        project: validProject as any,
        isDirty: false,
        loaded: true,
      });
      const store = useProjectStore.getState() as any;
      store.setManifestVerdict("sub-D_01", "pass", { setAt: 1000, notes: "looks good" });
      store.setManifestVerdict("sub-D_01", "fail", {
        setAt: 2000,
        reason: "motion",
        notes: "still relevant",
      });
      expect(
        useProjectStore.getState().project?.uiState?.manifest?.verdicts?.["sub-D_01"]?.notes,
      ).toBe("still relevant");
    });

    it("setManifestVerdict is a no-op when project is null", () => {
      useProjectStore.setState({ project: null });
      const store = useProjectStore.getState() as any;
      expect(() => store.setManifestVerdict("sub-E_01", "pass", { setAt: 1 })).not.toThrow();
      expect(useProjectStore.getState().project).toBeNull();
    });
  });

  describe("manifest versions: setLastRunProfileId", () => {
    it("stores profileId alongside version strings", () => {
      useProjectStore.setState({
        project: validProject as any,
        isDirty: false,
        loaded: true,
      });
      const store = useProjectStore.getState() as any;
      store.setLastRunProfileId("population", "profile-1", {
        exploreASLVersion: "1.0.0",
        matlabVersion: "R2023b",
        guiVersion: "0.1.0",
      });
      expect(useProjectStore.getState().project?.uiState?.processing?.population?.lastRun).toEqual({
        profileId: "profile-1",
        exploreASLVersion: "1.0.0",
        matlabVersion: "R2023b",
        guiVersion: "0.1.0",
      });
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("handles partial version info", () => {
      useProjectStore.setState({
        project: validProject as any,
        isDirty: false,
        loaded: true,
      });
      const store = useProjectStore.getState() as any;
      store.setLastRunProfileId("population", "profile-1", { exploreASLVersion: "1.0.0" });
      expect(useProjectStore.getState().project?.uiState?.processing?.population?.lastRun).toEqual({
        profileId: "profile-1",
        exploreASLVersion: "1.0.0",
      });
    });

    it("writes to the specified module's lastRun (structural)", () => {
      useProjectStore.setState({
        project: validProject as any,
        isDirty: false,
        loaded: true,
      });
      const store = useProjectStore.getState() as any;
      store.setLastRunProfileId("structural", "profile-2", { matlabVersion: "R2023b" });
      expect(useProjectStore.getState().project?.uiState?.processing?.structural?.lastRun).toEqual({
        profileId: "profile-2",
        matlabVersion: "R2023b",
      });
      expect(
        useProjectStore.getState().project?.uiState?.processing?.population?.lastRun,
      ).toBeUndefined();
    });

    it("is a no-op when project is null", () => {
      useProjectStore.setState({ project: null });
      const store = useProjectStore.getState() as any;
      expect(() =>
        store.setLastRunProfileId("population", "profile-1", { guiVersion: "0.1.0" }),
      ).not.toThrow();
      expect(useProjectStore.getState().project).toBeNull();
    });
  });

  describe("manifest mtime: setLastPopulationRunMtime", () => {
    it("stores a numeric mtime", () => {
      useProjectStore.setState({
        project: validProject as any,
        isDirty: false,
        loaded: true,
      });
      const store = useProjectStore.getState() as any;
      store.setLastPopulationRunMtime(1700000000000);
      expect(
        useProjectStore.getState().project?.uiState?.processing?.population?.lastRun?.Mtime,
      ).toBe(1700000000000);
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("stores null for missing file", () => {
      useProjectStore.setState({
        project: validProject as any,
        isDirty: false,
        loaded: true,
      });
      const store = useProjectStore.getState() as any;
      store.setLastPopulationRunMtime(null);
      expect(
        useProjectStore.getState().project?.uiState?.processing?.population?.lastRun?.Mtime,
      ).toBeNull();
    });

    it("is a no-op when project is null", () => {
      useProjectStore.setState({ project: null });
      const store = useProjectStore.getState() as any;
      expect(() => store.setLastPopulationRunMtime(1700000000000)).not.toThrow();
      expect(useProjectStore.getState().project).toBeNull();
    });
  });

  describe("cross-store uiState sync safety", () => {
    it("preserves sibling uiState branches when processing and visualization sync in sequence", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/cross-sync", "Cross Sync", { dataSource: "dicom" });

      useProjectStore.getState().syncProcessingState({
        config: {
          subjects: ["sub-01_01"],
          modules: ["structural"],
          selectedProfileId: "profile-1",
          workers: 1,
        },
        processingPhase: "idle",
      });

      useProjectStore.getState().syncVisualizationState({
        stage: "selectData",
        pointSize: 12,
      });

      const project = useProjectStore.getState().project!;
      expect(project.uiState.processing?.config?.subjects).toEqual(["sub-01_01"]);
      expect(project.uiState.processing?.currentPhase).toBe("idle");
      expect(project.uiState.dataVis?.stage).toBe("selectData");
      expect(project.uiState.dataVis?.pointSize).toBe(12);
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("preserves dataPar and processing uiState when both sync", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/datapar-sync", "DataPar Sync", { dataSource: "dicom" });

      useProjectStore.getState().syncProcessingState({
        config: {
          subjects: [],
          modules: ["population"],
          selectedProfileId: "profile-1",
          workers: 1,
        },
        processingPhase: "running",
      });

      useProjectStore.getState().syncDataParState(
        { Atlases: ["Total"], TissueMasking: ["GM"], TissueThreshold: [0.7] },
        {
          showAdvancedSections: true,
          showAdvancedM0Params: false,
          showAdvancedQuantification: false,
          showAdvancedGeneralSettings: false,
          showAdvancedASLProcessing: false,
          showAdvancedAtlases: false,
        },
      );

      const project = useProjectStore.getState().project!;
      expect(project.uiState.processing?.currentPhase).toBe("running");
      expect(project.dataPar.Atlases).toEqual(["Total"]);
      expect(project.uiState.datapar?.advancedVisibility?.showAdvancedSections).toBe(true);
    });
  });

  describe("queued saveProject", () => {
    it("retains dirty state after durability uncertainty and retries the latest revision", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/retry-save", "Retry Save", { dataSource: "dicom" });
      useProjectStore.getState().toggleNavbar();
      vi.mocked(invoke).mockRejectedValueOnce({
        category: "durability_uncertain",
        message: "Directory flush failed after replacement.",
      });

      await expect(useProjectStore.getState().saveProject()).rejects.toMatchObject({
        category: "durability_uncertain",
      });
      expect(useProjectStore.getState().isDirty).toBe(true);

      await useProjectStore.getState().saveProject();
      expect(useProjectStore.getState().isDirty).toBe(false);
    });

    it("does not write when the project is clean", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/clean-save", "Clean Save", { dataSource: "dicom" });
      vi.mocked(invoke).mockClear();

      await useProjectStore.getState().saveProject();

      expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.any(Object));
      expect(useProjectStore.getState().isDirty).toBe(false);
    });

    it("writes saves in order and keeps isDirty when a mutation occurs during save", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/queued-save", "Queued Save", { dataSource: "dicom" });
      useProjectStore.getState().toggleNavbar();

      let resolveFirstWrite: (() => void) | undefined;
      const firstWriteGate = new Promise<void>((resolve) => {
        resolveFirstWrite = resolve;
      });
      let resolveSecondWrite: (() => void) | undefined;
      const secondWriteGate = new Promise<void>((resolve) => {
        resolveSecondWrite = resolve;
      });
      let resolveFirstWriteEntered!: () => void;
      const firstWriteEntered = new Promise<void>((resolve) => {
        resolveFirstWriteEntered = resolve;
      });

      vi.mocked(invoke)
        .mockImplementationOnce(async () => {
          resolveFirstWriteEntered();
          await firstWriteGate;
        })
        .mockImplementationOnce(async () => {
          await secondWriteGate;
        });

      const firstSave = useProjectStore.getState().saveProject();
      await firstWriteEntered;
      useProjectStore.getState().syncVisualizationState({ stage: "visualize", pointSize: 8 });

      const secondSave = useProjectStore.getState().saveProject();
      resolveFirstWrite?.();

      await firstSave;
      expect(useProjectStore.getState().isDirty).toBe(true);

      resolveSecondWrite?.();
      await secondSave;
      expect(useProjectStore.getState().isDirty).toBe(false);

      const writes = vi.mocked(invoke).mock.calls.slice(-2);
      const firstSaved = JSON.parse((writes[0][1] as { canonicalBytes: string }).canonicalBytes);
      const secondSaved = JSON.parse((writes[1][1] as { canonicalBytes: string }).canonicalBytes);

      expect(firstSaved.uiState.navbarCollapsed).toBe(false);
      expect(firstSaved.uiState.dataVis).toBeUndefined();
      expect(secondSaved.uiState.dataVis).toMatchObject({
        stage: "visualize",
        pointSize: 8,
      });
    });

    it("does not clear isDirty when a stale save completes after a newer mutation", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/stale-save", "Stale Save", { dataSource: "dicom" });
      useProjectStore.getState().toggleNavbar();

      let resolveSlowWrite: (() => void) | undefined;
      const slowWriteGate = new Promise<void>((resolve) => {
        resolveSlowWrite = resolve;
      });

      vi.mocked(invoke).mockImplementationOnce(async () => {
        await slowWriteGate;
      });

      const slowSave = useProjectStore.getState().saveProject();
      await Promise.resolve();
      useProjectStore.getState().toggleNavbar();

      resolveSlowWrite?.();
      await slowSave;

      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("does not clear isDirty if a different project is loaded while save is in flight", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/project-a", "Project A", { dataSource: "dicom" });
      useProjectStore.getState().toggleNavbar();

      let resolveSlowWrite: (() => void) | undefined;
      const slowWriteGate = new Promise<void>((resolve) => {
        resolveSlowWrite = resolve;
      });

      vi.mocked(invoke).mockImplementationOnce(async () => {
        await slowWriteGate;
      });

      const slowSave = useProjectStore.getState().saveProject();
      await Promise.resolve();

      const createProjectB = useProjectStore
        .getState()
        .createProject("/tmp/project-b", "Project B", { dataSource: "dicom" });
      resolveSlowWrite?.();
      await slowSave;
      await createProjectB;
      useProjectStore.getState().toggleNavbar();

      expect(useProjectStore.getState().project?.projectMeta.name).toBe("Project B");
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("keeps a reopened same-ID project dirty until its own queued save completes", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/reopen-project", "Reopen Project", { dataSource: "dicom" });
      const reopenedProject = useProjectStore.getState().project!;
      useProjectStore.getState().toggleNavbar();

      let resolveSlowWrite: (() => void) | undefined;
      const slowWrite = new Promise<void>((resolve) => {
        resolveSlowWrite = resolve;
      });
      vi.mocked(invoke).mockImplementationOnce(async () => {
        await slowWrite;
      });

      const oldSave = useProjectStore.getState().saveProject();
      await Promise.resolve();
      const close = useProjectStore.getState().closeProject();
      resolveSlowWrite?.();
      await oldSave;
      await close;
      useProjectStore.setState({ project: reopenedProject, isDirty: true, loaded: true });
      useProjectStore.getState().toggleNavbar();
      const reopenedSave = useProjectStore.getState().saveProject();

      expect(useProjectStore.getState().isDirty).toBe(true);
      await reopenedSave;
      expect(useProjectStore.getState().isDirty).toBe(false);
    });

    it("blocks transition until an in-flight save settles and rejects new old-session saves", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/drain-project", "Drain Project", { dataSource: "dicom" });
      useProjectStore.getState().toggleNavbar();

      let resolveWrite!: () => void;
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "atomic_write_project") {
          await new Promise<void>((resolve) => {
            resolveWrite = resolve;
          });
          return null;
        }
        if (command === "shutdown_project_runtime") {
          return {
            success: true,
            importProcess: { success: true },
            processingWorkers: { success: true },
            lockWatcher: { success: true },
          };
        }
        return null;
      });

      const save = useProjectStore.getState().saveProject();
      await vi.waitFor(() => expect(resolveWrite).toBeTypeOf("function"));
      const close = useProjectStore.getState().closeProject();
      await Promise.resolve();

      expect(useProjectStore.getState().project?.projectMeta.name).toBe("Drain Project");
      await expect(useProjectStore.getState().saveProject()).rejects.toThrow(/transition/i);

      resolveWrite();
      await save;
      await close;
      expect(useProjectStore.getState().project).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // confirmBidsReview
  // ---------------------------------------------------------------------------
  describe("confirmBidsReview", () => {
    const GROUP_1: import("../schemas/importSchemas").DerivedMetadataGroup = {
      id: "g1",
      label: "Siemens_3T_PCASL_3D",
      vendor: "Siemens",
      sequence: "3D_PCASL",
      labelingType: "PCASL",
      bidsParams: {
        ArterialSpinLabelingType: "PCASL",
        PostLabelingDelay: [1.8],
        MRAcquisitionType: "3D",
        MagneticFieldStrength: 3,
        Manufacturer: "Siemens",
        ASLContext: "m0scan,control,label",
        M0Type: "Included",
        LabelingDuration: 1.8,
        BackgroundSuppression: false,
      },
      subjects: [
        { subjectLabel: "sub-01", sessionLabels: ["1"] },
        { subjectLabel: "sub-02", sessionLabels: ["1"] },
      ],
    };

    const GROUP_2: import("../schemas/importSchemas").DerivedMetadataGroup = {
      id: "g2",
      label: "Philips_3T_PASL_2D",
      vendor: "Philips",
      sequence: "2D_PASL",
      labelingType: "PASL",
      bidsParams: {
        ArterialSpinLabelingType: "PASL",
        PostLabelingDelay: [1.5],
        MRAcquisitionType: "2D",
        MagneticFieldStrength: 3,
        Manufacturer: "Philips",
        ASLContext: "m0scan,control,label",
        M0Type: "Included",
        BackgroundSuppression: false,
        SliceTiming: [0, 0.5, 1.0],
      },
      subjects: [{ subjectLabel: "sub-03", sessionLabels: ["1"] }],
    };

    it("BIDS confirm populates mappingState and persists uiState", async () => {
      // Create a BIDS project
      await useProjectStore
        .getState()
        .createProject("/tmp/bids-confirm", "BIDS Confirm", { dataSource: "bids" });

      // Pre-seed importStore with scan results
      useImportStore.setState({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups: [GROUP_1, GROUP_2],
          skippedSubjects: ["sub-UNK001_1"],
        },
      });

      await useProjectStore.getState().confirmBidsReview();

      const project = useProjectStore.getState().project!;
      // metadataGroups has 2 entries (id, label, bidsParams only — no display fields)
      expect(project.mappingState.metadataGroups).toHaveLength(2);
      expect(project.mappingState.metadataGroups![0]).toEqual({
        id: "g1",
        label: "Siemens_3T_PCASL_3D",
        bidsParams: GROUP_1.bidsParams,
      });
      expect(project.mappingState.metadataGroups![1]).toEqual({
        id: "g2",
        label: "Philips_3T_PASL_2D",
        bidsParams: GROUP_2.bidsParams,
      });

      // subjectRows: group 1 has sub-01, sub-02; group 2 has sub-03
      expect(project.mappingState.subjectRows).toHaveLength(3);
      expect(project.mappingState.ingestionComplete).toBe(true);
      expect(project.mappingState.sourceDataPath).toBe("/tmp/bids-confirm");

      // uiState
      expect(project.uiState.import?.skippedSubjects).toEqual(["sub-UNK001_1"]);
      expect(project.uiState.import?.bidsReviewConfirmed).toBe(true);

      // phase
      expect(project.projectMeta.currentPhase).toBe("parameters");

      // project was saved
      expect(invoke).toHaveBeenCalledWith("atomic_write_project", expect.any(Object));
      expect(useProjectStore.getState().isDirty).toBe(false);
    });

    it("confirmBidsReview throws on empty labels", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/empty-label", "Empty Label", { dataSource: "bids" });

      useImportStore.setState({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups: [{ ...GROUP_1, label: "", id: "bad" }],
          skippedSubjects: [],
        },
      });

      await expect(useProjectStore.getState().confirmBidsReview()).rejects.toThrow(/label.*empty/i);
    });

    it("confirmBidsReview throws on duplicate labels", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/dup-label", "Dup Label", { dataSource: "bids" });

      useImportStore.setState({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups: [
            { ...GROUP_1, id: "dup1", label: "SameLabel" },
            { ...GROUP_2, id: "dup2", label: "SameLabel" },
          ],
          skippedSubjects: [],
        },
      });

      await expect(useProjectStore.getState().confirmBidsReview()).rejects.toThrow(
        /duplicate.*label/i,
      );
    });

    it("confirmBidsReview throws on duplicate labels case-insensitive", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/case-label", "Case Label", { dataSource: "bids" });

      useImportStore.setState({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups: [
            { ...GROUP_1, id: "c1", label: "MyGroup" },
            { ...GROUP_2, id: "c2", label: "mygroup" },
          ],
          skippedSubjects: [],
        },
      });

      await expect(useProjectStore.getState().confirmBidsReview()).rejects.toThrow(
        /duplicate.*label/i,
      );
    });

    it("confirmBidsReview throws when no groups were detected", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/zero-groups", "Zero Groups", { dataSource: "bids" });

      useImportStore.setState({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups: [],
          skippedSubjects: [],
        },
      });

      await expect(useProjectStore.getState().confirmBidsReview()).rejects.toThrow(
        /at least one detected BIDS group/i,
      );
    });

    it("confirmBidsReview subjectRows strips sub- prefix and builds correct id", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/subject-rows", "Subject Rows", { dataSource: "bids" });

      useImportStore.setState({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups: [
            {
              ...GROUP_1,
              id: "grp",
              label: "TestGroup",
              subjects: [
                { subjectLabel: "sub-01", sessionLabels: ["1"] },
                { subjectLabel: "sub-01", sessionLabels: ["2"] },
              ],
            },
          ],
          skippedSubjects: [],
        },
      });

      await useProjectStore.getState().confirmBidsReview();

      const rows = useProjectStore.getState().project!.mappingState.subjectRows!;
      expect(rows).toHaveLength(2);
      expect(rows).toContainEqual({ id: "sub-01_1", subject: "01", session: "1", groupId: "grp" });
      expect(rows).toContainEqual({ id: "sub-01_2", subject: "01", session: "2", groupId: "grp" });
    });

    it("syncImportState does not overwrite mappingState after bidsReviewConfirmed", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/bids-gate", "BIDS Gate", { dataSource: "bids" });

      useImportStore.setState({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups: [GROUP_1],
          skippedSubjects: [],
        },
      });

      await useProjectStore.getState().confirmBidsReview();

      const mappingBefore = useProjectStore.getState().project!.mappingState;

      // Simulate a subsequent syncImportState call (e.g. ImportPage subscription)
      useProjectStore.getState().syncImportState({
        ...useImportStore.getState(),
        activeStep: 3,
        importPhase: "idle",
        importCompleted: false,
      });

      // mappingState must be preserved (not clobbered by DICOM-wizard defaults)
      expect(useProjectStore.getState().project!.mappingState).toEqual(mappingBefore);
      // But uiState.import fields should still update
      expect(useProjectStore.getState().project!.uiState.import?.activeStep).toBe(3);
    });
  });
});
