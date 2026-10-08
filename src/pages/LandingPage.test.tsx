import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
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
import LandingPage from "./LandingPage";
import { projectFixture } from "../test/projectFixtures";
import { projectView } from "../schemas/project";

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
    render(
      <MantineProvider env="test">
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
      <MantineProvider env="test">
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

    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

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

    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

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
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: expect.stringMatching(/failed to create project/i),
        }),
      );
    });
  });

  it("shows actionable storage guidance when project creation runs out of space", async () => {
    const createProject = vi
      .fn()
      .mockRejectedValue(new ProjectStorageError("insufficient_space", "temporary write failed"));
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

    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("bids-no-subjects-confirm-btn")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("bids-no-subjects-confirm-btn"));

    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/free space/i) }),
      ),
    );
  });

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

    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

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

    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getByTestId("landing-open-project-btn"));
    await screen.findByTestId("project-recovery-dialog");
    fireEvent.click(screen.getByTestId("project-recovery-confirm-btn"));

    await waitFor(() => expect(confirmRecovery).toHaveBeenCalledOnce());
  });

  it("shows WelcomeCard when no execution profiles are configured", () => {
    seedZeroProfilesGate();

    render(
      <MantineProvider env="test">
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
      <MantineProvider env="test">
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
      <MantineProvider env="test">
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
        recentProjects: [{ path: "/tmp/recent/project.easl" }],
      },
    }));
    vi.mocked(exists).mockResolvedValue(true);

    render(
      <MantineProvider env="test">
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
    vi.mocked(invoke).mockRejectedValueOnce({ message: "Expected project.easl" });

    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /open project/i })[0]);

    await waitFor(() => {
      expect(loadProject).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith(
        "inspect_project",
        expect.objectContaining({ path: "/tmp/custom-name.easl" }),
      );
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: expect.stringMatching(/invalid project file/i),
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

    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );
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

    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId("landing-open-project-btn"));
    await screen.findByTestId("project-identity-dialog");
    fireEvent.click(screen.getByTestId("project-identity-moved-btn"));

    await waitFor(() =>
      expect(useGlobalStore.getState().settings.recentProjects[0]).toEqual({
        path: "/new/project.easl",
        projectId: "same-id",
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

    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );
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
      { path: "/copy/project.easl", projectId: copiedId },
      { path: "/old/project.easl", projectId: "same-id" },
    ]);
    expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.anything());
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

  function renderLanding() {
    return render(
      <MantineProvider env="test">
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

  function reviewedPlan(rootPath: string, mode: "bids" | "dicom", conflicts: string[] = []) {
    return {
      planId: `${mode}-plan`,
      rootPath,
      mode,
      operations: [
        { path: "project.easl", operation: "create" as const, textPreview: null },
        {
          path: ".bidsignore",
          operation: "update" as const,
          textPreview: "project.easl\n.easl_staging\nrawdata/\n",
        },
        {
          path: "rawdata/.easl-gui-managed",
          operation: "create" as const,
          textPreview: '{"kind":"bids-direct-rawdata","version":1}\n',
        },
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

  it("renders every reviewed operation, exact text, summary, preservation, warnings, and temporary disclosure", async () => {
    useProjectStore.setState({
      preflightProjectSetup: vi.fn(async (rootPath, _name, mode) => reviewedPlan(rootPath, mode)),
    });
    vi.mocked(open).mockResolvedValue("/dataset");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "is_writable") return true;
      if (command === "check_bids_dataset") return BASE_BIDS_RESULT;
      return null;
    });
    renderLanding();
    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await screen.findByTestId("bids-detection-dialog");
    fireEvent.click(screen.getByTestId("bids-detection-dialog-skip-radio"));
    await screen.findByTestId("bids-setup-plan");
    expect(screen.getByTestId("bids-setup-operation-project-easl")).toHaveTextContent(
      "create project.easl",
    );
    expect(screen.getByTestId("bids-setup-operation--bidsignore")).toHaveTextContent(
      "update .bidsignore",
    );
    expect(screen.getByTestId("bids-setup-operation-preview--bidsignore").textContent).toBe(
      "project.easl\n.easl_staging\nrawdata/\n",
    );
    expect(screen.getByTestId("bids-setup-operation-rawdata--easl-gui-managed")).toHaveTextContent(
      "create rawdata/.easl-gui-managed",
    );
    expect(screen.getByTestId("bids-setup-project-summary")).toHaveTextContent(
      /Dataset.*schema 2.*project-id/i,
    );
    expect(screen.getByTestId("bids-setup-readme-notice")).toBeInTheDocument();
    expect(screen.getByTestId("bids-setup-warning")).toHaveTextContent("2 sub-*");
    expect(screen.getByTestId("bids-setup-temporary-artifacts")).toHaveTextContent("Candidates");
  });

  it("keeps confirmation disabled for conflicts and does not commit on review cancellation or preflight failure", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({
      createProject,
      preflightProjectSetup: vi.fn(async (rootPath, _name, mode) =>
        reviewedPlan(rootPath, mode, ["foreign marker"]),
      ),
    });
    vi.mocked(open).mockResolvedValue("/dataset");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "is_writable") return true;
      if (command === "check_bids_dataset") return BASE_BIDS_RESULT;
      return null;
    });
    renderLanding();
    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await screen.findByTestId("bids-detection-dialog");
    fireEvent.click(screen.getByTestId("bids-detection-dialog-skip-radio"));
    await screen.findByTestId("bids-setup-conflict");
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
    renderLanding();
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
    renderLanding();
    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await screen.findByTestId("bids-detection-dialog");
    fireEvent.click(screen.getByTestId("bids-detection-dialog-skip-radio"));
    await waitFor(() => expect(resolveBids).toBeTypeOf("function"));
    fireEvent.click(screen.getByTestId("bids-detection-dialog-dicom-radio"));
    await screen.findByText(/Project Dataset.*dicom/i);
    resolveBids(reviewedPlan("/dataset", "bids"));
    await Promise.resolve();
    expect(screen.getByTestId("bids-setup-plan")).toHaveTextContent(/dicom/);
    expect(screen.getByTestId("bids-detection-dialog-continue-btn")).not.toBeDisabled();
  });

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

    render(
      <MantineProvider env="test">
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
        recentProjects: [{ path: "/tmp/brain-study/project.easl", projectId: "project-1" }],
      },
    });

    // Mock exists to return true for the recent project path and directory
    vi.mocked(exists).mockImplementation(async (path) => {
      return path === "/tmp/brain-study/project.easl" || path === "/tmp/brain-study";
    });

    render(
      <MantineProvider env="test">
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
