import { describe, it, expect, beforeEach, vi } from "vitest";
import { useManifestStore } from "./manifestStore";

const { mockGetState, mockProcessingState } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockProcessingState: {
    availableSubjects: [] as Array<{ subjectSession: string }>,
    scanAvailableSubjects: vi.fn(async () => {}),
  },
}));

function singleReviewerStaleVerdicts(): Set<string> {
  const stale = useManifestStore.getState().staleVerdicts;
  if (!(stale instanceof Set)) throw new Error("Expected single-reviewer stale verdicts");
  return stale;
}

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

describe("useManifestStore multi-reviewer derived state", () => {
  const reviewers = [
    { id: "reviewer-a", label: "Reviewer A", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "reviewer-b", label: "Reviewer B", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "reviewer-c", label: "Reviewer C", createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  function setManifestProject(manifest: Record<string, unknown>, mappingState = {}) {
    mockGetState.mockReturnValue({
      project: {
        projectMeta: { rootPath: "/test/root" },
        uiState: { manifest },
        mappingState,
      },
    });
  }

  beforeEach(() => {
    useManifestStore.setState({
      reviewerMode: "single",
      disagreements: [],
      agreementResults: null,
      staleVerdicts: new Set(),
      priorModulesMtimes: {},
    });
  });

  it.each([
    [undefined, "single"],
    [[], "single"],
    [[reviewers[0]], "single"],
    [[reviewers[0], reviewers[1]], "multi"],
  ] as const)("derives %s reviewers as %s mode", (configuredReviewers, expectedMode) => {
    setManifestProject({ reviewers: configuredReviewers, verdicts: {} });

    useManifestStore.getState().computeDisagreements();

    expect(useManifestStore.getState().reviewerMode).toBe(expectedMode);
  });

  it("reports deterministic status-only disagreements with complete full verdicts", () => {
    const pass = { status: "pass" as const, notes: "reviewed", setAt: 10 };
    const motionFail = { status: "fail" as const, reason: "motion" as const, setAt: 10 };
    const coverageFail = {
      status: "fail" as const,
      reason: "coverage" as const,
      notes: "edge",
      setAt: 11,
    };
    setManifestProject({
      reviewers: reviewers.slice(0, 3),
      verdicts: {
        "reviewer-a": {
          "sub-03_01": pass,
          "sub-01_01": pass,
          "sub-02_01": motionFail,
          "sub-04_01": pass,
        },
        "reviewer-b": {
          "sub-03_01": coverageFail,
          "sub-01_01": coverageFail,
          "sub-02_01": coverageFail,
          "sub-04_01": pass,
        },
        "reviewer-c": {
          "sub-03_01": pass,
          "sub-01_01": pass,
          "sub-02_01": motionFail,
        },
      },
    });

    useManifestStore.getState().computeDisagreements();

    expect(useManifestStore.getState().disagreements).toEqual([
      {
        subjectSession: "sub-01_01",
        verdictsByReviewer: {
          "reviewer-a": pass,
          "reviewer-b": coverageFail,
          "reviewer-c": pass,
        },
      },
      {
        subjectSession: "sub-03_01",
        verdictsByReviewer: {
          "reviewer-a": pass,
          "reviewer-b": coverageFail,
          "reviewer-c": pass,
        },
      },
    ]);
  });

  it("reports a two-reviewer pass-fail disagreement", () => {
    const pass = { status: "pass" as const, setAt: 10 };
    const fail = { status: "fail" as const, reason: "motion" as const, setAt: 11 };
    setManifestProject({
      reviewers: reviewers.slice(0, 2),
      verdicts: {
        "reviewer-a": { "sub-01_01": pass },
        "reviewer-b": { "sub-01_01": fail },
      },
    });

    useManifestStore.getState().computeDisagreements();

    expect(useManifestStore.getState().disagreements).toEqual([
      {
        subjectSession: "sub-01_01",
        verdictsByReviewer: { "reviewer-a": pass, "reviewer-b": fail },
      },
    ]);
  });

  it("computes Cohen agreement from complete intersections and grouped subjects", () => {
    setManifestProject(
      {
        reviewers: reviewers.slice(0, 2),
        verdicts: {
          "reviewer-a": {
            "sub-01_01": { status: "pass", setAt: 1 },
            "sub-02_01": { status: "fail", reason: "motion", setAt: 1 },
            "sub-03_01": { status: "pass", setAt: 1 },
          },
          "reviewer-b": {
            "sub-01_01": { status: "pass", setAt: 1 },
            "sub-02_01": { status: "fail", reason: "coverage", setAt: 1 },
          },
        },
      },
      {
        metadataGroups: [{ id: "group-a", label: "Group A", bidsParams: {} }],
        subjectRows: [
          { id: "sub-01/01", subject: "sub-01", session: "01", groupId: "group-a" },
          { id: "sub-02/01", subject: "sub-02", session: "01", groupId: "group-a" },
        ],
      },
    );

    useManifestStore.getState().computeAgreement();

    expect(useManifestStore.getState().agreementResults).toEqual({
      overall: { kappa: 1, ci95Lower: 1, ci95Upper: 1, n: 2, agreementRate: 1 },
      perGroup: {
        "Group A": { kappa: 1, ci95Lower: 1, ci95Upper: 1, n: 2, agreementRate: 1 },
        Ungrouped: { kappa: null, ci95Lower: null, ci95Upper: null, n: 0, agreementRate: 0 },
      },
    });
  });

  it("maps DICOM subject rows to BIDS subjectSession keys for per-group agreement", () => {
    setManifestProject(
      {
        reviewers: reviewers.slice(0, 2),
        verdicts: {
          "reviewer-a": {
            "sub-SUB_01": { status: "pass", setAt: 1 },
            "sub-OTHER_01": { status: "fail", reason: "motion", setAt: 1 },
          },
          "reviewer-b": {
            "sub-SUB_01": { status: "pass", setAt: 1 },
            "sub-OTHER_01": { status: "fail", reason: "coverage", setAt: 1 },
          },
        },
      },
      {
        metadataGroups: [{ id: "group-a", label: "Group A", bidsParams: {} }],
        subjectRows: [{ id: "SUB/01", subject: "SUB", session: "01", groupId: "group-a" }],
      },
    );

    useManifestStore.getState().computeAgreement();

    expect(useManifestStore.getState().agreementResults?.perGroup).toEqual({
      "Group A": { kappa: null, ci95Lower: null, ci95Upper: null, n: 1, agreementRate: 1 },
      Ungrouped: { kappa: null, ci95Lower: null, ci95Upper: null, n: 1, agreementRate: 1 },
    });
  });

  it("computes Fleiss agreement for three reviewers and null kappa for small groups", () => {
    setManifestProject(
      {
        reviewers,
        verdicts: {
          "reviewer-a": {
            "sub-01_01": { status: "pass", setAt: 1 },
            "sub-02_01": { status: "fail", reason: "motion", setAt: 1 },
            "sub-03_01": { status: "pass", setAt: 1 },
          },
          "reviewer-b": {
            "sub-01_01": { status: "pass", setAt: 1 },
            "sub-02_01": { status: "fail", reason: "motion", setAt: 1 },
            "sub-03_01": { status: "pass", setAt: 1 },
          },
          "reviewer-c": {
            "sub-01_01": { status: "pass", setAt: 1 },
            "sub-02_01": { status: "fail", reason: "motion", setAt: 1 },
            "sub-03_01": { status: "fail", reason: "coverage", setAt: 1 },
          },
        },
      },
      {
        metadataGroups: [{ id: "group-a", label: "Group A", bidsParams: {} }],
        subjectRows: [
          { id: "sub-01/01", subject: "sub-01", session: "01", groupId: "group-a" },
          { id: "sub-02/01", subject: "sub-02", session: "01", groupId: "group-a" },
        ],
      },
    );

    useManifestStore.getState().computeAgreement();

    expect(useManifestStore.getState().agreementResults).toEqual({
      overall: {
        kappa: 0.55,
        ci95Lower: -0.11144958655634174,
        ci95Upper: 1.2114495865563417,
        n: 3,
        agreementRate: 2 / 3,
      },
      perGroup: {
        "Group A": { kappa: 1, ci95Lower: 1, ci95Upper: 1, n: 2, agreementRate: 1 },
        Ungrouped: { kappa: null, ci95Lower: null, ci95Upper: null, n: 1, agreementRate: 0 },
      },
    });
  });

  it("computes flat single-reviewer staleness from prior-module mtimes only", () => {
    setManifestProject({
      verdicts: {
        "sub-01_01": { status: "pass", setAt: 10 },
        "sub-02_01": { status: "pass", setAt: 20 },
      },
      lastPopulationRunMtime: 99,
    });
    useManifestStore.setState({ priorModulesMtimes: { "sub-01_01": 10, "sub-02_01": 21 } });

    useManifestStore.getState().computeStaleVerdicts();

    expect(useManifestStore.getState().staleVerdicts).toEqual(new Set(["sub-02_01"]));
  });

  it("computes every multi-reviewer stale slice independently", () => {
    setManifestProject({
      reviewers,
      verdicts: {
        "reviewer-a": { "sub-01_01": { status: "pass", setAt: 10 } },
        "reviewer-b": { "sub-01_01": { status: "pass", setAt: 20 } },
        "reviewer-c": {},
      },
    });
    useManifestStore.setState({ priorModulesMtimes: { "sub-01_01": 20 } });

    useManifestStore.getState().computeStaleVerdicts();

    expect(useManifestStore.getState().staleVerdicts).toEqual({
      "reviewer-a": new Set(["sub-01_01"]),
      "reviewer-b": new Set(),
      "reviewer-c": new Set(),
    });
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
    const stale = singleReviewerStaleVerdicts();
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
    const stale = singleReviewerStaleVerdicts();
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

  it("uses the current reviewer mode when an mtime request fails", async () => {
    mockProcessingState.availableSubjects = [{ subjectSession: "sub-A_01" }];
    const { invoke } = await import("@tauri-apps/api/core");
    let rejectMtimes: (reason: Error) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise<Record<string, number | null>>((_, reject) => {
          rejectMtimes = reject;
        }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = useManifestStore.getState().loadPriorModulesMtimes();
    mockGetState.mockReturnValue({
      project: {
        projectMeta: { rootPath: "/test/root" },
        uiState: {
          manifest: {
            reviewers: [
              { id: "reviewer-a", label: "Reviewer A", createdAt: "2026-01-01T00:00:00.000Z" },
              { id: "reviewer-b", label: "Reviewer B", createdAt: "2026-01-01T00:00:00.000Z" },
            ],
            verdicts: {},
          },
        },
      },
    });
    rejectMtimes!(new Error("fs error"));

    await load;

    expect(useManifestStore.getState().staleVerdicts).toEqual({
      "reviewer-a": new Set(),
      "reviewer-b": new Set(),
    });
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

  it("does not apply an mtime response after the project changes", async () => {
    mockProcessingState.availableSubjects = [{ subjectSession: "sub-A_01" }];
    const { invoke } = await import("@tauri-apps/api/core");
    let resolveMtimes: (mtimes: Record<string, number | null>) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise<Record<string, number | null>>((resolve) => {
          resolveMtimes = resolve;
        }),
    );
    useManifestStore.setState({
      priorModulesMtimes: { "sub-B_01": 20 },
      staleVerdicts: new Set(["sub-B_01"]),
    });

    const load = useManifestStore.getState().loadPriorModulesMtimes();
    mockGetState.mockReturnValue({
      project: {
        projectMeta: { rootPath: "/other/project" },
        uiState: { manifest: { verdicts: { "sub-B_01": { status: "pass", setAt: 20 } } } },
      },
    });
    resolveMtimes!({ "sub-A_01": 10 });
    await load;

    expect(useManifestStore.getState().priorModulesMtimes).toEqual({ "sub-B_01": 20 });
    expect(singleReviewerStaleVerdicts()).toEqual(new Set(["sub-B_01"]));
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
    const stale = singleReviewerStaleVerdicts();
    expect(stale.has("sub-A_01")).toBe(false);
    expect(stale.has("sub-B_01")).toBe(true);
  });
});
