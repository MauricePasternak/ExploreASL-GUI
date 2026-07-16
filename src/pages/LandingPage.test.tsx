import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { notifications } from "@mantine/notifications";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router";

import { PROJECT_FILE_NAME } from "../schemas/project";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import {
  seedInvalidProfileGate,
  seedValidProfileGate,
  seedZeroProfilesGate,
} from "../test/landingProfileGate";
import { makeMatlabProfile } from "../test/profileFixtures";
import LandingPage from "./LandingPage";

describe("LandingPage", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    seedValidProfileGate();
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
    });
    vi.mocked(open).mockResolvedValue(null);
    vi.mocked(exists).mockResolvedValue(false);
    vi.mocked(invoke).mockResolvedValue(true);
  });

  it("renders the primary landing actions", async () => {
    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { name: /welcome to exploreasl/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open project/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/no recent projects/i)).toBeInTheDocument();
    });
  });

  it("rejects project creation when the selected directory is not writable", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/no-write");
    vi.mocked(invoke).mockResolvedValue(false);

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("is_writable", { path: "/tmp/no-write" });
      expect(createProject).not.toHaveBeenCalled();
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
        }),
      );
    });
  });

  it("rejects project creation when an easl file already exists", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/existing-project");
    vi.mocked(invoke).mockResolvedValue(true);
    vi.mocked(exists).mockImplementation(async (path) => {
      return path === `/tmp/existing-project/${PROJECT_FILE_NAME}`;
    });

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(createProject).not.toHaveBeenCalled();
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: expect.stringMatching(/project exists/i),
        }),
      );
    });
  });

  it("shows an error when project creation fails unexpectedly", async () => {
    const createProject = vi.fn().mockRejectedValue(new Error("write failed"));
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/new-project");
    vi.mocked(invoke).mockResolvedValue(true);

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/new-project", "new-project", {
        dataSource: "dicom",
      });
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: expect.stringMatching(/failed to create project/i),
        }),
      );
    });
  });

  it("shows WelcomeCard when no execution profiles are configured", () => {
    seedZeroProfilesGate();

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage onOpenSettings={vi.fn()} />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByTestId("welcome-card")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-new-project-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("landing-open-project-btn")).not.toBeInTheDocument();
  });

  it("calls onOpenSettings from WelcomeCard", () => {
    seedZeroProfilesGate();
    const onOpenSettings = vi.fn();

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage onOpenSettings={onOpenSettings} />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getByTestId("welcome-open-settings-btn"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("disables project actions when all profiles are invalid", async () => {
    seedInvalidProfileGate();

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByTestId("landing-invalid-profiles-alert")).toBeInTheDocument();
    expect(screen.getByTestId("landing-new-project-btn")).toBeDisabled();
    expect(screen.getByTestId("landing-open-project-btn")).toBeDisabled();
  });

  it("disables recent project open buttons when all profiles are invalid", async () => {
    const profile = makeMatlabProfile();
    seedInvalidProfileGate(profile);
    useGlobalStore.setState((state) => ({
      settings: {
        ...state.settings,
        recentProjects: ["/tmp/recent/project.easl"],
      },
    }));
    vi.mocked(exists).mockResolvedValue(true);

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("landing-recent-projects-list")).toBeInTheDocument();
    });

    const openBtn = screen.getByTestId("recent-open-btn--tmp-recent-project-easl");
    expect(openBtn).toBeDisabled();
  });

  it("rejects opening easl files that are not named project.easl", async () => {
    const loadProject = vi.fn().mockRejectedValue(new Error("Expected project.easl"));
    useProjectStore.setState({ loadProject });
    vi.mocked(open).mockResolvedValue("/tmp/custom-name.easl");

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /open project/i })[0]);

    await waitFor(() => {
      expect(loadProject).toHaveBeenCalledWith("/tmp/custom-name.easl");
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: expect.stringMatching(/invalid project file/i),
        }),
      );
    });
  });
});

