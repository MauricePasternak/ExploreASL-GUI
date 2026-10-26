import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exists } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { projectFixture } from "../../test/projectFixtures";
import { projectView } from "../../schemas/project";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";

import BIDSReviewPanel from "./BIDSReviewPanel";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import type { DerivedMetadataGroup } from "../../schemas/importSchemas";

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

const MOCK_GROUP: DerivedMetadataGroup = {
  id: "group-1",
  label: "Siemens_3T_PCASL_3D_Included",
  bidsParams: {
    ArterialSpinLabelingType: "PCASL",
    MRAcquisitionType: "3D",
    MagneticFieldStrength: 3,
    Manufacturer: "Siemens",
    ASLContext: "m0scan,label,control,label,control",
    M0Type: "Included",
  },
  vendor: "Siemens",
  sequence: "3D_PCASL",
  labelingType: "CASL",
  subjects: [
    { subjectLabel: "sub-01", sessionLabels: ["1"] },
    { subjectLabel: "sub-02", sessionLabels: ["1"] },
    { subjectLabel: "sub-03", sessionLabels: ["1"] },
  ],
};

const MOCK_GROUP_2: DerivedMetadataGroup = {
  id: "group-2",
  label: "Philips_3T_PASL_3D_Absent",
  bidsParams: {
    ArterialSpinLabelingType: "PASL",
    MRAcquisitionType: "3D",
    MagneticFieldStrength: 3,
    Manufacturer: "Philips",
  },
  vendor: "Philips",
  sequence: "3D_PASL",
  labelingType: "PASL",
  subjects: [{ subjectLabel: "sub-10", sessionLabels: ["1"] }],
};

