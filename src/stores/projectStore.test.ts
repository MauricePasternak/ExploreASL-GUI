import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROJECT_FILE_NAME } from "../schemas/project";
import type { ImportSnapshot } from "../schemas/importSchemas";
import { readSessionCheckpoint } from "../lib/sessionCheckpoint";
import { useImportStore } from "./importStore";
import { __resetProjectRevisionForTests, useProjectStore } from "./projectStore";
import { isBidsProject, ensureBidsIgnore } from "../lib/bidsUtils";

vi.mock("../lib/bidsUtils", () => ({
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
    await useProjectStore.getState().createProject("/tmp/demo-project", "Demo Project");

    expect(writeTextFile).toHaveBeenCalledWith(
      `/tmp/demo-project/${PROJECT_FILE_NAME}`,
      expect.stringContaining('"name": "Demo Project"'),
    );
    expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("import");
    expect(readSessionCheckpoint()?.projectId).toBe(
      useProjectStore.getState().project?.projectMeta.id,
    );
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
        },
        uiState: {},
        mappingState: {},
        exploreAslConfig: {
          dataPar: {},
        },
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
    await useProjectStore.getState().createProject("/tmp/save-project", "Save Project");

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
    await useProjectStore.getState().createProject("/tmp/close-project", "Close Project");

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
      await useProjectStore.getState().createProject("/tmp/proc-project", "Proc Project");

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
      await useProjectStore.getState().createProject("/tmp/phase-project", "Phase Project");

      useProjectStore.getState().syncProcessingState({
        config: null,
        processingPhase: "running",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.currentPhase).toBe("running");
      expect(project?.uiState.processing?.config).toBeUndefined();
    });

    it("handles null config without throwing", async () => {
      await useProjectStore.getState().createProject("/tmp/null-config", "Null Config");

      useProjectStore.getState().syncProcessingState({
        config: null as any,
        processingPhase: "idle",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.config).toBeUndefined();
    });

    it("drops config when modules is empty", async () => {
      await useProjectStore.getState().createProject("/tmp/empty-mods", "Empty Mods");

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
      await useProjectStore.getState().createProject("/tmp/noop-project", "Noop Project");

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
    await useProjectStore.getState().createProject("/tmp/import-project", "Import Project");

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
      await useProjectStore.getState().createProject("/tmp/snapshot-roundtrip", "Snapshot RT");

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
        exploreAslConfig: { dataPar: {} },
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
      await useProjectStore.getState().createProject("/tmp/null-snapshot", "Null Snapshot");

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

      await useProjectStore.getState().createProject("/tmp/bids-project", "BIDS Project");

      expect(isBidsProject).toHaveBeenCalledWith("/tmp/bids-project");
      expect(ensureBidsIgnore).toHaveBeenCalledWith("/tmp/bids-project");
    });

    it("does not call ensureBidsIgnore on createProject if it is not a BIDS project", async () => {
      vi.mocked(isBidsProject).mockResolvedValue(false);

      await useProjectStore.getState().createProject("/tmp/non-bids-project", "Non-BIDS Project");

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
          },
          uiState: {},
          mappingState: {},
          exploreAslConfig: {
            dataPar: {},
          },
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
          },
          uiState: {},
          mappingState: {},
          exploreAslConfig: {
            dataPar: {},
          },
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
          },
          uiState: {},
          mappingState: {},
          exploreAslConfig: {
            dataPar: {},
          },
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
          },
          uiState: {},
          mappingState: {},
          exploreAslConfig: { dataPar: {} },
        },
        isDirty: false,
        loaded: true,
      });

      const { setPopulationCompleted } = useProjectStore.getState();
      setPopulationCompleted(true);
      expect(useProjectStore.getState().project?.uiState.population?.completed).toBe(true);
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
          },
          uiState: { population: { completed: true } },
          mappingState: {},
          exploreAslConfig: { dataPar: {} },
        },
        isDirty: false,
        loaded: true,
      });

      const { setPopulationCompleted } = useProjectStore.getState();
      setPopulationCompleted(false);
      expect(useProjectStore.getState().project?.uiState.population?.completed).toBe(false);
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
    },
    uiState: {} as Record<string, unknown>,
    mappingState: {} as Record<string, unknown>,
    exploreAslConfig: { dataPar: {} },
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
      store.setLastRunVersions({ exploreASL: "1.0.0", matlab: "R2023b", gui: "0.1.0" });
      expect(useProjectStore.getState().project?.uiState?.manifest?.lastRunVersions).toEqual({
        exploreASL: "1.0.0",
        matlab: "R2023b",
        gui: "0.1.0",
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
      store.setLastRunVersions({ exploreASL: "1.0.0" });
      expect(useProjectStore.getState().project?.uiState?.manifest?.lastRunVersions).toEqual({
        exploreASL: "1.0.0",
      });
    });

    it("is a no-op when project is null", () => {
      useProjectStore.setState({ project: null });
      const store = useProjectStore.getState() as any;
      expect(() => store.setLastRunVersions({ gui: "0.1.0" })).not.toThrow();
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
      expect(useProjectStore.getState().project?.uiState?.manifest?.lastPopulationRunMtime).toBe(
        1700000000000,
      );
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
        useProjectStore.getState().project?.uiState?.manifest?.lastPopulationRunMtime,
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
      await useProjectStore.getState().createProject("/tmp/cross-sync", "Cross Sync");

      useProjectStore.getState().syncProcessingState({
        config: {
          subjects: ["sub-01_01"],
          modules: ["structural"],
          matlabPath: "/matlab",
          exploreAslPath: "/eas",
          workers: 1,
          subjectRegexp: "^sub-.*$",
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
      await useProjectStore.getState().createProject("/tmp/datapar-sync", "DataPar Sync");

      useProjectStore.getState().syncProcessingState({
        config: {
          subjects: [],
          modules: ["population"],
          matlabPath: "/matlab",
          exploreAslPath: "/eas",
          workers: 1,
          subjectRegexp: "^sub-.*$",
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
      expect(project.exploreAslConfig.dataPar.Atlases).toEqual(["Total"]);
      expect(project.uiState.datapar?.advancedVisibility?.showAdvancedSections).toBe(true);
    });
  });

  describe("queued saveProject", () => {
    it("does not write when the project is clean", async () => {
      await useProjectStore.getState().createProject("/tmp/clean-save", "Clean Save");
      vi.mocked(writeTextFile).mockClear();

      await useProjectStore.getState().saveProject();

      expect(writeTextFile).not.toHaveBeenCalled();
      expect(useProjectStore.getState().isDirty).toBe(false);
    });

    it("writes saves in order and keeps isDirty when a mutation occurs during save", async () => {
      await useProjectStore.getState().createProject("/tmp/queued-save", "Queued Save");
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
      await useProjectStore.getState().createProject("/tmp/stale-save", "Stale Save");
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
      await useProjectStore.getState().createProject("/tmp/project-a", "Project A");
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

      await useProjectStore.getState().createProject("/tmp/project-b", "Project B");
      useProjectStore.getState().toggleNavbar();

      resolveSlowWrite?.();
      await slowSave;

      expect(useProjectStore.getState().project?.projectMeta.name).toBe("Project B");
      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });
});
