import { describe, it, expect, beforeEach, vi } from "vitest";
import { useManifestStore } from "./manifestStore";

const { mockGetState, mockProcessingState } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockProcessingState: {
    availableSubjects: [] as Array<{ subjectSession: string }>,
    scanAvailableSubjects: vi.fn(async () => {}),
  },
}));

vi.mock("./projectStore", () => ({
  useProjectStore: {
    getState: mockGetState,
  },
}));

vi.mock("./processingStore", () => ({
  useProcessingStore: {
    getState: () => mockProcessingState,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("useManifestStore", () => {
  beforeEach(() => {
    useManifestStore.setState({
      step: 0,
      filter: "all",
      staleVerdicts: new Set(),
      priorModulesMtimes: {},
    });
  });

  it("starts on step 0 by default", () => {
    expect(useManifestStore.getState().step).toBe(0);
  });

  it("setStep advances step", () => {
    useManifestStore.getState().setStep(1);
    expect(useManifestStore.getState().step).toBe(1);
  });

  it("starts with filter 'all'", () => {
    expect(useManifestStore.getState().filter).toBe("all");
  });

  it("setFilter changes filter", () => {
    useManifestStore.getState().setFilter("pass");
    expect(useManifestStore.getState().filter).toBe("pass");
  });

  it("resetStep returns to step 0", () => {
    useManifestStore.getState().setStep(1);
    useManifestStore.getState().resetStep();
    expect(useManifestStore.getState().step).toBe(0);
  });
});

describe("useManifestStore staleness actions", () => {
  beforeEach(async () => {
    useManifestStore.setState({
      step: 0,
      filter: "all",
      staleVerdicts: new Set(),
      priorModulesMtimes: {},
    });
    mockProcessingState.availableSubjects = [];
    mockProcessingState.scanAvailableSubjects.mockReset();
    mockProcessingState.scanAvailableSubjects.mockImplementation(async () => {});
    mockGetState.mockReturnValue({
      project: {
        projectMeta: { rootPath: "/test/root" },
        uiState: {
          manifest: {
            verdicts: {
              "sub-A_01": { status: "pass" as const, setAt: 1700000000000 },
              "sub-B_01": {
                status: "fail" as const,
                reason: "motion" as const,
                setAt: 1700000060000,
              },
            },
          },
        },
      },
    });
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue({
      "sub-A_01": 1700000060000,
      "sub-B_01": 1700000060000,
    });
  });

  it("loadPriorModulesMtimes fetches mtimes and identifies stale verdicts", async () => {
    await useManifestStore.getState().loadPriorModulesMtimes();
    expect(useManifestStore.getState().priorModulesMtimes).toEqual({
      "sub-A_01": 1700000060000,
      "sub-B_01": 1700000060000,
    });
    const stale = useManifestStore.getState().staleVerdicts;
    expect(stale.has("sub-A_01")).toBe(true);
    expect(stale.has("sub-B_01")).toBe(false);
  });

  it("computeStaleVerdicts computes staleness synchronously in-memory", () => {
    useManifestStore.setState({
      priorModulesMtimes: {
        "sub-A_01": 1700000060000,
        "sub-B_01": 1700000060000,
      },
    });
    useManifestStore.getState().computeStaleVerdicts();
    const stale = useManifestStore.getState().staleVerdicts;
    expect(stale.has("sub-A_01")).toBe(true);
    expect(stale.has("sub-B_01")).toBe(false);
  });

  it("loadPriorModulesMtimes clears stale set when no verdicts exist", async () => {
    mockGetState.mockReturnValue({
      project: {
        projectMeta: { rootPath: "/test/root" },
        uiState: { manifest: { verdicts: {} } },
      },
    });
    await useManifestStore.getState().loadPriorModulesMtimes();
    expect(useManifestStore.getState().staleVerdicts.size).toBe(0);
  });

  it("loadPriorModulesMtimes no-ops when no project root", async () => {
    mockGetState.mockReturnValue({ project: null });
    await useManifestStore.getState().loadPriorModulesMtimes();
    expect(useManifestStore.getState().staleVerdicts.size).toBe(0);
  });

  it("loadPriorModulesMtimes handles invoke errors gracefully", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("fs error"));
    await useManifestStore.getState().loadPriorModulesMtimes();
    expect(useManifestStore.getState().staleVerdicts.size).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      "[manifestStore] failed to read prior modules mtimes for staleness",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("loadPriorModulesMtimes scans subjects when availableSubjects is empty (race fix)", async () => {
    mockProcessingState.availableSubjects = [];
    mockProcessingState.scanAvailableSubjects.mockImplementation(async () => {
      mockProcessingState.availableSubjects = [
        { subjectSession: "sub-A_01" },
        { subjectSession: "sub-B_01" },
      ];
    });
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue({
      "sub-A_01": 1700000060000,
      "sub-B_01": 1700000060000,
    });

    await useManifestStore.getState().loadPriorModulesMtimes();

    expect(mockProcessingState.scanAvailableSubjects).toHaveBeenCalled();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("read_prior_modules_mtimes", {
      projectRoot: "/test/root",
      subjectSessions: ["sub-A_01", "sub-B_01"],
    });
  });

  it("computeStaleVerdicts treats setAt:0 as unset, not stale", () => {
    mockGetState.mockReturnValue({
      project: {
        projectMeta: { rootPath: "/test/root" },
        uiState: {
          manifest: {
            verdicts: {
              "sub-A_01": { status: "pass", setAt: 0 },
              "sub-B_01": { status: "pass", setAt: 1700000000000 },
            },
          },
        },
      },
    });
    useManifestStore.setState({
      priorModulesMtimes: {
        "sub-A_01": 1700000060000,
        "sub-B_01": 1700000060000,
      },
    });
    useManifestStore.getState().computeStaleVerdicts();
    const stale = useManifestStore.getState().staleVerdicts;
    expect(stale.has("sub-A_01")).toBe(false);
    expect(stale.has("sub-B_01")).toBe(true);
  });
});