function makeProject(overrides: Record<string, unknown> = {}) {
  const snapshot = projectFixture("proj-1", "Test Project", "/tmp/test-project");
  snapshot.document.projectMeta.dataSource = "bids";
  snapshot.document.mappingState = {
    metadataGroups: [],
    subjectRows: [],
    ingestionComplete: false,
    sourceDataPath: ".",
  };
  snapshot.document.uiState.import = {
    mostRecentConfig: null,
    bidsReviewConfirmed: false,
    skippedSubjects: [],
  };
  return {
    ...projectView(snapshot),
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <MantineProvider env="test">
      <MemoryRouter>
        <BIDSReviewPanel />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe("BIDSReviewPanel", () => {
  afterEach(() => {
    cleanup();
    useProjectStore.getState().cancelAutosave();
    resetProjectLifecycleForTests();
    mockNavigate.mockReset();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exists).mockResolvedValue(false);
    useImportStore.getState().resetBidsReview();
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProjectStore.setState({
      project: makeProject() as any,
      loaded: true,
    });
  });

  it("renders scan-running skeleton when scan is not complete and no error", () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: false,
        scanError: null,
        detectedGroups: [],
        skippedSubjects: [],
      },
    });

    renderPanel();
    expect(screen.getByTestId("bids-review-scan-running")).toBeInTheDocument();
    expect(screen.getByTestId("bids-review-header")).toBeInTheDocument();
  });

  it("renders scan-error alert with Retry and Back to Landing buttons", () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: false,
        scanError: "Connection failed",
        detectedGroups: [],
        skippedSubjects: [],
      },
    });

    renderPanel();
    expect(screen.getByTestId("bids-review-scan-error")).toBeInTheDocument();
    expect(screen.getByTestId("bids-review-retry-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-review-back-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-review-header")).toBeInTheDocument();
  });

  it("Retry button calls retryBidsScan", async () => {
    const retrySpy = vi.spyOn(useImportStore.getState(), "retryBidsScan");
    retrySpy.mockResolvedValue(undefined);

    useImportStore.setState({
      bidsReview: {
        scanComplete: false,
        scanError: "timeout",
        detectedGroups: [],
        skippedSubjects: [],
      },
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("bids-review-retry-btn"));

    expect(retrySpy).toHaveBeenCalledWith("/tmp/test-project");
    retrySpy.mockRestore();
  });

  it("Back to Landing calls backToLanding and navigates to /", () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: false,
        scanError: "fail",
        detectedGroups: [],
        skippedSubjects: [],
      },
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("bids-review-back-btn"));

    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("renders 0-groups alert when scan complete but no groups found", () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [],
        skippedSubjects: [],
      },
    });

    renderPanel();
    expect(screen.getByTestId("bids-review-no-groups")).toBeInTheDocument();
    expect(screen.getByTestId("bids-review-header")).toBeInTheDocument();
  });

  it("renders group card with label input when scan complete with groups", () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [MOCK_GROUP],
        skippedSubjects: [],
      },
    });

    renderPanel();
    expect(screen.getByTestId("bids-review-panel")).toBeInTheDocument();
    expect(screen.getByTestId("bids-review-header")).toBeInTheDocument();
    expect(screen.getByTestId("bids-group-label-input-group-1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Siemens_3T_PCASL_3D_Included")).toBeInTheDocument();
    expect(screen.getByTestId("bids-review-confirm-btn")).toBeInTheDocument();
  });

  it("renders vendor/sequence/labelingType badges on group card", () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [MOCK_GROUP],
        skippedSubjects: [],
      },
    });

    renderPanel();
    // Badge text matches — use getAllByText since "Siemens" also in label
    expect(screen.getAllByText("Siemens").length).toBeGreaterThan(0);
    expect(screen.getByText("3D_PCASL")).toBeInTheDocument();
    expect(screen.getByText("Continuous ASL")).toBeInTheDocument();
  });

  it("renders formatted vendor/sequence/labelingType badges on group card", () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [
          {
            ...MOCK_GROUP,
            vendor: "GE_product",
            sequence: "3D_spiral",
            labelingType: "PCASL",
          },
        ],
        skippedSubjects: [],
      },
    });

    renderPanel();
    expect(screen.getByText("GE")).toBeInTheDocument();
    expect(screen.getByText("Stack of Spirals")).toBeInTheDocument();
    expect(screen.getByText("Pseudo-continuous ASL")).toBeInTheDocument();
  });

  it("renders subject count", () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [MOCK_GROUP],
        skippedSubjects: [],
      },
    });

    renderPanel();
    expect(screen.getByText(/3 subjects/)).toBeInTheDocument();
  });

  it("renders skipped subjects warning when skippedSubjects.length > 0", () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [MOCK_GROUP],
        skippedSubjects: ["sub-05_1", "sub-08_1"],
      },
    });

    renderPanel();
    expect(screen.getByTestId("bids-review-skipped-warning")).toBeInTheDocument();
    expect(screen.getByText("sub-05_1")).toBeInTheDocument();
    expect(screen.getByText("sub-08_1")).toBeInTheDocument();
  });

  it("shows inline error when Confirm clicked with empty label", async () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [{ ...MOCK_GROUP, label: "" }],
        skippedSubjects: [],
      },
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("bids-review-confirm-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("bids-group-error-group-1")).toBeInTheDocument();
    });
  });

  it("shows inline error when Confirm clicked with duplicate labels", async () => {
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [
          { ...MOCK_GROUP, id: "g1", label: "Same" },
          { ...MOCK_GROUP_2, id: "g2", label: "Same" },
        ],
        skippedSubjects: [],
      },
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("bids-review-confirm-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("bids-group-error-g1")).toBeInTheDocument();
      expect(screen.getByTestId("bids-group-error-g2")).toBeInTheDocument();
    });
  });

  it("accepts BIDS review and waits for durable saving before navigation", async () => {
    activateProjectLease("proj-1", "/tmp/test-project");
    const accepted = {
      ...projectFixture("proj-1", "Test Project", "/tmp/test-project"),
      acceptedRevision: 1,
    };
    accepted.document.projectMeta = {
      ...accepted.document.projectMeta,
      dataSource: "bids",
      currentPhase: "parameters",
    };
    accepted.document.mappingState = {
      sourceDataPath: ".",
      ingestionComplete: true,
      metadataGroups: [
        {
          id: "group-1",
          label: MOCK_GROUP.label,
          bidsParams: MOCK_GROUP.bidsParams as NonNullable<
            typeof accepted.document.mappingState.metadataGroups
          >[number]["bidsParams"],
        },
      ],
      subjectRows: [
        { id: "sub-01_1", subject: "01", session: "1", groupId: "group-1" },
        { id: "sub-02_1", subject: "02", session: "1", groupId: "group-1" },
        { id: "sub-03_1", subject: "03", session: "1", groupId: "group-1" },
      ],
    };
    accepted.document.uiState.import = {
      mostRecentConfig: null,
      bidsReviewConfirmed: true,
      skippedSubjects: [],
    };
    const prior = useProjectStore.getState().project;
    let release!: () => void;
    let reject!: (error: Error) => void;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "scan_bids_sidecars") {
        const { id: fingerprintHash, ...group } = MOCK_GROUP;
        return { groups: [{ ...group, fingerprintHash }], skipped: [] };
      }
      if (command === "accept_project_edit") {
        await new Promise<void>((resolve, fail) => {
          release = resolve;
          reject = fail;
        });
        return { ...accepted, persistedRevision: 1 };
      }
      return null;
    });
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [MOCK_GROUP],
        skippedSubjects: [],
      },
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("bids-review-confirm-btn"));

    await waitFor(() => expect(release).toBeTypeOf("function"));
    expect(invoke).toHaveBeenCalledWith("accept_project_edit", {
      generation: 1,
      edit: { kind: "confirmBids", groups: [MOCK_GROUP], skipped: [] },
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project).toEqual(prior);
    reject(new Error("Project storage unavailable"));
    await waitFor(() =>
      expect(useProjectStore.getState().saveError).toContain("storage unavailable"),
    );
    expect(useProjectStore.getState().project).toEqual(prior);
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("bids-review-confirm-btn"));
    await waitFor(() =>
      expect(
        vi.mocked(invoke).mock.calls.filter(([command]) => command === "accept_project_edit"),
      ).toHaveLength(2),
    );
    release();
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/project/proj-1/parameters");
    });
    expect(useProjectStore.getState().isDirty).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("save_project", expect.anything());
  });

  describe("participants.tsv banner (D21)", () => {
    // Use a confirmed project so the mount effect does not fire
    // `startBidsScan` (which invokes `scan_bids_sidecars` and overwrites
    // `detectedGroups` with the setup's empty fixture). The persisted banner
    // renders identically in both editable and read-only branches.
    it("renders the persisted banner when participants.tsv exists at project root", async () => {
      vi.mocked(exists).mockImplementation(async (path: string | URL) => {
        return String(path) === "/tmp/test-project/participants.tsv";
      });
      useProjectStore.setState({
        project: makeProject({
          mappingState: {
            metadataGroups: [
              { id: MOCK_GROUP.id, label: MOCK_GROUP.label, bidsParams: MOCK_GROUP.bidsParams },
            ],
            subjectRows: [
              { id: "sub-01_1", subject: "01", session: "1", groupId: MOCK_GROUP.id },
              { id: "sub-02_1", subject: "02", session: "1", groupId: MOCK_GROUP.id },
              { id: "sub-03_1", subject: "03", session: "1", groupId: MOCK_GROUP.id },
            ],
            ingestionComplete: true,
            sourceDataPath: "/tmp/test-project",
          },
          uiState: {
            import: {
              bidsReviewConfirmed: true,
              skippedSubjects: [],
            },
          },
        }) as any,
        loaded: true,
      });
      useImportStore.setState({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups: [MOCK_GROUP],
          skippedSubjects: [],
        },
      });

      renderPanel();

      await waitFor(() => {
        expect(screen.getByTestId("bids-review-participants-banner")).toBeInTheDocument();
      });
      expect(screen.getByText(/root-level file stays as you authored it/i)).toBeInTheDocument();
    });

    it("does not render the banner when participants.tsv is absent", async () => {
      vi.mocked(exists).mockResolvedValue(false);
      useProjectStore.setState({
        project: makeProject({
          mappingState: {
            metadataGroups: [
              { id: MOCK_GROUP.id, label: MOCK_GROUP.label, bidsParams: MOCK_GROUP.bidsParams },
            ],
            subjectRows: [
              { id: "sub-01_1", subject: "01", session: "1", groupId: MOCK_GROUP.id },
              { id: "sub-02_1", subject: "02", session: "1", groupId: MOCK_GROUP.id },
              { id: "sub-03_1", subject: "03", session: "1", groupId: MOCK_GROUP.id },
            ],
            ingestionComplete: true,
            sourceDataPath: "/tmp/test-project",
          },
          uiState: {
            import: {
              bidsReviewConfirmed: true,
              skippedSubjects: [],
            },
          },
        }) as any,
        loaded: true,
      });
      useImportStore.setState({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups: [MOCK_GROUP],
          skippedSubjects: [],
        },
      });

      renderPanel();

      await waitFor(() => {
        expect(screen.queryByTestId("bids-review-participants-banner")).not.toBeInTheDocument();
      });
    });
  });

  describe("revisit summary (bidsReviewConfirmed === true)", () => {
    beforeEach(() => {
      useProjectStore.setState({
        project: makeProject({
          mappingState: {
            metadataGroups: [
              { id: MOCK_GROUP.id, label: MOCK_GROUP.label, bidsParams: MOCK_GROUP.bidsParams },
            ],
            subjectRows: [
              { id: "sub-01_1", subject: "01", session: "1", groupId: MOCK_GROUP.id },
              { id: "sub-02_1", subject: "02", session: "1", groupId: MOCK_GROUP.id },
              { id: "sub-03_1", subject: "03", session: "1", groupId: MOCK_GROUP.id },
            ],
            ingestionComplete: true,
            sourceDataPath: "/tmp/test-project",
          },
          uiState: {
            import: {
              bidsReviewConfirmed: true,
              skippedSubjects: ["sub-99_1"],
            },
          },
        }) as any,
        loaded: true,
      });

      useImportStore.setState({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups: [MOCK_GROUP],
          skippedSubjects: ["sub-99_1"],
        },
      });
    });

    it("renders the persisted read-only summary with skipped subjects and a Re-scan action", () => {
      renderPanel();
      expect(screen.getByTestId("bids-review-readonly-banner")).toBeInTheDocument();
      expect(screen.getByTestId("bids-review-header")).toBeInTheDocument();
      const input = screen.getByTestId("bids-group-label-input-group-1");
      expect(input).toHaveAttribute("readonly");
      expect(screen.queryByTestId("bids-review-confirm-btn")).not.toBeInTheDocument();
      expect(screen.getByTestId("bids-review-rescan-btn")).toBeInTheDocument();
      expect(screen.getByTestId("bids-review-skipped-warning")).toBeInTheDocument();
      expect(screen.getByText("sub-99_1")).toBeInTheDocument();
    });

    it("does not show skeleton when session scan state is empty after reload", () => {
      useImportStore.getState().resetBidsReview();

      renderPanel();

      expect(screen.queryByTestId("bids-review-scan-running")).not.toBeInTheDocument();
      expect(screen.getByTestId("bids-group-label-input-group-1")).toBeInTheDocument();
    });

    it("clicking Re-scan BIDS renders editable latest scan result", async () => {
      const rescanSpy = vi.spyOn(useImportStore.getState(), "rescanConfirmedBidsProject");
      rescanSpy.mockImplementation(async () => {
        useImportStore.setState({
          bidsReview: {
            scanComplete: true,
            scanError: null,
            detectedGroups: [{ ...MOCK_GROUP, label: "Latest_Label" }],
            skippedSubjects: ["sub-newskip_1"],
          },
        });
      });

      renderPanel();
      fireEvent.click(screen.getByTestId("bids-review-rescan-btn"));

      await waitFor(() => {
        expect(screen.getByDisplayValue("Latest_Label")).toBeInTheDocument();
      });
      expect(screen.getByTestId("bids-review-confirm-btn")).toBeInTheDocument();
      expect(screen.getByText("sub-newskip_1")).toBeInTheDocument();
      expect(screen.getByTestId("bids-group-label-input-group-1")).not.toHaveAttribute("readonly");

      rescanSpy.mockRestore();
    });

    it("failed Re-scan BIDS can return to previous persisted summary", async () => {
      const rescanSpy = vi.spyOn(useImportStore.getState(), "rescanConfirmedBidsProject");
      rescanSpy.mockImplementation(async () => {
        useImportStore.setState({
          bidsReview: {
            scanComplete: false,
            scanError: "permission denied",
            detectedGroups: [],
            skippedSubjects: [],
          },
        });
      });

      renderPanel();
      fireEvent.click(screen.getByTestId("bids-review-rescan-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("bids-review-scan-error")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("bids-review-back-btn"));

      expect(screen.getByTestId("bids-review-readonly-banner")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Siemens_3T_PCASL_3D_Included")).toHaveAttribute("readonly");

      rescanSpy.mockRestore();
    });
  });
});