describe("LandingPage BIDS detection dialogs", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    seedValidProfileGate();
    useProjectStore.setState({ project: null, isDirty: false, loaded: false });
    vi.mocked(open).mockResolvedValue(null);
    vi.mocked(exists).mockResolvedValue(false);
  });

  function renderLanding() {
    return render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );
  }

  const BASE_BIDS_RESULT = {
    isBids: true,
    hasDatasetDescription: true,
    datasetDescError: null,
    bidsVersion: "1.0.2",
    aslSubjectCount: 25,
    aslSessionCount: 25,
    totalSubjectCount: 25,
    missingSidecars: [] as string[],
    missingAslcontextCount: 0,
    hasPerfDirectory: true,
    isCrossSectional: true,
    error: null,
  };

  it("shows BIDS detection dialog when a valid BIDS folder is picked", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/bids-dataset");

    // invoke: is_writable → true, check_bids_dataset → BIDS result
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") return BASE_BIDS_RESULT;
      return true;
    });

    renderLanding();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-detection-dialog")).toBeInTheDocument();
    });

    // Verify dialog content
    expect(screen.getByText(/ASL subjects:/i)).toBeInTheDocument();
    expect(screen.getByTestId("bids-detection-dialog-skip-radio")).toBeInTheDocument();
    expect(screen.getByTestId("bids-detection-dialog-dicom-radio")).toBeInTheDocument();
    expect(screen.getByTestId("bids-detection-dialog-continue-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-detection-dialog-cancel-btn")).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("creates BIDS project when user selects Skip Import and clicks Continue", async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/bids-dataset");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") return BASE_BIDS_RESULT;
      return true;
    });

    renderLanding();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-detection-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("bids-detection-dialog-skip-radio"));

    // Now set the project so navigation works
    const fakeProject = {
      projectMeta: { id: "proj-1", currentPhase: "import" },
    };
    useProjectStore.setState({ project: fakeProject as any });

    fireEvent.click(screen.getByTestId("bids-detection-dialog-continue-btn"));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/bids-dataset", "bids-dataset", {
        dataSource: "bids",
      });
    });
  });

  it("creates DICOM project when user selects Import from DICOM and clicks Continue", async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/bids-dataset");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") return BASE_BIDS_RESULT;
      return true;
    });

    renderLanding();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-detection-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("bids-detection-dialog-dicom-radio"));

    const fakeProject = {
      projectMeta: { id: "proj-1", currentPhase: "import" },
    };
    useProjectStore.setState({ project: fakeProject as any });

    fireEvent.click(screen.getByTestId("bids-detection-dialog-continue-btn"));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/bids-dataset", "bids-dataset", {
        dataSource: "dicom",
      });
    });
  });

  it("shows error dialog when no BIDS subjects found", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open)
      .mockResolvedValueOnce("/tmp/empty-folder")
      .mockResolvedValueOnce("/tmp/another-folder");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") {
        return {
          ...BASE_BIDS_RESULT,
          isBids: false,
          aslSubjectCount: 0,
          totalSubjectCount: 0,
          error: "No BIDS subjects found",
        };
      }
      return true;
    });

    renderLanding();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-no-subjects-dialog")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bids-no-subjects-choose-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-no-subjects-cancel-btn")).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("shows error dialog when subjects exist but no ASL data found, and cancel dismisses it", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/no-asl");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") {
        return {
          ...BASE_BIDS_RESULT,
          isBids: false,
          aslSubjectCount: 0,
          totalSubjectCount: 5,
          error: "No valid ASL BIDS data found",
        };
      }
      return true;
    });

    renderLanding();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-no-asl-dialog")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bids-no-asl-choose-btn")).toBeInTheDocument();

    // Click cancel button
    fireEvent.click(screen.getByTestId("bids-no-asl-cancel-btn"));
    await waitFor(() => {
      expect(screen.queryByTestId("bids-no-asl-choose-btn")).not.toBeInTheDocument();
    });

    expect(createProject).not.toHaveBeenCalled();
  });

  it("shows corrupt dataset_description warning dialog when ASL data is present", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/corrupt-desc");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") {
        return {
          ...BASE_BIDS_RESULT,
          isBids: true,
          datasetDescError: "Unexpected token at line 3",
          aslSubjectCount: 12,
        };
      }
      return true;
    });

    renderLanding();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-corrupt-desc-dialog")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bids-corrupt-desc-skip-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-corrupt-desc-cancel-btn")).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("Cancel dismisses the dialog without creating a project", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/bids-dataset");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") return BASE_BIDS_RESULT;
      return true;
    });

    renderLanding();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-detection-dialog")).toBeInTheDocument();
    });

    // Verify the dialog is showing content
    expect(screen.getByTestId("bids-detection-dialog-skip-radio")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("bids-detection-dialog-cancel-btn"));

    // After cancel, bidsDialog state is reset — the dialog body content is removed
    // (Mantine Modal unmounts children when opened transitions to false)
    await waitFor(() => {
      expect(screen.queryByTestId("bids-detection-dialog-skip-radio")).not.toBeInTheDocument();
    });
    expect(createProject).not.toHaveBeenCalled();
  });

  it("shows missing aslcontext warning when missing_aslcontext_count > 0", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/bids-dataset");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") {
        return { ...BASE_BIDS_RESULT, missingAslcontextCount: 3 };
      }
      return true;
    });

    renderLanding();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-detection-dialog")).toBeInTheDocument();
    });

    // The warning is rendered inside the dialog — check it exists
    const dialog = screen.getByTestId("bids-detection-dialog");
    expect(dialog.textContent).toMatch(/3.*session.*skip/i);
  });

  it("disables BIDS and allows DICOM import confirm when no BIDS subjects are found", async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/no-subjects");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") {
        return {
          ...BASE_BIDS_RESULT,
          isBids: false,
          aslSubjectCount: 0,
          totalSubjectCount: 0,
          error: "No BIDS subjects found",
        };
      }
      return true;
    });

    renderLanding();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-no-subjects-dialog")).toBeInTheDocument();
    });

    const skipRadio = screen.getByTestId("bids-detection-dialog-skip-radio");
    const dicomRadio = screen.getByTestId("bids-detection-dialog-dicom-radio");
    expect(skipRadio).toBeDisabled();
    expect(dicomRadio).not.toBeDisabled();
    expect(dicomRadio).toBeChecked(); // should be auto-selected

    const confirmBtn = screen.getByTestId("bids-no-subjects-confirm-btn");
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/no-subjects", "no-subjects", {
        dataSource: "dicom",
      });
    });
  });

  it("disables BIDS and allows DICOM import confirm when subjects exist but no ASL data is found", async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/no-asl");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") {
        return {
          ...BASE_BIDS_RESULT,
          isBids: false,
          aslSubjectCount: 0,
          totalSubjectCount: 5,
          error: "No valid ASL BIDS data found",
        };
      }
      return true;
    });

    renderLanding();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-no-asl-dialog")).toBeInTheDocument();
    });

    const skipRadio = screen.getByTestId("bids-detection-dialog-skip-radio");
    const dicomRadio = screen.getByTestId("bids-detection-dialog-dicom-radio");
    expect(skipRadio).toBeDisabled();
    expect(dicomRadio).not.toBeDisabled();
    expect(dicomRadio).toBeChecked(); // should be auto-selected

    const confirmBtn = screen.getByTestId("bids-no-asl-confirm-btn");
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/no-asl", "no-asl", {
        dataSource: "dicom",
      });
    });
  });

  it("opens file pickers in OS home directory when there are no recent projects", async () => {
    useGlobalStore.setState({
      settings: {
        ...useGlobalStore.getState().settings,
        recentProjects: [],
      },
    });

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    // Trigger New Project
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({
          directory: true,
          defaultPath: "/home/testuser",
        }),
      );
    });

    // Trigger Open Project
    fireEvent.click(screen.getAllByRole("button", { name: /open project/i })[0]);
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: [{ name: "ExploreASL Project", extensions: ["easl"] }],
          defaultPath: "/home/testuser",
        }),
      );
    });
  });

  it("opens file pickers in the most recent project location when recent projects are configured", async () => {
    useGlobalStore.setState({
      settings: {
        ...useGlobalStore.getState().settings,
        recentProjects: ["/tmp/brain-study/project.easl"],
      },
    });

    // Mock exists to return true for the recent project path and directory
    vi.mocked(exists).mockImplementation(async (path) => {
      return path === "/tmp/brain-study/project.easl" || path === "/tmp/brain-study";
    });

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    // Trigger New Project (uses parent directory)
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({
          directory: true,
          defaultPath: "/tmp/brain-study",
        }),
      );
    });

    // Trigger Open Project (uses full path if exists)
    fireEvent.click(screen.getAllByRole("button", { name: /open project/i })[0]);
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: [{ name: "ExploreASL Project", extensions: ["easl"] }],
          defaultPath: "/tmp/brain-study/project.easl",
        }),
      );
    });
  });
});
