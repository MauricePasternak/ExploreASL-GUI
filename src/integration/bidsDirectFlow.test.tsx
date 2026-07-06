import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import BIDSReviewPanel from "../components/import/BIDSReviewPanel";
import { useProjectStore } from "../stores/projectStore";
import { useImportStore } from "../stores/importStore";
import { canAccessPhase } from "../schemas/project";
import type { DerivedMetadataGroup } from "../schemas/importSchemas";
import type { ProjectFile } from "../schemas/project";

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
    <MantineProvider>
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
  } as any,
  vendor: "Siemens",
  sequence: "3D_PCASL",
  labelingType: "CASL",
  subjects: Array.from({ length: 25 }, (_, i) => ({
    subjectLabel: `sub-${String(i + 1).padStart(2, "0")}`,
    sessionLabels: ["1"],
  })),
};

function makeBidsProject(confirmed: boolean): ProjectFile {
  return {
    version: "0.1.0",
    projectMeta: {
      id: "test-project",
      name: "DS000240",
      rootPath: "/test/ds000240",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastOpened: "2026-01-01T00:00:00.000Z",
      currentPhase: confirmed ? "parameters" : "import",
      dataSource: "bids",
    },
    mappingState: {
      metadataGroups: confirmed
        ? [{ id: "g1", label: "Siemens_3T_PCASL_3D_Included", bidsParams: {} }]
        : [],
      subjectRows: confirmed
        ? Array.from({ length: 25 }, (_, i) => ({
            id: `sub-${String(i + 1).padStart(2, "0")}/1`,
            subject: `sub-${String(i + 1).padStart(2, "0")}`,
            session: "1",
            groupId: "g1",
          }))
        : [],
      ingestionComplete: confirmed,
      sourceDataPath: "/test/ds000240",
    },
    uiState: {
      import: {
        bidsReviewConfirmed: confirmed,
        skippedSubjects: confirmed ? ["sub-UNK001_1"] : [],
        step: 1,
      },
    },
    dataPar: {},
  } as unknown as ProjectFile;
}

function seedBidsProject(confirmed: boolean) {
  useProjectStore.setState({
    project: makeBidsProject(confirmed),
    loaded: true,
  });
}

// ---------------------------------------------------------------------------
// 10.1 — BIDS project creation → review → confirmation → processing access
// ---------------------------------------------------------------------------

describe("BIDS-direct flow: creation → review → confirmation → processing gate", () => {
  it("BIDSReviewPanel mounts, scans, and renders detected groups", async () => {
    seedBidsProject(false);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "scan_bids_sidecars")
        return Promise.resolve({ groups: [MOCK_GROUP], skipped: ["sub-UNK001_1"] });
      return Promise.resolve(null);
    });

    renderWithProviders(<BIDSReviewPanel />);

    // Wait for scan to complete — look for the TextInput with group label
    await waitFor(() => {
      expect(screen.getByTestId("bids-group-label-input-g1")).toBeInTheDocument();
    });

    // Should show 25 subjects
    expect(screen.getByText(/25 subjects/)).toBeInTheDocument();

    // Should show skipped subjects warning
    expect(screen.getByText(/sub-UNK001_1/)).toBeInTheDocument();

    // Should have a Confirm button
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
  });

  it("confirm calls confirmBidsReview and navigates to parameters", async () => {
    seedBidsProject(false);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "scan_bids_sidecars")
        return Promise.resolve({ groups: [MOCK_GROUP], skipped: [] });
      return Promise.resolve(null);
    });

    renderWithProviders(<BIDSReviewPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("bids-group-label-input-g1")).toBeInTheDocument();
    });

    const confirmBtn = screen.getByRole("button", { name: /confirm/i });
    await userEvent.click(confirmBtn);

    // After confirmation, project should have bidsReviewConfirmed = true
    await waitFor(() => {
      const project = useProjectStore.getState().project;
      expect(project?.uiState?.import?.bidsReviewConfirmed).toBe(true);
    });

    // Should navigate to parameters
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("/parameters"));
  });

  it("confirmed BIDS project can access processing phase", () => {
    const project = makeBidsProject(true);
    expect(canAccessPhase(project, "processing")).toBe(true);
  });

  it("unconfirmed BIDS project cannot access processing phase", () => {
    const project = makeBidsProject(false);
    expect(canAccessPhase(project, "processing")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10.5 — Revisit import after confirmation (persisted summary + re-scan)
// ---------------------------------------------------------------------------

describe("BIDS-direct revisit import after confirmation", () => {
  it("renders persisted summary with re-scan action when bidsReviewConfirmed is true", async () => {
    seedBidsProject(true);

    // Pre-seed the import store with detected groups (as if scan was done previously)
    useImportStore.setState({
      bidsReview: {
        scanComplete: true,
        scanError: null,
        detectedGroups: [MOCK_GROUP],
        skippedSubjects: ["sub-UNK001_1"],
      },
    });

    // Revisit should not automatically call scan_bids_sidecars.
    mockInvoke.mockImplementation(() => Promise.resolve(null));

    renderWithProviders(<BIDSReviewPanel />);

    // Should show confirmed-summary banner
    await waitFor(() => {
      expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
    });

    // Should show skipped subjects warning
    expect(screen.getByText(/sub-UNK001_1/)).toBeInTheDocument();

    // Should NOT have a Confirm button until user explicitly re-scans.
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-scan bids/i })).toBeInTheDocument();

    // Should NOT invoke scan_bids_sidecars before the explicit re-scan action.
    expect(mockInvoke).not.toHaveBeenCalledWith("scan_bids_sidecars", expect.anything());
  });

  it("explicit re-scan renders editable review and can re-confirm", async () => {
    seedBidsProject(true);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "scan_bids_sidecars")
        return Promise.resolve({
          groups: [{ ...MOCK_GROUP, label: "Updated_Label" }],
          skipped: ["sub-NEW_1"],
        });
      return Promise.resolve(null);
    });

    renderWithProviders(<BIDSReviewPanel />);

    await userEvent.click(screen.getByRole("button", { name: /re-scan bids/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Updated_Label")).toBeInTheDocument();
    });
    expect(screen.getByText("sub-NEW_1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      const project = useProjectStore.getState().project;
      expect(project?.mappingState.subjectRows).toHaveLength(25);
      expect(project?.uiState?.import?.skippedSubjects).toEqual(["sub-NEW_1"]);
    });
  });
});
