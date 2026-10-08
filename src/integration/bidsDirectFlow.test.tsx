import { TestMantineProvider as MantineProvider } from "../test/render";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import BIDSReviewPanel from "../components/import/BIDSReviewPanel";
import { useProjectStore } from "../stores/projectStore";
import { useImportStore } from "../stores/importStore";
import { projectFixture } from "../test/projectFixtures";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import type { DerivedMetadataGroup, MetadataGroup } from "../schemas/importSchemas";
import type { ProjectSnapshot } from "../generated/project/ProjectSnapshot";

const mockNavigate = vi.fn();
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn().mockResolvedValue(false),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}));

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

afterEach(() => {
  cleanup();
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
  useProjectStore.setState({ project: null, isDirty: false, loaded: false });
  useImportStore.setState({
    bidsReview: {
      scanComplete: false,
      scanError: null,
      detectedGroups: [],
      skippedSubjects: [],
    },
  });
  vi.clearAllMocks();
});

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <MantineProvider env="test">
      <MemoryRouter initialEntries={["/project/test-project/import"]}>{ui}</MemoryRouter>
    </MantineProvider>,
  );
}

const MOCK_GROUP: DerivedMetadataGroup = {
  id: "g1",
  label: "Siemens_3T_PCASL_3D_Included",
  bidsParams: {
    ArterialSpinLabelingType: "PCASL",
    PostLabelingDelay: 1.8,
    MRAcquisitionType: "3D",
    MagneticFieldStrength: 3,
    Manufacturer: "Siemens",
    M0Type: "Included",
  },
  vendor: "Siemens",
  sequence: "3D_PCASL",
  labelingType: "CASL",
  subjects: Array.from({ length: 25 }, (_, i) => ({
    subjectLabel: `sub-${String(i + 1).padStart(2, "0")}`,
    sessionLabels: ["1"],
  })),
};

function makeBidsProject(confirmed: boolean): ProjectSnapshot {
  const snapshot = projectFixture("test-project", "DS000240", "/test/ds000240", {
    mappingState: {
      metadataGroups: confirmed
        ? [{ id: "g1", label: "Siemens_3T_PCASL_3D_Included", bidsParams: {} }]
        : [],
      subjectRows: confirmed
        ? Array.from({ length: 25 }, (_, i) => ({
            id: `sub-${String(i + 1).padStart(2, "0")}_1`,
            subject: String(i + 1).padStart(2, "0"),
            session: "1",
            groupId: "g1",
          }))
        : [],
      ingestionComplete: confirmed,
      sourceDataPath: ".",
    },
    uiState: {
      import: {
        bidsReviewConfirmed: confirmed,
        skippedSubjects: confirmed ? ["sub-UNK001_1"] : [],
        mostRecentConfig: null,
      },
    },
  });
  snapshot.document.projectMeta.dataSource = "bids";
  snapshot.document.projectMeta.currentPhase = confirmed ? "parameters" : "import";
  return snapshot;
}

function seedBidsProject(confirmed: boolean) {
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useProjectStore.getState().acceptSnapshot(makeBidsProject(confirmed));
  activateProjectLease("test-project", "/test/ds000240");
}

describe("BIDS-direct revisit import after confirmation", () => {
  it("updates subjectRows only after explicit re-scan and re-confirm when a subject is added externally", async () => {
    seedBidsProject(true); // confirmed project with 25 subjects

    // Check initial subjectRows length is 25
    expect(useProjectStore.getState().project?.mappingState.subjectRows).toHaveLength(25);

    const before = structuredClone(useProjectStore.getState().project!.mappingState);

    // Mock scan to return 26 subjects (adding sub-26)
    const mockGroupWithNewSubject: DerivedMetadataGroup = {
      ...MOCK_GROUP,
      label: "Updated_Label",
      subjects: [...MOCK_GROUP.subjects, { subjectLabel: "sub-26", sessionLabels: ["1"] }],
    };

    const accepted = makeBidsProject(true);
    accepted.acceptedRevision = 1;
    accepted.persistedRevision = 1;
    accepted.document.mappingState.metadataGroups![0].label = "Updated_Label";
    accepted.document.mappingState.metadataGroups![0].bidsParams =
      MOCK_GROUP.bidsParams as MetadataGroup["bidsParams"];
    accepted.document.mappingState.subjectRows!.push({
      id: "sub-26_1",
      subject: "26",
      session: "1",
      groupId: "g1",
    });
    accepted.document.uiState.import!.skippedSubjects = ["sub-NEW_1"];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "scan_bids_sidecars") {
        return Promise.resolve({
          groups: [mockGroupWithNewSubject],
          skipped: ["sub-NEW_1"],
        });
      }
      if (cmd === "accept_project_edit") return Promise.resolve(accepted);
      return Promise.resolve(null);
    });

    renderWithProviders(<BIDSReviewPanel />);

    // Renders the read-only summary showing the persisted 25 subjects.
    // The store's subjectRows remains 25.
    expect(useProjectStore.getState().project?.mappingState.subjectRows).toHaveLength(25);

    expect(screen.getByTestId("bids-group-label-input-g1")).toHaveAttribute("readonly");
    expect(screen.getByText("sub-UNK001_1")).toBeInTheDocument();
    expect(screen.queryByTestId("bids-review-confirm-btn")).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
    // Click Re-scan BIDS
    await userEvent.click(screen.getByRole("button", { name: /re-scan bids/i }));

    // Wait for latest scan result to render in editable state
    await waitFor(() => {
      expect(screen.getByDisplayValue("Updated_Label")).toBeInTheDocument();
    });

    // The scan completed, but until Confirm is clicked, the persisted subjectRows MUST still be 25
    expect(useProjectStore.getState().project?.mappingState.subjectRows).toHaveLength(25);

    expect(useProjectStore.getState().project?.mappingState).toEqual(before);
    expect(screen.getByDisplayValue("Updated_Label")).not.toHaveAttribute("readonly");
    expect(screen.getByText("sub-NEW_1")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    // Click Confirm to persist the updated scan result
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    // Now it should be updated to 26
    await waitFor(() => {
      expect(useProjectStore.getState().project?.mappingState.subjectRows).toHaveLength(26);
    });
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/project/test-project/parameters"),
    );
    expect(useProjectStore.getState().isDirty).toBe(false);
    expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("parameters");
    expect(useProjectStore.getState().project?.uiState.import?.skippedSubjects).toEqual([
      "sub-NEW_1",
    ]);
    expect(useProjectStore.getState().project?.mappingState).toEqual(
      accepted.document.mappingState,
    );
    expect(mockInvoke).toHaveBeenCalledWith("accept_project_edit", {
      generation: 1,
      edit: { kind: "confirmBids", groups: [mockGroupWithNewSubject], skipped: ["sub-NEW_1"] },
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("save_project", expect.anything());
  });
});
