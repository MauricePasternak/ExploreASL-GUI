import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { notifications } from "@mantine/notifications";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestMantineProvider as MantineProvider } from "../test/render";
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
import { ProjectStorageError } from "../lib/projectPersistence";
import { showErrorNotification } from "../lib/errorNotifications";
import LandingPage from "./LandingPage";
import { projectFixture } from "../test/projectFixtures";
import { projectView } from "../schemas/project";

vi.mock("../lib/errorNotifications", () => ({ showErrorNotification: vi.fn() }));

const inspection = {
  candidateId: "candidate",
  projectId: "same-id",
  name: "Identity Project",
  rootPath: "/new",
  recoveredFromBackup: false,
  duplicatePath: null as string | null,
  movedFrom: null,
  setupRecovered: 0,
};

function renderPage(props: { onOpenSettings?: () => void } = {}) {
  return render(
    <MantineProvider env="test">
      <MemoryRouter>
        <LandingPage {...props} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe("LandingPage", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    seedValidProfileGate();
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
    });
    vi.mocked(open).mockResolvedValue(null);
    vi.mocked(exists).mockResolvedValue(false);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "inspect_project") return inspection;
      if (command === "is_writable") return true;
      throw new Error(`Unexpected command ${command}`);
    });
  });

  it("renders the primary landing actions", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: /welcome to exploreasl/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open project/i })).toBeInTheDocument();
    expect(screen.getByTestId("landing-new-project-btn")).toHaveTextContent("Choose folder");
    expect(screen.getByTestId("landing-open-project-btn")).toHaveTextContent("Choose project file");
    expect(screen.getByRole("heading", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Open project" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/no recent projects/i)).toBeInTheDocument();
    });
  });

  it.each(["new", "open"])(
    "manual %s path retains normal validation without a native dialog",
    async (action) => {
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "is_writable") return false;
        throw new Error("Invalid project file");
      });
      renderPage();
      const testId = `landing-${action}-project-path`;
      fireEvent.click(screen.getByTestId(`landing-${action}-project-more`));
      fireEvent.click(await screen.findByTestId(testId));
      fireEvent.change(screen.getByTestId(`${testId}-input`), {
        target: { value: "/study/project.easl" },
      });
      fireEvent.click(screen.getByTestId(`${testId}-confirm`));
      await waitFor(() =>
        expect(showErrorNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            title: action === "new" ? "Directory not writable" : "Invalid project file",
          }),
        ),
      );
      expect(open).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith(
        action === "new" ? "is_writable" : "inspect_project",
        expect.objectContaining({ path: "/study/project.easl" }),
      );
    },
  );

  it("opens each manual-path menu by keyboard and restores split-button focus on Escape", async () => {
    const user = userEvent.setup();
    renderPage();

    for (const action of ["new", "open"]) {
      const trigger = screen.getByTestId(`landing-${action}-project-more`);
      const testId = `landing-${action}-project-path`;
      trigger.focus();
      await user.keyboard("{Enter}");
      expect(await screen.findByTestId(testId)).toHaveTextContent(
        action === "new" ? "Enter folder path…" : "Enter project file path…",
      );
      await user.keyboard("{ArrowDown}{Enter}");
      await waitFor(() => expect(screen.getByTestId(`${testId}-input`)).toHaveFocus());
      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByTestId(`${testId}-dialog`)).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
      });
    }
    expect(open).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects project creation when the selected directory is not writable", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/no-write");
    vi.mocked(invoke).mockResolvedValue(false);

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("is_writable", { path: "/tmp/no-write" });
      expect(createProject).not.toHaveBeenCalled();
      expect(showErrorNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "project-create:/tmp/no-write",
          title: "Directory not writable",
          details: expect.stringContaining("permissions"),
        }),
      );
    });
  });

  it("discloses prior setup recovery before rejecting an existing project", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/existing-project");
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "check_bids_dataset" ? { setupRecovered: 1 } : true,
    );
    vi.mocked(exists).mockImplementation(async (path) => {
      return path === `/tmp/existing-project/${PROJECT_FILE_NAME}`;
    });

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(createProject).not.toHaveBeenCalled();
      expect(notifications.show).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          title: "Prior setup recovered",
          message: expect.stringContaining("1"),
        }),
      );
      expect(showErrorNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "project-create:/tmp/existing-project",
          title: expect.stringMatching(/project exists/i),
        }),
      );
    });
  });

  it("scopes repeated creation errors to the selected directory", async () => {
    vi.mocked(invoke).mockResolvedValue(false);
    renderPage();

    const directories = ["/first-project", "/second-project", "/first-project"];
    for (const [index, directory] of directories.entries()) {
      vi.mocked(open).mockResolvedValueOnce(directory);
      fireEvent.click(screen.getByTestId("landing-new-project-btn"));
      await waitFor(() => expect(showErrorNotification).toHaveBeenCalledTimes(index + 1));
    }

    expect(
      vi.mocked(showErrorNotification).mock.calls.map(([notification]) => notification.id),
    ).toEqual(directories.map((directory) => `project-create:${directory}`));
  });

  it("shows an error when project creation fails unexpectedly", async () => {
    const createProject = vi.fn().mockRejectedValue(new Error("write failed"));
    useProjectStore.setState({
      createProject,
      preflightProjectSetup: vi.fn(async (rootPath, _name, mode) => ({
        planId: "reviewed-plan",
        rootPath,
        mode,
        operations: [],
        warnings: [],
        conflicts: [],
        projectSummary: null,
        preservesReadme: true,
        temporaryArtifacts: [],
      })),
    });
    vi.mocked(open).mockResolvedValue("/tmp/new-project");
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "is_writable"
        ? true
        : {
            isBids: false,
            aslSubjectCount: 0,
            totalSubjectCount: 0,
            error: "No BIDS subjects found",
          },
    );

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);
    await waitFor(() =>
      expect(screen.getByTestId("bids-no-subjects-confirm-btn")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("bids-no-subjects-confirm-btn"));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/new-project", "new-project", {
        dataSource: "dicom",
        planId: "reviewed-plan",
      });
      expect(showErrorNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "project-create:/tmp/new-project",
          title: expect.stringMatching(/failed to create project/i),
          message: "Project files could not be initialized in the selected directory.",
          details: expect.stringContaining("free disk space"),
          error: expect.objectContaining({ message: "write failed" }),
        }),
      );
    });
  });

  it.each([
    {
      kind: "insufficient space",
      error: new ProjectStorageError("insufficient_space", "temporary write failed"),
      guidance: /free space/i,
    },
    {
      kind: "setup recovery required",
      error: Object.assign(new Error("Project setup requires recovery."), {
        kind: "recovery_required",
        details:
          "Keep the project files unchanged. Resolve the incomplete setup before trying again.",
      }),
      guidance: /Keep the project files unchanged/,
    },
  ])(
    "preserves actionable guidance for $kind during project creation",
    async ({ error, guidance }) => {
      const createProject = vi.fn().mockRejectedValue(error);
      useProjectStore.setState({
        createProject,
        preflightProjectSetup: vi.fn(async (rootPath, _name, mode) => ({
          planId: "reviewed-plan",
          rootPath,
          mode,
          operations: [],
          warnings: [],
          conflicts: [],
          projectSummary: null,
          preservesReadme: true,
          temporaryArtifacts: [],
        })),
      });
      vi.mocked(open).mockResolvedValue("/tmp/full-volume");
      vi.mocked(invoke).mockImplementation(async (command) =>
        command === "is_writable"
          ? true
          : {
              isBids: false,
              aslSubjectCount: 0,
              totalSubjectCount: 0,
              error: "No BIDS subjects found",
            },
      );

      renderPage();

      fireEvent.click(screen.getByTestId("landing-new-project-btn"));
      await waitFor(() =>
        expect(screen.getByTestId("bids-no-subjects-confirm-btn")).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByTestId("bids-no-subjects-confirm-btn"));

      await waitFor(() =>
        expect(showErrorNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "project-create:/tmp/full-volume",
            message: "Project files could not be initialized in the selected directory.",
            details: expect.stringMatching(guidance),
            error,
          }),
        ),
      );
    },
  );

  it("requires confirmation before opening a recovered backup and leaves it unwritten on decline", async () => {
    const confirmRecovery = vi.fn();
    const declineRecovery = vi.fn();
    useProjectStore.setState({
      loadProject: vi.fn(async () => {
        useProjectStore.setState({
          recovery: {
            ...inspection,
            copied: false,
            recoveredFromBackup: true,
            easlPath: "/tmp/recovery/project.easl",
            projectId: "recovered-project",
          },
        });
      }),
      confirmRecovery,
      declineRecovery,
    });
    vi.mocked(open).mockResolvedValue("/tmp/recovery/project.easl");

    renderPage();

    fireEvent.click(screen.getByTestId("landing-open-project-btn"));
    await waitFor(() => expect(screen.getByTestId("project-recovery-dialog")).toBeInTheDocument());
    expect(confirmRecovery).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("project-recovery-decline-btn"));
    expect(declineRecovery).toHaveBeenCalledOnce();
    expect(confirmRecovery).not.toHaveBeenCalled();
  });

  it("opens a recovered backup only after explicit confirmation", async () => {
    const confirmRecovery = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      loadProject: vi.fn(async () => {
        useProjectStore.setState({
          recovery: {
            ...inspection,
            copied: false,
            recoveredFromBackup: true,
            easlPath: "/tmp/recovery/project.easl",
            projectId: "recovered-project",
          },
        });
      }),
      confirmRecovery,
    });
    vi.mocked(open).mockResolvedValue("/tmp/recovery/project.easl");

    renderPage();

    fireEvent.click(screen.getByTestId("landing-open-project-btn"));
    await screen.findByTestId("project-recovery-dialog");
    fireEvent.click(screen.getByTestId("project-recovery-confirm-btn"));

    await waitFor(() => expect(confirmRecovery).toHaveBeenCalledOnce());
  });

  it("shows WelcomeCard when no execution profiles are configured", () => {
    seedZeroProfilesGate();

    renderPage({ onOpenSettings: vi.fn() });

    expect(screen.getByTestId("welcome-card")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-new-project-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("landing-open-project-btn")).not.toBeInTheDocument();
  });

  it("calls onOpenSettings from WelcomeCard", () => {
    seedZeroProfilesGate();
    const onOpenSettings = vi.fn();

    renderPage({ onOpenSettings });

    fireEvent.click(screen.getByTestId("welcome-open-settings-btn"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("disables project actions when all profiles are invalid", async () => {
    seedInvalidProfileGate();

    renderPage();

    expect(screen.getByTestId("landing-invalid-profiles-alert")).toBeInTheDocument();
    expect(screen.getByTestId("landing-new-project-btn")).toBeDisabled();
    expect(screen.getByTestId("landing-open-project-btn")).toBeDisabled();
    expect(screen.getByTestId("landing-new-project-more")).toBeDisabled();
    expect(screen.getByTestId("landing-open-project-more")).toBeDisabled();
  });

  it("disables recent project open buttons when all profiles are invalid", async () => {
    const profile = makeMatlabProfile();
    seedInvalidProfileGate(profile);
    useGlobalStore.setState((state) => ({
      settings: {
        ...state.settings,
        recentProjects: [{ path: "/tmp/recent/project.easl" }],
      },
    }));
    vi.mocked(exists).mockResolvedValue(true);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("landing-recent-projects-list")).toBeInTheDocument();
    });

    const openBtn = screen.getByTestId("recent-open-btn--tmp-recent-project-easl");
    expect(openBtn).toBeDisabled();
    expect(openBtn).toHaveAccessibleDescription("/tmp/recent/project.easl Available");
    expect(screen.getByTestId("recent-remove-btn--tmp-recent-project-easl")).toBeEnabled();
  });

  it("rejects opening easl files that are not named project.easl", async () => {
    const loadProject = vi.fn().mockRejectedValue(new Error("Expected project.easl"));
    useProjectStore.setState({ loadProject });
    vi.mocked(open).mockResolvedValue("/tmp/custom-name.easl");
    vi.mocked(invoke).mockRejectedValueOnce({ message: "Expected project.easl" });

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /open project/i })[0]);

    await waitFor(() => {
      expect(loadProject).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith(
        "inspect_project",
        expect.objectContaining({ path: "/tmp/custom-name.easl" }),
      );
      expect(showErrorNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "project-open:/tmp/custom-name.easl",
          title: expect.stringMatching(/invalid project file/i),
          message: "The selected project could not be opened.",
        }),
      );
    });
  });

  it("cancels duplicate-identity opening without changing active project or recents", async () => {
    const loadProject = vi.fn();
    useProjectStore.setState({ loadProject });
    useGlobalStore.setState((state) => ({
      settings: {
        ...state.settings,
        recentProjects: [{ path: "/old/project.easl", projectId: "same-id" }],
      },
    }));
    vi.mocked(open).mockResolvedValue("/new/project.easl");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(invoke).mockResolvedValue({ ...inspection, duplicatePath: "/old/project.easl" });

    renderPage();
    fireEvent.click(screen.getByTestId("landing-open-project-btn"));
    await screen.findByTestId("project-identity-dialog");
    fireEvent.click(screen.getByTestId("project-identity-cancel-btn"));

    await waitFor(() =>
      expect(screen.queryByTestId("project-identity-cancel-btn")).not.toBeInTheDocument(),
    );
    expect(loadProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project).toBeNull();
    expect(useGlobalStore.getState().settings.recentProjects).toEqual([
      { path: "/old/project.easl", projectId: "same-id" },
    ]);
  });

  it("replaces the recent path when duplicate identity is confirmed as moved", async () => {
    const loadProject = vi.fn(async () => {
      useProjectStore.setState({
        project: projectView(projectFixture("same-id", "Identity Project", "/new")),
        loaded: true,
        isDirty: false,
      });
    });
    useProjectStore.setState({ loadProject });
    useGlobalStore.setState((state) => ({
      settings: {
        ...state.settings,
        recentProjects: [{ path: "/old/project.easl", projectId: "same-id" }],
      },
    }));
    vi.mocked(open).mockResolvedValue("/new/project.easl");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(invoke).mockResolvedValue({ ...inspection, duplicatePath: "/old/project.easl" });

    renderPage();
    fireEvent.click(screen.getByTestId("landing-open-project-btn"));
    await screen.findByTestId("project-identity-dialog");
    fireEvent.click(screen.getByTestId("project-identity-moved-btn"));

    await waitFor(() =>
      expect(useGlobalStore.getState().settings.recentProjects[0]).toEqual({
        path: "/new/project.easl",
        projectId: "same-id",
        name: "Identity Project",
      }),
    );
    expect(loadProject).toHaveBeenCalledWith("/new/project.easl", {
      inspection: { ...inspection, duplicatePath: "/old/project.easl" },
      copied: false,
    });
  });

  it("opens a confirmed native copy under its persisted identity", async () => {
    const loadProject = vi.fn(async () => {
      useProjectStore.setState({
        project: projectView(projectFixture("copy-id", "Identity Project", "/copy")),
        loaded: true,
        isDirty: false,
      });
    });
    useProjectStore.setState({ loadProject });
    useGlobalStore.setState((state) => ({
      settings: {
        ...state.settings,
        recentProjects: [{ path: "/old/project.easl", projectId: "same-id" }],
      },
    }));
    vi.mocked(open).mockResolvedValue("/copy/project.easl");
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(invoke).mockResolvedValue({
      ...inspection,
      rootPath: "/copy",
      duplicatePath: "/old/project.easl",
    });

    renderPage();
    fireEvent.click(screen.getByTestId("landing-open-project-btn"));
    await screen.findByTestId("project-identity-dialog");
    fireEvent.click(screen.getByTestId("project-identity-copied-btn"));

    await waitFor(() => expect(useProjectStore.getState().project).not.toBeNull());
    const copiedId = useProjectStore.getState().project!.projectMeta.id;
    expect(copiedId).not.toBe("same-id");
    expect(useProjectStore.getState().isDirty).toBe(false);
    expect(loadProject).toHaveBeenCalledWith(
      "/copy/project.easl",
      expect.objectContaining({ copied: true }),
    );
    expect(useGlobalStore.getState().settings.recentProjects).toEqual([
      { path: "/copy/project.easl", projectId: copiedId, name: "Identity Project" },
      { path: "/old/project.easl", projectId: "same-id" },
    ]);
  });
});

