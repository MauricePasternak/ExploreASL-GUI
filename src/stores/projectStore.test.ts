import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROJECT_FILE_NAME } from "../schemas/project";
import type { ImportSnapshot } from "../schemas/importSchemas";
import { readSessionCheckpoint } from "../lib/sessionCheckpoint";
import { useImportStore } from "./importStore";
import { __resetProjectRevisionForTests, useProjectStore } from "./projectStore";
import { isBidsProject, ensureBidsIgnore } from "../lib/bids/validation";

vi.mock("../lib/bids/validation", () => ({
  isBidsProject: vi.fn(),
  ensureBidsIgnore: vi.fn(),
}));

describe("useProjectStore", () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetProjectRevisionForTests();
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
    });

    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    vi.mocked(readTextFile).mockResolvedValue("");
    vi.mocked(isBidsProject).mockReset();
    vi.mocked(ensureBidsIgnore).mockReset();
  });

  it("creates a new project file at the project root", async () => {
    await useProjectStore
      .getState()
      .createProject("/tmp/demo-project", "Demo Project", { dataSource: "dicom" });

    expect(writeTextFile).toHaveBeenCalledWith(
      `/tmp/demo-project/${PROJECT_FILE_NAME}`,
      expect.stringContaining('"name": "Demo Project"'),
    );
    expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("import");
    expect(useProjectStore.getState().project?.projectMeta.dataSource).toBe("dicom");
    expect(readSessionCheckpoint()?.projectId).toBe(
      useProjectStore.getState().project?.projectMeta.id,
    );
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

    expect(writeTextFile).toHaveBeenLastCalledWith(
      `/tmp/save-project/${PROJECT_FILE_NAME}`,
      expect.stringContaining('"currentPhase": "parameters"'),
    );
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("clears the current project when closed", async () => {
    await useProjectStore
      .getState()
      .createProject("/tmp/close-project", "Close Project", { dataSource: "dicom" });

    useProjectStore.getState().closeProject();

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
        matlabPath: "/usr/local/MATLAB",
        exploreAslPath: "/opt/ExploreASL",
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
        matlabPath: "",
        exploreAslPath: "",
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

      const calls = vi.mocked(writeTextFile).mock.calls;
      const savedJson = calls[calls.length - 1][1] as string;
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

    it("legacy object-form mostRecentConfig is dropped with a warning on load", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      vi.mocked(isBidsProject).mockResolvedValue(false);

      await useProjectStore.getState().loadProject("/tmp/legacy-snapshot/project.easl");

      const restored = useProjectStore.getState().project?.uiState.import?.mostRecentConfig;
      expect(restored).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("legacy object-form mostRecentConfig"),
        expect.any(Object),
      );
      warnSpy.mockRestore();
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

      const calls = vi.mocked(writeTextFile).mock.calls;
      const savedJson = calls[calls.length - 1][1] as string;
      const saved = JSON.parse(savedJson);
      expect(saved.uiState.import.mostRecentConfig).toBeNull();

      vi.mocked(readTextFile).mockResolvedValue(savedJson);
      useProjectStore.setState({ project: null, loaded: false, isDirty: false });
      await useProjectStore.getState().loadProject("/tmp/null-snapshot/project.easl");

      expect(useProjectStore.getState().project?.uiState.import?.mostRecentConfig).toBeNull();
    });
  });

  describe("BIDS project detection", () => {
    it("calls ensureBidsIgnore on createProject if it is a BIDS project", async () => {
      vi.mocked(isBidsProject).mockResolvedValue(true);
      vi.mocked(ensureBidsIgnore).mockResolvedValue(undefined);

      await useProjectStore
        .getState()
        .createProject("/tmp/bids-project", "BIDS Project", { dataSource: "dicom" });

      expect(isBidsProject).toHaveBeenCalledWith("/tmp/bids-project");
      expect(ensureBidsIgnore).toHaveBeenCalledWith("/tmp/bids-project");
    });

    it("does not call ensureBidsIgnore on createProject if it is not a BIDS project", async () => {
      vi.mocked(isBidsProject).mockResolvedValue(false);

      await useProjectStore
        .getState()
        .createProject("/tmp/non-bids-project", "Non-BIDS Project", { dataSource: "dicom" });

      expect(isBidsProject).toHaveBeenCalledWith("/tmp/non-bids-project");
      expect(ensureBidsIgnore).not.toHaveBeenCalled();
    });

    it("calls ensureBidsIgnore on loadProject if it is a BIDS project", async () => {
      vi.mocked(isBidsProject).mockResolvedValue(true);
      vi.mocked(ensureBidsIgnore).mockResolvedValue(undefined);
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

      expect(isBidsProject).toHaveBeenCalledWith("/tmp/bids-loaded");
      expect(ensureBidsIgnore).toHaveBeenCalledWith("/tmp/bids-loaded");
    });

    it("does not call ensureBidsIgnore on loadProject if it is not a BIDS project", async () => {
      vi.mocked(isBidsProject).mockResolvedValue(false);
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

      expect(isBidsProject).toHaveBeenCalledWith("/tmp/non-bids-loaded");
      expect(ensureBidsIgnore).not.toHaveBeenCalled();
    });

    it("does not throw or block project loading if BIDS checking throws an error", async () => {
      vi.mocked(isBidsProject).mockRejectedValue(new Error("FS Error"));
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

  describe("manifest versions: setLastRunVersions", () => {
    it("stores version strings", () => {
      useProjectStore.setState({
        project: validProject as any,
        isDirty: false,
        loaded: true,
      });
      const store = useProjectStore.getState() as any;
      store.setLastRunVersions({
        exploreASLVersion: "1.0.0",
        matlabVersion: "R2023b",
        guiVersion: "0.1.0",
      });
      expect(useProjectStore.getState().project?.uiState?.processing?.population?.lastRun).toEqual({
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
      store.setLastRunVersions({ exploreASLVersion: "1.0.0" });
      expect(useProjectStore.getState().project?.uiState?.processing?.population?.lastRun).toEqual({
        exploreASLVersion: "1.0.0",
      });
    });

    it("is a no-op when project is null", () => {
      useProjectStore.setState({ project: null });
      const store = useProjectStore.getState() as any;
      expect(() => store.setLastRunVersions({ guiVersion: "0.1.0" })).not.toThrow();
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
          matlabPath: "/matlab",
          exploreAslPath: "/eas",
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
          matlabPath: "/matlab",
          exploreAslPath: "/eas",
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
    it("does not write when the project is clean", async () => {
      await useProjectStore
        .getState()
        .createProject("/tmp/clean-save", "Clean Save", { dataSource: "dicom" });
      vi.mocked(writeTextFile).mockClear();

      await useProjectStore.getState().saveProject();

      expect(writeTextFile).not.toHaveBeenCalled();
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

      vi.mocked(writeTextFile).mockImplementationOnce(async () => {
        await firstWriteGate;
      });

      const firstSave = useProjectStore.getState().saveProject();
      await Promise.resolve();
      useProjectStore.getState().syncVisualizationState({ stage: "visualize", pointSize: 8 });

      const secondSave = useProjectStore.getState().saveProject();
      resolveFirstWrite?.();

      await firstSave;
      expect(useProjectStore.getState().isDirty).toBe(true);

      await secondSave;
      expect(useProjectStore.getState().isDirty).toBe(false);

      const writes = vi.mocked(writeTextFile).mock.calls.slice(-2);
      const firstSaved = JSON.parse(writes[0][1] as string);
      const secondSaved = JSON.parse(writes[1][1] as string);

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

      vi.mocked(writeTextFile).mockImplementationOnce(async () => {
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

      vi.mocked(writeTextFile).mockImplementationOnce(async () => {
        await slowWriteGate;
      });

      const slowSave = useProjectStore.getState().saveProject();
      await Promise.resolve();

      await useProjectStore
        .getState()
        .createProject("/tmp/project-b", "Project B", { dataSource: "dicom" });
      useProjectStore.getState().toggleNavbar();

      resolveSlowWrite?.();
      await slowSave;

      expect(useProjectStore.getState().project?.projectMeta.name).toBe("Project B");
      expect(useProjectStore.getState().isDirty).toBe(true);
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
      expect(writeTextFile).toHaveBeenCalled();
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
