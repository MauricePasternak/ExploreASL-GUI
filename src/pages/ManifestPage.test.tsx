import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManifestPage from "./ManifestPage";

let mockStep = 0;
const mockSetStep = vi.fn();
const mockLoadPriorModulesMtimes = vi.fn();
const mockComputeStaleVerdicts = vi.fn();
const mockLoadQcData = vi.fn();
const mockLoadDataPar = vi.fn();
const mockComputeDisagreements = vi.fn();
let mockDisagreements: { subjectSession: string }[] = [];
let mockQcData: Record<string, unknown> | null = null;
let mockQcLoaded = false;
let renderedReviewerIds: (string | undefined)[] = [];
let mockAvailableSubjects: { subjectSession: string }[] = [];

vi.mock("../stores/manifestStore", () => ({
  deriveDisagreements: (manifest: any) => {
    const reviewers = manifest?.reviewers ?? [];
    if (reviewers.length <= 1) return [];
    const verdicts = manifest?.verdicts ?? {};
    const subjectSessions = new Set<string>(
      reviewers.flatMap((reviewer: any) => Object.keys(verdicts[reviewer.id] ?? {})),
    );
    return Array.from(subjectSessions).flatMap((subjectSession) => {
      const verdictsByReviewer = Object.fromEntries(
        reviewers.map((reviewer: any) => [reviewer.id, verdicts[reviewer.id]?.[subjectSession]]),
      );
      const statuses = Object.values(verdictsByReviewer).map((verdict: any) => verdict?.status);
      return statuses.every(Boolean) && new Set(statuses).size > 1
        ? [{ subjectSession, verdictsByReviewer }]
        : [];
    });
  },
  useManifestStore: vi.fn((selector?: any) => {
    const state = {
      step: mockStep,
      setStep: mockSetStep,
      filter: "all",
      staleVerdicts: new Set(),
      loadPriorModulesMtimes: mockLoadPriorModulesMtimes,
      computeStaleVerdicts: mockComputeStaleVerdicts,
      loadQcData: mockLoadQcData,
      loadDataPar: mockLoadDataPar,
      computeDisagreements: mockComputeDisagreements,
      disagreements: mockDisagreements,
      qcData: mockQcData,
      qcLoaded: mockQcLoaded,
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("../components/manifest/QcSelectionTable", () => ({
  default: vi.fn(({ onNextReady }) => {
    return (
      <div data-testid="qc-selection-table">
        QC Table
        <button data-testid="trigger-ready" onClick={() => onNextReady?.(true)}>
          Ready
        </button>
        <button data-testid="trigger-unready" onClick={() => onNextReady?.(false)}>
          Unready
        </button>
      </div>
    );
  }),
}));

vi.mock("../components/manifest/ManifestPreview", () => ({
  default: vi.fn(() => <div data-testid="manifest-preview">Preview</div>),
}));

vi.mock("../components/manifest/VerdictResolution", () => ({
  default: vi.fn(() => <div data-testid="verdict-resolution">Resolution</div>),
}));

vi.mock("../components/manifest/ReviewerTabs", () => ({
  default: vi.fn(({ children }) => {
    const reviewers = (mockProjectState.project.uiState.manifest as any).reviewers ?? [];
    const reviewerIds =
      reviewers.length > 1 ? reviewers.map((reviewer: any) => reviewer.id) : [undefined];
    return (
      <div data-testid="reviewer-tabs-wrapper">
        {reviewerIds.map((reviewerId: string | undefined) => {
          renderedReviewerIds.push(reviewerId);
          return <div key={reviewerId ?? "single"}>{children(reviewerId)}</div>;
        })}
      </div>
    );
  }),
}));

vi.mock("../stores/processingStore", () => {
  const mockHook = vi.fn((selector?: any) => {
    const state = {
      availableSubjects: mockAvailableSubjects,
      setConfig: vi.fn(),
      setPhase: vi.fn(),
      scanAvailableSubjects: vi.fn().mockResolvedValue(undefined),
      loadLockFileStatus: vi.fn().mockResolvedValue(undefined),
    };
    return selector ? selector(state) : state;
  });
  (mockHook as any).getState = () => ({
    setConfig: vi.fn(),
    setPhase: vi.fn(),
    scanAvailableSubjects: vi.fn().mockResolvedValue(undefined),
    loadLockFileStatus: vi.fn().mockResolvedValue(undefined),
  });
  return { useProcessingStore: mockHook };
});

const mockProjectState = {
  project: {
    projectMeta: { rootPath: "/test/project" },
    uiState: { manifest: { verdicts: {}, resolvedVerdicts: {} } },
  },
};

vi.mock("../stores/projectStore", () => {
  const mockHook = vi.fn((selector?: any) => {
    return selector ? selector(mockProjectState) : mockProjectState;
  });
  (mockHook as any).getState = vi.fn(() => mockProjectState);
  return {
    useProjectStore: mockHook,
  };
});

function renderPage() {
  return render(
    <MantineProvider>
      <ManifestPage />
    </MantineProvider>,
  );
}

describe("ManifestPage", () => {
  afterEach(() => {
    cleanup();
    mockStep = 0;
    mockDisagreements = [];
    mockQcData = null;
    mockQcLoaded = false;
    mockAvailableSubjects = [];
    renderedReviewerIds = [];
    delete (mockProjectState.project.uiState.manifest as any).reviewers;
    mockProjectState.project.uiState.manifest.resolvedVerdicts = {};
    mockProjectState.project.uiState.manifest.verdicts = {};
    vi.clearAllMocks();
  });

  it("renders exactly QC and Preview indicators in single-reviewer mode", () => {
    renderPage();
    expect(screen.getByTestId("manifest-page")).toBeInTheDocument();
    expect(screen.getByTestId("manifest-stepper")).toBeInTheDocument();
    expect(screen.getByTestId("manifest-step-qc")).toBeInTheDocument();
    expect(screen.getByTestId("manifest-step-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("manifest-step-resolution")).not.toBeInTheDocument();
    expect(screen.getByTestId("qc-selection-table")).toBeInTheDocument();
    expect(screen.getByTestId("reviewer-tabs-wrapper")).toBeInTheDocument();
    expect(screen.queryByTestId("manifest-preview")).not.toBeInTheDocument();
  });

  it("renders Preview at step 1 rather than a nonexistent Resolution step when unanimous", () => {
    mockStep = 1;
    renderPage();
    expect(screen.getByTestId("manifest-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("verdict-resolution")).not.toBeInTheDocument();
  });

  it("normalizes a stale third-step state to Preview and returns to QC when Resolution disappears", async () => {
    const user = userEvent.setup();
    mockStep = 2;
    renderPage();
    expect(screen.getByTestId("manifest-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("verdict-resolution")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("back-button"));
    expect(mockSetStep).toHaveBeenCalledWith(0);
  });

  it("Next button is disabled by default and progression is gated", () => {
    renderPage();
    const nextBtn = screen.getByTestId("next-button");
    expect(nextBtn).toBeDisabled();
  });

  it("shows exactly two indicators and advances directly to Preview for complete unanimous reviewers", async () => {
    const user = userEvent.setup();
    const reviewerOne = "11111111-1111-4111-8111-111111111111";
    const reviewerTwo = "22222222-2222-4222-8222-222222222222";
    mockAvailableSubjects = [{ subjectSession: "sub-01_01" }];
    mockQcLoaded = true;
    mockQcData = { "sub-01_01": {} };
    (mockProjectState.project.uiState.manifest as any).reviewers = [
      { id: reviewerOne, label: "Reviewer 1" },
      { id: reviewerTwo, label: "Reviewer 2" },
    ];
    mockProjectState.project.uiState.manifest.verdicts = {
      [reviewerOne]: { "sub-01_01": { status: "pass", setAt: 1 } },
      [reviewerTwo]: { "sub-01_01": { status: "pass", setAt: 1 } },
    };

    renderPage();

    expect(screen.getAllByTestId(/^manifest-step-/)).toHaveLength(2);
    expect(screen.queryByTestId("manifest-step-resolution")).not.toBeInTheDocument();
    expect(screen.getByTestId("next-button")).toBeEnabled();
    await user.click(screen.getByTestId("next-button"));
    expect(mockSetStep).toHaveBeenCalledWith(1);
  });

  it("shows Resolution with its count and advances there when reviewers disagree", async () => {
    const user = userEvent.setup();
    const reviewerOne = "11111111-1111-4111-8111-111111111111";
    const reviewerTwo = "22222222-2222-4222-8222-222222222222";
    mockAvailableSubjects = [{ subjectSession: "sub-01_01" }];
    mockQcLoaded = true;
    mockQcData = { "sub-01_01": {} };
    // Store-derived disagreements can lag one render behind a verdict change.
    // Step topology must reflect the current reviewer verdicts immediately.
    mockDisagreements = [];
    (mockProjectState.project.uiState.manifest as any).reviewers = [
      { id: reviewerOne, label: "Reviewer 1" },
      { id: reviewerTwo, label: "Reviewer 2" },
    ];
    mockProjectState.project.uiState.manifest.verdicts = {
      [reviewerOne]: { "sub-01_01": { status: "pass", setAt: 1 } },
      [reviewerTwo]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    };

    renderPage();

    expect(screen.getAllByTestId(/^manifest-step-/)).toHaveLength(3);
    expect(screen.getByTestId("manifest-step-resolution")).toHaveTextContent(
      "Verdict Resolution (1)",
    );
    await user.click(screen.getByTestId("next-button"));
    expect(mockSetStep).toHaveBeenCalledWith(1);
  });

  it("returns Preview to Resolution when a current disagreement is introduced", () => {
    const reviewerOne = "11111111-1111-4111-8111-111111111111";
    const reviewerTwo = "22222222-2222-4222-8222-222222222222";
    mockStep = 2;
    (mockProjectState.project.uiState.manifest as any).reviewers = [
      { id: reviewerOne, label: "Reviewer 1" },
      { id: reviewerTwo, label: "Reviewer 2" },
    ];
    mockProjectState.project.uiState.manifest.verdicts = {
      [reviewerOne]: { "sub-01_01": { status: "pass", setAt: 1 } },
      [reviewerTwo]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    };

    renderPage();

    expect(screen.getByTestId("verdict-resolution")).toBeInTheDocument();
    expect(screen.queryByTestId("manifest-preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("resolution-next-button")).toBeDisabled();
  });

  it("blocks QC Next until every reviewer completes eligible rows and excludes No Info rows", () => {
    const reviewerOne = "11111111-1111-4111-8111-111111111111";
    const reviewerTwo = "22222222-2222-4222-8222-222222222222";
    mockAvailableSubjects = [{ subjectSession: "sub-01_01" }, { subjectSession: "sub-02_01" }];
    mockQcLoaded = true;
    mockQcData = { "sub-01_01": {} };
    (mockProjectState.project.uiState.manifest as any).reviewers = [
      { id: reviewerOne, label: "Reviewer 1" },
      { id: reviewerTwo, label: "Reviewer 2" },
    ];
    mockProjectState.project.uiState.manifest.verdicts = {
      [reviewerOne]: { "sub-01_01": { status: "pass", setAt: 1 } },
      [reviewerTwo]: {},
    };

    const view = renderPage();
    expect(screen.getByTestId("next-button")).toBeDisabled();

    mockProjectState.project.uiState.manifest.verdicts = {
      ...mockProjectState.project.uiState.manifest.verdicts,
      [reviewerTwo]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    };
    view.rerender(
      <MantineProvider>
        <ManifestPage />
      </MantineProvider>,
    );
    expect(screen.getByTestId("next-button")).toBeEnabled();
  });

  it("passes reviewer IDs to every tab panel and undefined to the single-reviewer panel", () => {
    const reviewerOne = "11111111-1111-4111-8111-111111111111";
    const reviewerTwo = "22222222-2222-4222-8222-222222222222";
    (mockProjectState.project.uiState.manifest as any).reviewers = [
      { id: reviewerOne, label: "Reviewer 1" },
      { id: reviewerTwo, label: "Reviewer 2" },
    ];
    mockProjectState.project.uiState.manifest.verdicts = {
      [reviewerOne]: { "sub-01_01": { status: "pass", setAt: 1 } },
      [reviewerTwo]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    };
    renderPage();
    expect(renderedReviewerIds).toEqual([reviewerOne, reviewerTwo]);

    cleanup();
    renderedReviewerIds = [];
    delete (mockProjectState.project.uiState.manifest as any).reviewers;
    renderPage();
    expect(renderedReviewerIds).toEqual([undefined]);
  });

  it("keeps one page-owned Next button in each QC flow", () => {
    renderPage();
    expect(screen.getAllByRole("button", { name: "Next" })).toHaveLength(1);
  });

  it("blocks preview until every current disagreement is resolved", async () => {
    const user = userEvent.setup();
    const reviewerOne = "11111111-1111-4111-8111-111111111111";
    const reviewerTwo = "22222222-2222-4222-8222-222222222222";
    mockStep = 1;
    mockDisagreements = [{ subjectSession: "sub-01_01" }];
    (mockProjectState.project.uiState.manifest as any).reviewers = [
      { id: reviewerOne, label: "Reviewer 1" },
      { id: reviewerTwo, label: "Reviewer 2" },
    ];
    mockProjectState.project.uiState.manifest.verdicts = {
      [reviewerOne]: { "sub-01_01": { status: "pass", setAt: 1 } },
      [reviewerTwo]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
    };
    renderPage();

    expect(screen.getByTestId("resolution-next-button")).toBeDisabled();
    await user.click(screen.getByTestId("resolution-back-button"));
    expect(mockSetStep).toHaveBeenCalledWith(0);

    cleanup();
    mockProjectState.project.uiState.manifest.resolvedVerdicts = {
      "sub-01_01": { status: "pass", setAt: 1 },
    };
    renderPage();

    const next = screen.getByTestId("resolution-next-button");
    expect(next).toBeEnabled();
    await user.click(next);
    expect(mockSetStep).toHaveBeenCalledWith(2);
  });

  it("does not let stale resolutions satisfy a newly introduced disagreement", () => {
    const reviewerOne = "11111111-1111-4111-8111-111111111111";
    const reviewerTwo = "22222222-2222-4222-8222-222222222222";
    mockStep = 1;
    mockDisagreements = [{ subjectSession: "sub-new_01" }];
    (mockProjectState.project.uiState.manifest as any).reviewers = [
      { id: reviewerOne, label: "Reviewer 1" },
      { id: reviewerTwo, label: "Reviewer 2" },
    ];
    mockProjectState.project.uiState.manifest.verdicts = {
      [reviewerOne]: { "sub-new_01": { status: "pass", setAt: 1 } },
      [reviewerTwo]: {
        "sub-new_01": { status: "fail", reason: "motion", setAt: 1 },
      },
    };
    mockProjectState.project.uiState.manifest.resolvedVerdicts = {
      "sub-old_01": { status: "pass", setAt: 1 },
    };
    renderPage();
    expect(screen.getByTestId("resolution-next-button")).toBeDisabled();
  });
});
