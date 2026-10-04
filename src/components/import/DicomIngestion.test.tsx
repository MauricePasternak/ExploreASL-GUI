import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import DicomIngestion from "./DicomIngestion";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import { discoverPathPatterns } from "../../lib/pathUtils";

function renderWithProviders() {
  return render(
    <MantineProvider env="test">
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

function seedProject(rootPath = "/tmp/brain-study") {
  useProjectStore.setState({
    project: {
      version: "0.1.0",
      projectMeta: {
        id: "project-1",
        name: "Brain Study",
        rootPath,
        createdAt: "2026-05-03T00:00:00.000Z",
        lastOpened: "2026-05-03T00:00:00.000Z",
        currentPhase: "import",
        dataSource: "dicom",
      },
      uiState: {},
      mappingState: {},
      dataPar: {},
    },
    isDirty: false,
    loaded: true,
  });
}

afterEach(() => {
  cleanup();
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
    seedProject();
    vi.mocked(open).mockResolvedValue(null);

    renderWithProviders();

    await userEvent.click(getBrowseButton());

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "/tmp/brain-study",
      }),
    );
  });

  it("stores an internal selected source as project-relative", async () => {
    seedProject();
    vi.mocked(open).mockResolvedValue("/tmp/brain-study/sourcedata");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "inspect_source_path") {
        return {
          absolutePath: "/tmp/brain-study/sourcedata",
          exists: true,
          readable: true,
          isDirectory: true,
          ownership: "internal",
          projectRelativePath: "./sourcedata",
        };
      }
      return null;
    });

    renderWithProviders();
    await userEvent.click(getBrowseButton());

    expect(useImportStore.getState().sourceDataPath).toBe("./sourcedata");
  });

  it("stores an external selected source as absolute", async () => {
    seedProject();
    vi.mocked(open).mockResolvedValue("/media/dicom");
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

    renderWithProviders();
    await userEvent.click(getBrowseButton());

    expect(useImportStore.getState().sourceDataPath).toBe("/media/dicom");
  });

  it("scans the resolved source while storing source-relative raw entries", async () => {
    seedProject();
    useImportStore.getState().setSourceDataPath("./sourcedata");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "walk_directory") {
        return ["sub-01/ses-01/ASL"];
      }
      return null;
    });

    renderWithProviders();
    await userEvent.click(getScanButton());
    await waitFor(() => expect(useImportStore.getState().rawPaths).toHaveLength(1));

    expect(invoke).toHaveBeenCalledWith("walk_directory", {
      root: "/tmp/brain-study/sourcedata",
      maxDepth: 20,
      bMatchDirectories: true,
    });
    expect(useImportStore.getState().rawPaths).toEqual(["sub-01/ses-01/ASL"]);
  });

  it("shows a persistent missing-source warning and disables scanning", () => {
    seedProject();
    useImportStore.setState({
      sourceDataPath: "/missing/dicom",
      sourceAvailability: {
        status: "ambiguous",
        savedPath: "/missing/dicom",
        message: "Relink this legacy source explicitly.",
      },
    });

    renderWithProviders();

    expect(screen.getByTestId("dicom-missing-source-warning")).toHaveTextContent(
      "Relink this legacy source explicitly.",
    );
    expect(screen.getByTestId("dicom-missing-source-path")).toHaveTextContent("/missing/dicom");
    expect(screen.getByTestId("dicom-relink-btn")).toBeInTheDocument();
    expect(screen.getByTestId("dicom-browse-btn")).toBeDisabled();
    expect(getScanButton()).toBeDisabled();
  });

  it("preserves setup when relinking a structurally compatible source", async () => {
    seedProject();
    const rawPaths = ["sub-01/ses-01/ASL"];
    const patterns = discoverPathPatterns(rawPaths, "", ["_"]);
    useImportStore.setState({
      sourceDataPath: "/missing/dicom",
      rawPaths,
      pathPatterns: patterns,
      tokenizerConfigs: { [patterns[0].signature]: [] },
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing/dicom",
        message: "Source missing.",
      },
    });
    vi.mocked(open).mockResolvedValue("/replacement/dicom");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "inspect_source_path") {
        return {
          absolutePath: "/replacement/dicom",
          exists: true,
          readable: true,
          isDirectory: true,
          ownership: "external",
          projectRelativePath: null,
        };
      }
      if (command === "walk_directory") return rawPaths;
      return null;
    });

    renderWithProviders();
    await userEvent.click(screen.getByTestId("dicom-relink-btn"));
    await waitFor(() =>
      expect(useImportStore.getState().sourceDataPath).toBe("/replacement/dicom"),
    );

    expect(useImportStore.getState().tokenizerConfigs).toEqual({ [patterns[0].signature]: [] });
    expect(useImportStore.getState().requiresManualSave).toBe(true);
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());
  });

  it("leaves source and setup unchanged when DICOM relink selection is cancelled", async () => {
    seedProject();
    useImportStore.setState({
      sourceDataPath: "/missing/dicom",
      rawPaths: ["sub-01/ASL"],
      tokenizerConfigs: { saved: [] },
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing/dicom",
        message: "Source missing.",
      },
    });
    vi.mocked(open).mockResolvedValue(null);
    const before = {
      sourceDataPath: useImportStore.getState().sourceDataPath,
      rawPaths: useImportStore.getState().rawPaths,
      tokenizerConfigs: useImportStore.getState().tokenizerConfigs,
    };

    renderWithProviders();
    await userEvent.click(screen.getByTestId("dicom-relink-btn"));

    expect(useImportStore.getState()).toMatchObject(before);
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("requires confirmation before resetting incompatible source setup", async () => {
    seedProject();
    const savedPaths = ["sub-01/ses-01/ASL"];
    const savedPatterns = discoverPathPatterns(savedPaths, "", ["_"]);
    useImportStore.setState({
      sourceDataPath: "/missing/dicom",
      rawPaths: savedPaths,
      pathPatterns: savedPatterns,
      tokenizerConfigs: { saved: [] },
      metadataGroups: [{ id: "group", label: "Group", bidsParams: {} }],
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing/dicom",
        message: "Source missing.",
      },
    });
    vi.mocked(open).mockResolvedValue("/replacement/dicom");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "inspect_source_path") {
        return {
          absolutePath: "/replacement/dicom",
          exists: true,
          readable: true,
          isDirectory: true,
          ownership: "external",
          projectRelativePath: null,
        };
      }
      if (command === "walk_directory") return ["different/structure/scan"];
      return null;
    });

    renderWithProviders();
    await userEvent.click(screen.getByTestId("dicom-relink-btn"));
    expect(await screen.findByTestId("dicom-relink-mismatch-dialog")).toBeInTheDocument();
    expect(useImportStore.getState().sourceDataPath).toBe("/missing/dicom");

    await userEvent.click(await screen.findByTestId("dicom-relink-confirm-btn"));
    expect(useImportStore.getState()).toMatchObject({
      sourceDataPath: "/replacement/dicom",
      tokenizerConfigs: {},
      metadataGroups: [],
      activeStep: 0,
      requiresManualSave: true,
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());
  });

  it("preserves complete setup when an incompatible relink is declined", async () => {
    seedProject();
    const savedPaths = ["sub-01/ses-01/ASL"];
    const savedPatterns = discoverPathPatterns(savedPaths, "", ["_"]);
    useImportStore.setState({
      sourceDataPath: "/missing/dicom",
      rawPaths: savedPaths,
      pathPatterns: savedPatterns,
      tokenizerConfigs: { saved: [] },
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing/dicom",
        message: "Source missing.",
      },
    });
    vi.mocked(open).mockResolvedValue("/replacement/dicom");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "inspect_source_path") {
        return {
          absolutePath: "/replacement/dicom",
          exists: true,
          readable: true,
          isDirectory: true,
          ownership: "external",
          projectRelativePath: null,
        };
      }
      if (command === "walk_directory") return ["different/scan"];
      return null;
    });

    renderWithProviders();
    await userEvent.click(screen.getByTestId("dicom-relink-btn"));
    await userEvent.click(await screen.findByTestId("dicom-relink-cancel-btn"));

    expect(useImportStore.getState()).toMatchObject({
      sourceDataPath: "/missing/dicom",
      rawPaths: savedPaths,
      pathPatterns: savedPatterns,
      tokenizerConfigs: { saved: [] },
      requiresManualSave: false,
    });
    expect(useProjectStore.getState().isDirty).toBe(false);
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
