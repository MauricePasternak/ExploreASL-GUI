import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import DicomIngestion from "./DicomIngestion";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";

function renderWithProviders() {
  return render(
    <MantineProvider>
      <DicomIngestion />
    </MantineProvider>,
  );
}

/**
 * Mantine's Button component renders a hidden duplicate for loading
 * state measurement, so we use getAllByTestId and take the first.
 */
function getScanButton() {
  return screen.getAllByTestId("scan-dicoms-btn")[0];
}

function getBrowseButton() {
  return screen.getAllByRole("button", { name: /browse/i })[0];
}

afterEach(() => {
  useImportStore.getState().resetImport();
  useProjectStore.setState({
    project: null,
    isDirty: false,
    loaded: false,
  });
  vi.clearAllMocks();
});

describe("DicomIngestion", () => {
  it("renders the title and browse button", () => {
    renderWithProviders();
    expect(screen.getByText("DICOM Ingestion")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /browse/i })).toBeInTheDocument();
  });

  it("uses clinician-friendly copy with on-demand help", () => {
    renderWithProviders();

    expect(screen.getAllByText("Folder containing your scan files").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /what folder should i choose/i }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("How are your DICOM files organised?").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /what does this mean/i }).length).toBeGreaterThan(
      0,
    );
  });

  it("opens the folder picker in the project root", async () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-1",
          name: "Brain Study",
          rootPath: "/tmp/brain-study",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "import",
        },
        uiState: {},
        mappingState: {},
        exploreAslConfig: {
          sourcestructure: {},
          studyPar: {},
          dataPar: {},
        },
      },
      isDirty: false,
      loaded: true,
    });
    vi.mocked(open).mockResolvedValue(null);

    renderWithProviders();

    await userEvent.click(getBrowseButton());

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "/tmp/brain-study",
      }),
    );
  });

  it("renders the scan button (disabled without path)", () => {
    renderWithProviders();
    expect(getScanButton()).toBeDisabled();
  });

  it("enables scan button when path is set", () => {
    useImportStore.getState().setSourceDataPath("/data/project");
    renderWithProviders();
    expect(getScanButton()).not.toBeDisabled();
  });

  it("displays results after successful scan", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "walk_directory") {
        return Promise.resolve([
          "BAR/05022026_01/sernum-0001_ser-AAHead_Scout",
          "BAR/05022026_01/sernum-0018_ser-pcasl_3d_multiTI",
        ]);
      }
      return Promise.resolve(null);
    });

    useImportStore.getState().setSourceDataPath("/data/project/sourcedata");
    renderWithProviders();

    await userEvent.click(getScanButton());

    await waitFor(() => {
      // Use queryAllByText since Mantine may render duplicate elements
      const found = screen.queryAllByText(/Found 2 DICOM location/);
      expect(found.length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText(/Example for this pattern:/).length).toBeGreaterThan(0);
  });

  it("shows error when no DICOMs found", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "walk_directory") {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

    useImportStore.getState().setSourceDataPath("/data/empty");
    renderWithProviders();

    await userEvent.click(getScanButton());

    await waitFor(() => {
      expect(screen.getByText(/No DICOM/)).toBeInTheDocument();
    });
  });

  it("shows next button after successful scan", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "walk_directory") {
        return Promise.resolve(["BAR/05022026_01/scan1"]);
      }
      return Promise.resolve(null);
    });

    useImportStore.getState().setSourceDataPath("/data/project");
    renderWithProviders();

    await userEvent.click(getScanButton());

    await waitFor(() => {
      const nextButtons = screen.queryAllByText(/Next: Tokenize Paths/);
      expect(nextButtons.length).toBeGreaterThan(0);
    });
  });

  it("does not use hardcoded dark surfaces for pattern previews", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "walk_directory") {
        return Promise.resolve(["BAR/05022026_01/scan1"]);
      }
      return Promise.resolve(null);
    });

    useImportStore.getState().setSourceDataPath("/data/project");
    const { container } = renderWithProviders();

    await userEvent.click(getScanButton());

    await waitFor(() => {
      const found = screen.queryAllByText(/Found 1 DICOM location/);
      expect(found.length).toBeGreaterThan(0);
    });

    expect(container.innerHTML).not.toContain("mantine-color-dark-7");
  });
});
