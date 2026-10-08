import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import DicomIngestion from "./DicomIngestion";
import { acceptedImportSettings, useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import { projectFixture } from "../../test/projectFixtures";
import type { MappingState } from "../../generated/project/MappingState";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";
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

function seedProject(rootPath = "/tmp/brain-study", mapping: MappingState = {}) {
  const snapshot = projectFixture("project-1", "Brain Study", rootPath);
  snapshot.document.mappingState = mapping;
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useProjectStore.getState().acceptSnapshot(snapshot);
  activateProjectLease("project-1", rootPath);
}

afterEach(() => {
  cleanup();
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
  useImportStore.getState().resetImport();
  useProjectStore.setState({
    project: null,
    isDirty: false,
    loaded: false,
  });
  vi.clearAllMocks();
});

describe("DicomIngestion", () => {
  it.each(["scan", "scan-error", "browse", "relink"])(
    "discards stale %s work after same-project reactivation",
    async (action) => {
      const mapping = { sourceDataPath: "/source", rawPaths: ["sub-01/ASL"] };
      seedProject(undefined, mapping);
      if (action === "relink")
        useImportStore.setState({
          sourceAvailability: { status: "missing", savedPath: "/source", message: "Missing" },
        });
      let finish!: (value: unknown) => void;
      let fail!: (error: Error) => void;
      const pending = new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      vi.mocked(open).mockImplementation(() =>
        action === "browse"
          ? (pending as ReturnType<typeof open>)
          : Promise.resolve("/replacement"),
      );
      vi.mocked(invoke).mockImplementation(async (command) =>
        command === "walk_directory"
          ? pending
          : command === "inspect_source_path"
            ? {
                exists: true,
                readable: true,
                isDirectory: true,
                ownership: "external",
                absolutePath: "/replacement",
              }
            : null,
      );
      renderWithProviders();
      await userEvent.click(
        screen.getAllByTestId(
          action === "browse"
            ? "dicom-browse-btn"
            : action === "relink"
              ? "dicom-relink-btn"
              : "scan-dicoms-btn",
        )[0],
      );
      seedProject(undefined, mapping);
      useImportStore.getState().resetImport();
      const before = useImportStore.getState();
      if (action === "scan-error") fail(new Error("Old scan failed"));
      else finish(action === "browse" ? "/replacement" : ["sub-02/ASL"]);
      await waitFor(() => expect(useProjectStore.getState().pendingEdits).toBe(0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(invoke).not.toHaveBeenCalledWith("accept_project_edit", expect.anything());
      expect(acceptedImportSettings().rawPaths).toEqual(mapping.rawPaths);
      expect(useImportStore.getState()).toEqual(before);
      expect(screen.queryByTestId("dicom-scan-error")).not.toBeInTheDocument();
      expect(screen.queryByTestId("dicom-relink-confirm-btn")).not.toBeInTheDocument();
    },
  );

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
    const accepted = {
      ...projectFixture("project-1", "Brain Study", "/tmp/brain-study"),
      acceptedRevision: 1,
    };
    accepted.document.mappingState.sourceDataPath = "./sourcedata";
    vi.mocked(open).mockResolvedValue("/tmp/brain-study/sourcedata");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "accept_project_edit") return accepted;
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

    expect(acceptedImportSettings().sourceDataPath).toBe("./sourcedata");
  });

  it("stores an external selected source as absolute", async () => {
    seedProject();
    const accepted = {
      ...projectFixture("project-1", "Brain Study", "/tmp/brain-study"),
      acceptedRevision: 1,
    };
    accepted.document.mappingState.sourceDataPath = "/media/dicom";
    vi.mocked(open).mockResolvedValue("/media/dicom");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "accept_project_edit") return accepted;
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

    expect(acceptedImportSettings().sourceDataPath).toBe("/media/dicom");
  });

  it("scans the resolved source while storing source-relative raw entries", async () => {
    seedProject(undefined, { sourceDataPath: "./sourcedata" });
    const accepted = {
      ...projectFixture("project-1", "Brain Study", "/tmp/brain-study"),
      acceptedRevision: 1,
    };
    accepted.document.mappingState = {
      sourceDataPath: "./sourcedata",
      rawPaths: ["sub-01/ses-01/ASL"],
      pathPatterns: discoverPathPatterns(["sub-01/ses-01/ASL"], "", ["_"]),
      ingestionComplete: true,
    };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "accept_project_edit") return accepted;
      if (command === "walk_directory") {
        return ["sub-01/ses-01/ASL"];
      }
      return null;
    });

    renderWithProviders();
    await userEvent.click(getScanButton());
    await waitFor(() => expect(acceptedImportSettings().rawPaths).toHaveLength(1));

    expect(invoke).toHaveBeenCalledWith("walk_directory", {
      root: "/tmp/brain-study/sourcedata",
      maxDepth: 20,
      bMatchDirectories: true,
    });
    expect(acceptedImportSettings().rawPaths).toEqual(["sub-01/ses-01/ASL"]);
  });

  it("shows a persistent missing-source warning and disables scanning", async () => {
    seedProject(undefined, { sourceDataPath: "/missing/dicom", tokenizerConfigs: { saved: [] } });
    vi.mocked(invoke).mockResolvedValueOnce({
      absolutePath: "/missing/dicom",
      exists: false,
      readable: false,
      isDirectory: false,
      ownership: "missing",
      projectRelativePath: null,
    });
    await useImportStore.getState().inspectSourceAvailability();
    expect(acceptedImportSettings()).toMatchObject({
      sourceDataPath: "/missing/dicom",
      tokenizerConfigs: { saved: [] },
    });

    renderWithProviders();

    expect(screen.getByTestId("dicom-missing-source-warning")).toHaveTextContent(
      "Saved DICOM source is unavailable. Relink it before scanning or importing.",
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
    seedProject(undefined, {
      sourceDataPath: "/missing/dicom",
      rawPaths,
      pathPatterns: patterns,
      tokenizerConfigs: { [patterns[0].signature]: [] },
    });
    const accepted = {
      ...projectFixture("project-1", "Brain Study", "/tmp/brain-study"),
      acceptedRevision: 1,
    };
    accepted.document.mappingState = {
      sourceDataPath: "/replacement/dicom",
      rawPaths,
      pathPatterns: patterns,
      tokenizerConfigs: { [patterns[0].signature]: [] },
    };
    useImportStore.setState({
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing/dicom",
        message: "Source missing.",
      },
    });
    vi.mocked(open).mockResolvedValue("/replacement/dicom");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "accept_project_edit") return accepted;
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
    await waitFor(() => expect(acceptedImportSettings().sourceDataPath).toBe("/replacement/dicom"));

    expect(acceptedImportSettings().tokenizerConfigs).toEqual({ [patterns[0].signature]: [] });
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());
  });

  it("leaves source and setup unchanged when DICOM relink selection is cancelled", async () => {
    seedProject(undefined, {
      sourceDataPath: "/missing/dicom",
      rawPaths: ["sub-01/ASL"],
      tokenizerConfigs: { saved: [] },
    });
    useImportStore.setState({
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing/dicom",
        message: "Source missing.",
      },
    });
    vi.mocked(open).mockResolvedValue(null);
    const before = {
      sourceDataPath: acceptedImportSettings().sourceDataPath,
      rawPaths: acceptedImportSettings().rawPaths,
      tokenizerConfigs: acceptedImportSettings().tokenizerConfigs,
    };

    renderWithProviders();
    await userEvent.click(screen.getByTestId("dicom-relink-btn"));

    expect(acceptedImportSettings()).toMatchObject(before);
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("requires confirmation before resetting incompatible source setup", async () => {
    seedProject();
    const savedPaths = ["sub-01/ses-01/ASL"];
    const savedPatterns = discoverPathPatterns(savedPaths, "", ["_"]);
    seedProject(undefined, {
      sourceDataPath: "/missing/dicom",
      rawPaths: savedPaths,
      pathPatterns: savedPatterns,
      tokenizerConfigs: { saved: [] },
      metadataGroups: [{ id: "group", label: "Group", bidsParams: {} }],
    });
    const accepted = {
      ...projectFixture("project-1", "Brain Study", "/tmp/brain-study"),
      acceptedRevision: 1,
    };
    accepted.document.mappingState = {
      sourceDataPath: "/replacement/dicom",
      rawPaths: ["different/structure/scan"],
      pathPatterns: discoverPathPatterns(["different/structure/scan"], "", ["_"]),
      ingestionComplete: true,
    };
    accepted.document.uiState.import = { mostRecentConfig: null, activeStep: 0 };
    useImportStore.setState({
      sourceAvailability: {
        status: "missing",
        savedPath: "/missing/dicom",
        message: "Source missing.",
      },
    });
    vi.mocked(open).mockResolvedValue("/replacement/dicom");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "accept_project_edit") return accepted;
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

    const mounted = renderWithProviders();
    await userEvent.click(screen.getByTestId("dicom-relink-btn"));
    expect(await screen.findByTestId("dicom-relink-mismatch-dialog")).toBeInTheDocument();
    expect(acceptedImportSettings().sourceDataPath).toBe("/missing/dicom");

    activateProjectLease("project-1", "/tmp/brain-study");
    await userEvent.click(screen.getByTestId("dicom-relink-confirm-btn"));
    expect(invoke).not.toHaveBeenCalledWith("accept_project_edit", expect.anything());
    expect(acceptedImportSettings().sourceDataPath).toBe("/missing/dicom");
    mounted.unmount();
    renderWithProviders();
    await userEvent.click(screen.getByTestId("dicom-relink-btn"));

    await userEvent.click(await screen.findByTestId("dicom-relink-confirm-btn"));
    expect(acceptedImportSettings()).toMatchObject({
      sourceDataPath: "/replacement/dicom",
      tokenizerConfigs: {},
      metadataGroups: [],
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());
  });

  it("preserves complete setup when an incompatible relink is declined", async () => {
    seedProject();
    const savedPaths = ["sub-01/ses-01/ASL"];
    const savedPatterns = discoverPathPatterns(savedPaths, "", ["_"]);
    seedProject(undefined, {
      sourceDataPath: "/missing/dicom",
      rawPaths: savedPaths,
      pathPatterns: savedPatterns,
      tokenizerConfigs: { saved: [] },
    });
    useImportStore.setState({
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

    expect(acceptedImportSettings()).toMatchObject({
      sourceDataPath: "/missing/dicom",
      rawPaths: savedPaths,
      pathPatterns: savedPatterns,
      tokenizerConfigs: { saved: [] },
    });
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("renders the scan button (disabled without path)", () => {
    renderWithProviders();
    expect(getScanButton()).toBeDisabled();
  });

  it("enables scan button when path is set", () => {
    seedProject(undefined, { sourceDataPath: "/data/project" });
    renderWithProviders();
    expect(getScanButton()).not.toBeDisabled();
  });

  it("displays results after successful scan", async () => {
    seedProject(undefined, { sourceDataPath: "/data/project/sourcedata" });
    const accepted = {
      ...projectFixture("project-1", "Brain Study", "/tmp/brain-study"),
      acceptedRevision: 1,
    };
    const paths = [
      "BAR/05022026_01/sernum-0001_ser-AAHead_Scout",
      "BAR/05022026_01/sernum-0018_ser-pcasl_3d_multiTI",
    ];
    accepted.document.mappingState = {
      sourceDataPath: "/data/project/sourcedata",
      rawPaths: paths,
      pathPatterns: discoverPathPatterns(paths, "", ["_"]),
      ingestionComplete: true,
    };
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "accept_project_edit") return Promise.resolve(accepted);
      if (cmd === "walk_directory") {
        return Promise.resolve([
          "BAR/05022026_01/sernum-0001_ser-AAHead_Scout",
          "BAR/05022026_01/sernum-0018_ser-pcasl_3d_multiTI",
        ]);
      }
      return Promise.resolve(null);
    });

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
    seedProject(undefined, { sourceDataPath: "/data/empty" });
    const accepted = {
      ...projectFixture("project-1", "Brain Study", "/tmp/brain-study"),
      acceptedRevision: 1,
    };
    accepted.document.mappingState = {
      sourceDataPath: "/data/empty",
      rawPaths: [],
      pathPatterns: [],
      ingestionComplete: false,
    };
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "accept_project_edit") return Promise.resolve(accepted);
      if (cmd === "walk_directory") {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

    renderWithProviders();

    await userEvent.click(getScanButton());

    await waitFor(() => {
      expect(screen.getByText(/No DICOM/)).toBeInTheDocument();
    });
  });

  it("shows next button after successful scan", async () => {
    seedProject(undefined, { sourceDataPath: "/data/project" });
    const accepted = {
      ...projectFixture("project-1", "Brain Study", "/tmp/brain-study"),
      acceptedRevision: 1,
    };
    accepted.document.mappingState = {
      sourceDataPath: "/data/project",
      rawPaths: ["BAR/05022026_01/scan1"],
      pathPatterns: discoverPathPatterns(["BAR/05022026_01/scan1"], "", ["_"]),
      ingestionComplete: true,
    };
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "accept_project_edit") return Promise.resolve(accepted);
      if (cmd === "walk_directory") {
        return Promise.resolve(["BAR/05022026_01/scan1"]);
      }
      return Promise.resolve(null);
    });

    renderWithProviders();

    await userEvent.click(getScanButton());

    await waitFor(() => {
      const nextButtons = screen.queryAllByText(/Next: Tokenize Paths/);
      expect(nextButtons.length).toBeGreaterThan(0);
    });
  });

  it("does not use hardcoded dark surfaces for pattern previews", async () => {
    seedProject(undefined, { sourceDataPath: "/data/project" });
    const accepted = {
      ...projectFixture("project-1", "Brain Study", "/tmp/brain-study"),
      acceptedRevision: 1,
    };
    accepted.document.mappingState = {
      sourceDataPath: "/data/project",
      rawPaths: ["BAR/05022026_01/scan1"],
      pathPatterns: discoverPathPatterns(["BAR/05022026_01/scan1"], "", ["_"]),
      ingestionComplete: true,
    };
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "accept_project_edit") return Promise.resolve(accepted);
      if (cmd === "walk_directory") {
        return Promise.resolve(["BAR/05022026_01/scan1"]);
      }
      return Promise.resolve(null);
    });

    const { container } = renderWithProviders();

    await userEvent.click(getScanButton());

    await waitFor(() => {
      const found = screen.queryAllByText(/Found 1 DICOM location/);
      expect(found.length).toBeGreaterThan(0);
    });

    expect(container.innerHTML).not.toContain("mantine-color-dark-7");
  });
});