describe("LandingPage BIDS detection dialogs", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    seedValidProfileGate();
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
      preflightProjectSetup: vi.fn(async (rootPath, _name, mode) => ({
        planId: "reviewed-plan",
        rootPath,
        mode,
        operations: [],
        warnings: [],
        conflicts: [],
        projectSummary: null,
        preservesReadme: true,
        temporaryArtifacts: [],
      })),
    });
    vi.mocked(open).mockResolvedValue(null);
    vi.mocked(exists).mockResolvedValue(false);
  });

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

  function reviewedPlan(rootPath: string, mode: "bids" | "dicom", conflicts: string[] = []) {
    return {
      planId: `${mode}-plan`,
      rootPath,
      mode,
      operations: [
        { path: "rawdata/", operation: "no_op" as const, textPreview: null },
        {
          path: ".bidsignore",
          operation: "update" as const,
          textPreview: "project.easl\n.easl_staging\nrawdata/\n",
        },
        { path: "project.easl", operation: "create" as const, textPreview: null },
      ],
      warnings: ["rawdata/ contains 2 sub-* directories"],
      conflicts,
      projectSummary: {
        schemaVersion: "2",
        name: "Dataset",
        projectId: "project-id",
        dataSource: mode,
        contentHash: "a".repeat(64),
      },
      preservesReadme: true,
      temporaryArtifacts: ["Candidates and backups are removed after commit."],
    };
  }

  it("keeps technical details collapsed while showing plain-language setup and warnings", async () => {
    useProjectStore.setState({
      preflightProjectSetup: vi.fn(async (rootPath, _name, mode) => reviewedPlan(rootPath, mode)),
    });
    vi.mocked(open).mockResolvedValue("/dataset");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "is_writable") return true;
      if (command === "check_bids_dataset") return BASE_BIDS_RESULT;
      return null;
    });
    renderPage();
    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await screen.findByTestId("bids-detection-dialog");
    fireEvent.click(screen.getByTestId("bids-detection-dialog-skip-radio"));
    await screen.findByTestId("bids-setup-plan");
    const details = screen.getByTestId("bids-setup-details");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByTestId("bids-setup-details-content")).not.toBeVisible();
    expect(screen.getByTestId("bids-setup-overview-description")).toHaveTextContent(
      "Existing images and documentation remain unchanged during setup.",
    );
    expect(screen.getByTestId("bids-setup-warning")).toBeVisible();
    expect(screen.getByTestId("bids-dataset-counts")).toHaveTextContent(
      "25 participants · 25 imaging sessions",
    );
    expect(screen.getByTestId("bids-setup-consent-notice")).toHaveTextContent(
      "Nothing changes until you select Create project.",
    );
    expect(screen.getByTestId("bids-detection-dialog-continue-btn")).toHaveTextContent(
      "Create project",
    );
    expect(screen.queryByText(/skip import|cross-sectional/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("bids-setup-details-toggle"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByTestId("bids-setup-details-content")).toBeVisible();
    expect(
      screen
        .getAllByTestId(/^bids-setup-operation-(?!preview-)/)
        .map((element) => element.dataset.testid),
    ).toEqual([
      "bids-setup-operation-rawdata-",
      "bids-setup-operation--bidsignore",
      "bids-setup-operation-project-easl",
    ]);
    expect(screen.getByTestId("bids-setup-root")).toHaveTextContent("Folder: /dataset");
    expect(screen.getByTestId("bids-setup-operation-project-easl")).toHaveTextContent(
      "create project.easl",
    );
    expect(screen.getByTestId("bids-setup-operation--bidsignore")).toHaveTextContent(
      "update .bidsignore",
    );
    expect(screen.getByTestId("bids-setup-operation-preview--bidsignore").textContent).toBe(
      "project.easl\n.easl_staging\nrawdata/\n",
    );
    expect(screen.getByTestId("bids-setup-operation-rawdata-")).toHaveTextContent("no-op rawdata/");
    expect(screen.getByTestId("bids-setup-project-summary")).toHaveTextContent(
      /Dataset.*schema 2.*project-id/i,
    );
    expect(screen.getByTestId("bids-setup-project-summary")).toHaveTextContent("a".repeat(64));
    expect(screen.getByTestId("bids-setup-readme-notice")).toBeInTheDocument();
    expect(screen.getByTestId("bids-setup-warning")).toHaveTextContent("2 sub-*");
    expect(screen.getByTestId("bids-setup-temporary-artifacts")).toHaveTextContent("Candidates");
  });

  it("explains both choices and shows single-participant counts before any setup is authorised", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/test/test_Oxford_ASL_singlePLD");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "is_writable") return true;
      if (command === "check_bids_dataset") {
        return { ...BASE_BIDS_RESULT, aslSubjectCount: 1, aslSessionCount: 1 };
      }
      return null;
    });
    renderPage();
    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await screen.findByTestId("bids-detection-dialog");
    expect(screen.getByTestId("bids-dataset-name")).toHaveTextContent("test_Oxford_ASL_singlePLD");
    expect(screen.getByTestId("bids-dataset-counts")).toHaveTextContent(
      "Found ASL images for 1 participant · 1 imaging session.",
    );
    expect(
      screen.getByRole("radio", { name: "Use existing BIDS images — Recommended" }),
    ).toHaveAccessibleDescription(/No DICOM conversion is needed.*review scan information/i);
    expect(
      screen.getByRole("radio", { name: "Import original scanner files (DICOM)" }),
    ).toHaveAccessibleDescription(/select those files next; conversion does not start here/i);
    expect(screen.getByTestId("bids-detection-dialog-continue-btn")).toBeDisabled();
    expect(useProjectStore.getState().preflightProjectSetup).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("keeps confirmation disabled for conflicts and does not commit on review cancellation or preflight failure", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({
      createProject,
      preflightProjectSetup: vi.fn(async (rootPath, _name, mode) =>
        reviewedPlan(rootPath, mode, ["project.easl already exists"]),
      ),
    });
    vi.mocked(open).mockResolvedValue("/dataset");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "is_writable") return true;
      if (command === "check_bids_dataset") return BASE_BIDS_RESULT;
      return null;
    });
    renderPage();
    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await screen.findByTestId("bids-detection-dialog");
    fireEvent.click(screen.getByTestId("bids-detection-dialog-skip-radio"));
    await screen.findByTestId("bids-setup-conflict");
    expect(screen.getByTestId("bids-setup-conflict")).toBeVisible();
    expect(screen.getByTestId("bids-setup-details")).not.toHaveAttribute("open");
    expect(screen.getByTestId("bids-detection-dialog-continue-btn")).toBeDisabled();
    fireEvent.click(screen.getByTestId("bids-detection-dialog-cancel-btn"));
    expect(createProject).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("commit_bids_project_mutations", expect.anything());
    expect(useGlobalStore.getState().settings.recentProjects).toEqual([]);
  });

  it("keeps ordinary non-BIDS DICOM creation on the normal single-project write path", async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    const preflightProjectSetup = vi.fn();
    useProjectStore.setState({ createProject, preflightProjectSetup });
    vi.mocked(open).mockResolvedValue("/ordinary-dicom");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "is_writable") return true;
      if (command === "check_bids_dataset") {
        return {
          ...BASE_BIDS_RESULT,
          isBids: false,
          hasDatasetDescription: false,
          aslSubjectCount: 0,
          totalSubjectCount: 0,
          error: "No BIDS subjects found",
        };
      }
      return null;
    });
    renderPage();
    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await screen.findByTestId("bids-no-subjects-dialog");
    expect(preflightProjectSetup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("bids-no-subjects-confirm-btn"));
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith("/ordinary-dicom", "ordinary-dicom", {
        dataSource: "dicom",
      }),
    );
  });

  it("rejects a late response for a superseded import mode", async () => {
    let resolveBids!: (plan: ReturnType<typeof reviewedPlan>) => void;
    const dicomPlan = reviewedPlan("/dataset", "dicom");
    useProjectStore.setState({
      preflightProjectSetup: vi.fn((_rootPath, _name, mode) =>
        mode === "bids"
          ? new Promise<ReturnType<typeof reviewedPlan>>((resolve) => {
              resolveBids = resolve;
            })
          : Promise.resolve(dicomPlan),
      ),
    });
    vi.mocked(open).mockResolvedValue("/dataset");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "is_writable") return true;
      if (command === "check_bids_dataset") return BASE_BIDS_RESULT;
      return null;
    });
    renderPage();
    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await screen.findByTestId("bids-detection-dialog");
    fireEvent.click(screen.getByTestId("bids-detection-dialog-skip-radio"));
    await waitFor(() => expect(resolveBids).toBeTypeOf("function"));
    fireEvent.click(screen.getByTestId("bids-detection-dialog-dicom-radio"));
    await waitFor(() =>
      expect(screen.getByTestId("bids-setup-project-summary")).toHaveTextContent(
        /Project Dataset.*dicom/i,
      ),
    );
    resolveBids(reviewedPlan("/dataset", "bids"));
    await Promise.resolve();
    expect(screen.getByTestId("bids-setup-plan")).toHaveTextContent(/dicom/);
    expect(screen.getByTestId("bids-detection-dialog-continue-btn")).not.toBeDisabled();
  });

  it("creates BIDS project when user chooses existing BIDS images and confirms creation", async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/bids-dataset");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") return BASE_BIDS_RESULT;
      return true;
    });

    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-detection-dialog")).toBeInTheDocument();
    });

    expect(screen.getByTestId("bids-dataset-counts")).toHaveTextContent("25 participants");
    expect(screen.getByTestId("bids-detection-dialog-skip-radio")).toBeInTheDocument();
    expect(screen.getByTestId("bids-detection-dialog-dicom-radio")).toBeInTheDocument();
    expect(screen.getByTestId("bids-detection-dialog-continue-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-detection-dialog-cancel-btn")).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("bids-detection-dialog-skip-radio"));
    await waitFor(() =>
      expect(screen.getByTestId("bids-detection-dialog-continue-btn")).not.toBeDisabled(),
    );

    // Now set the project so navigation works
    const fakeProject = {
      projectMeta: { id: "proj-1", currentPhase: "import" },
    };
    useProjectStore.setState({ project: fakeProject as any });

    fireEvent.click(screen.getByTestId("bids-detection-dialog-continue-btn"));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/bids-dataset", "bids-dataset", {
        dataSource: "bids",
        planId: "reviewed-plan",
      });
    });
  });

  it("creates DICOM project when user chooses original scanner files and confirms creation", async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/bids-dataset");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_writable") return true;
      if (cmd === "check_bids_dataset") return BASE_BIDS_RESULT;
      return true;
    });

    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-detection-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("bids-detection-dialog-dicom-radio"));
    await waitFor(() =>
      expect(screen.getByTestId("bids-detection-dialog-continue-btn")).not.toBeDisabled(),
    );

    const fakeProject = {
      projectMeta: { id: "proj-1", currentPhase: "import" },
    };
    useProjectStore.setState({ project: fakeProject as any });

    fireEvent.click(screen.getByTestId("bids-detection-dialog-continue-btn"));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/bids-dataset", "bids-dataset", {
        dataSource: "dicom",
        planId: "reviewed-plan",
      });
    });
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

    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-no-asl-dialog")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bids-no-asl-choose-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-no-asl-dialog")).toHaveTextContent(
      "Participant folders were found, but no ASL images with the required scan information were detected.",
    );

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

    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-corrupt-desc-dialog")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bids-corrupt-desc-skip-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-corrupt-desc-cancel-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-description-warning")).toBeVisible();
    expect(screen.getByTestId("bids-description-warning")).toHaveTextContent(
      "this does not repair that file.",
    );
    expect(screen.queryByText(/skip import/i)).not.toBeInTheDocument();
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

    renderPage();
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

  it.each([1, 3])(
    "counts missing context as %i ASL runs, not participant sessions",
    async (count) => {
      const createProject = vi.fn();
      useProjectStore.setState({ createProject });
      vi.mocked(open).mockResolvedValue("/tmp/bids-dataset");
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "is_writable") return true;
        if (cmd === "check_bids_dataset") {
          return { ...BASE_BIDS_RESULT, missingAslcontextCount: count };
        }
        return true;
      });

      renderPage();
      fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

      await waitFor(() => {
        expect(screen.getByTestId("bids-detection-dialog")).toBeInTheDocument();
      });

      const warning = screen.getByTestId("bids-missing-context-warning");
      expect(warning).toBeVisible();
      expect(warning).toHaveTextContent(
        count === 1 ? "1 ASL run is missing" : "3 ASL runs are missing",
      );
      expect(warning).toHaveTextContent("Affected participant sessions will be excluded");
    },
  );

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

    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(screen.getByTestId("bids-no-subjects-dialog")).toBeInTheDocument();
    });

    expect(screen.getByTestId("bids-no-subjects-choose-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-no-subjects-cancel-btn")).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();

    const skipRadio = screen.getByTestId("bids-detection-dialog-skip-radio");
    const dicomRadio = screen.getByTestId("bids-detection-dialog-dicom-radio");
    expect(skipRadio).toBeDisabled();
    expect(dicomRadio).not.toBeDisabled();
    expect(dicomRadio).toBeChecked(); // should be auto-selected

    const confirmBtn = screen.getByTestId("bids-no-subjects-confirm-btn");
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/no-subjects", "no-subjects", {
        dataSource: "dicom",
        planId: "reviewed-plan",
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

    renderPage();
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
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/no-asl", "no-asl", {
        dataSource: "dicom",
        planId: "reviewed-plan",
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

    renderPage();

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
        recentProjects: [{ path: "/tmp/brain-study/project.easl", projectId: "project-1" }],
      },
    });

    // Mock exists to return true for the recent project path and directory
    vi.mocked(exists).mockImplementation(async (path) => {
      return path === "/tmp/brain-study/project.easl" || path === "/tmp/brain-study";
    });

    renderPage();

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
