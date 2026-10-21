import { invoke } from "@tauri-apps/api/core";
import { error as logError } from "@tauri-apps/plugin-log";
import { notifications } from "@mantine/notifications";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectView } from "../schemas/project";
import { useProjectStore } from "../stores/projectStore";
import { projectFixture } from "../test/projectFixtures";
import {
  activateProjectLease,
  invalidateProjectLease,
  resetProjectLifecycleForTests,
} from "./projectLifecycle";
import { projectRequest } from "./projectPersistence";

beforeEach(() => {
  resetProjectLifecycleForTests();
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useProjectStore.setState({ project: projectView(projectFixture()), loaded: true });
  activateProjectLease("project-1", "/project");
  vi.mocked(invoke).mockReset();
  vi.mocked(logError).mockClear();
});
afterEach(() => {
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
  vi.useRealTimers();
});

describe("native project client", () => {
  it("orders pending accepted edits before Save even when accepted cache began clean", async () => {
    const first = { ...projectFixture(), acceptedRevision: 1 };
    first.document.uiState.navbarCollapsed = false;
    const second = {
      ...first,
      acceptedRevision: 2,
      document: {
        ...first.document,
        projectMeta: { ...first.document.projectMeta, currentPhase: "parameters" as const },
      },
    };
    let release!: () => void;
    vi.mocked(invoke)
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return first;
      })
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce({ ...second, persistedRevision: 2 });
    const a = useProjectStore.getState().toggleNavbar();
    const save = useProjectStore.getState().saveProject();
    const b = useProjectStore.getState().submitEdit((project) => {
      expect(project.uiState.navbarCollapsed).toBe(false);
      return { kind: "phase", phase: "parameters" };
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(invoke).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([a, b, save]);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "accept_project_edit",
      "accept_project_edit",
      "save_project",
    ]);
    expect(useProjectStore.getState()).toMatchObject({
      isDirty: false,
      pendingEdits: 0,
      project: { acceptedRevision: 2, persistedRevision: 2 },
    });
    useProjectStore.getState().acceptSnapshot(second);
    expect(useProjectStore.getState()).toMatchObject({
      isDirty: false,
      project: { acceptedRevision: 2, persistedRevision: 2 },
    });
  });

  it("preserves visible unsaved state after native failure and retries latest revision", async () => {
    useProjectStore.setState({
      project: projectView({ ...projectFixture(), acceptedRevision: 1 }),
      isDirty: true,
    });
    vi.mocked(invoke)
      .mockRejectedValueOnce({
        category: "durability_uncertain",
        message: "Directory flush failed",
      })
      .mockResolvedValueOnce({ ...projectFixture(), acceptedRevision: 1, persistedRevision: 1 });
    await expect(useProjectStore.getState().saveProject()).rejects.toMatchObject({
      category: "durability_uncertain",
    });
    expect(useProjectStore.getState()).toMatchObject({
      isDirty: true,
      saveError:
        "Your project was written, but the application could not confirm it is safely stored. Check the drive connection, then try Save again before closing.",
    });
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Project not saved",
        message: useProjectStore.getState().saveError,
      }),
    );
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      '[PROJECT] save_project failed: {"category":"durability_uncertain","message":"Directory flush failed"}',
    );
    await useProjectStore.getState().saveProject();
    expect(useProjectStore.getState()).toMatchObject({ isDirty: false, saveError: null });
  });

  it("ignores successful old Save completion after reopening the same ID and root", async () => {
    let complete!: () => void;
    vi.mocked(invoke).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
      return projectFixture();
    });
    const oldSave = useProjectStore.getState().saveProject();
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    invalidateProjectLease();
    const reopened = projectView({
      ...projectFixture(),
      activationGeneration: 2,
      acceptedRevision: 1,
    });
    useProjectStore.setState({
      project: reopened,
      isDirty: true,
      saving: true,
      saveError: "New activation error",
    });
    activateProjectLease("project-1", "/project");
    complete();
    await oldSave;
    expect(useProjectStore.getState()).toMatchObject({
      project: reopened,
      isDirty: true,
      saving: true,
      saveError: "New activation error",
    });
  });

  it.each([
    [false, true],
    [true, true],
    [false, false],
  ])(
    "shared two-second autosave respects expired activation %s and changed edit %s",
    async (expired, changed) => {
      vi.useFakeTimers();
      vi.mocked(invoke)
        .mockResolvedValueOnce({ ...projectFixture(), acceptedRevision: changed ? 1 : 0 })
        .mockResolvedValueOnce({ ...projectFixture(), acceptedRevision: 1, persistedRevision: 1 });
      await useProjectStore.getState().toggleNavbar();
      if (expired) {
        invalidateProjectLease();
        useProjectStore.setState({
          project: projectView({
            ...projectFixture("other", "Other", "/other"),
            activationGeneration: 2,
          }),
        });
        activateProjectLease("other", "/other");
      }
      await vi.advanceTimersByTimeAsync(1999);
      expect(invoke).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(invoke).toHaveBeenCalledTimes(expired || !changed ? 1 : 2);
      if (!expired) expect(useProjectStore.getState().isDirty).toBe(false);
    },
  );

  it("blocks Save and close on invalid drafts without clearing accepted A", async () => {
    useProjectStore.getState().setDraftError("parameter", "Correct parameter");
    await expect(useProjectStore.getState().saveProject()).rejects.toThrow("Correct parameter");
    await expect(useProjectStore.getState().closeProject()).rejects.toThrow("Correct parameter");
    expect(invoke).not.toHaveBeenCalled();
    expect(useProjectStore.getState()).toMatchObject({
      project: { projectMeta: { id: "project-1" } },
      draftErrors: { parameter: "Correct parameter" },
      isDirty: true,
    });
  });

  it("keeps native diagnostics in logs and causes while presenting readable request errors", async () => {
    const invalidArgs =
      'invalid args `edit` for command `accept_project_edit`: invalid type: string "0", expected u32';
    vi.mocked(invoke)
      .mockRejectedValueOnce({ category: "insufficient_space", message: "Disk full" })
      .mockRejectedValueOnce({ category: "unknown" })
      .mockRejectedValueOnce(invalidArgs);
    await expect(projectRequest("save_project")).rejects.toMatchObject({
      category: "insufficient_space",
      message: "Insufficient disk space. Free space on the project volume and try again.",
      cause: { category: "insufficient_space", message: "Disk full" },
    });
    await expect(projectRequest("save_project")).rejects.toMatchObject({
      message:
        "Your project could not be saved. Try Save again. If the problem continues, report it with the application log.",
      cause: { category: "unknown" },
    });
    // Logging failure must not mask the project error or expose its arguments.
    vi.mocked(logError).mockRejectedValueOnce(new Error("Logger unavailable"));
    await expect(
      projectRequest("accept_project_edit", { edit: { studyData: "private" } }),
    ).rejects.toMatchObject({
      message:
        "Your project changes could not be applied. They have not been saved. Try the action again. If the problem continues, report it with the application log.",
      cause: invalidArgs,
    });
    expect(logError).toHaveBeenCalledTimes(3);
    expect(logError).toHaveBeenNthCalledWith(
      1,
      '[PROJECT] save_project failed: {"category":"insufficient_space","message":"Disk full"}',
    );
    expect(logError).toHaveBeenNthCalledWith(
      2,
      '[PROJECT] save_project failed: {"category":"unknown"}',
    );
    expect(logError).toHaveBeenLastCalledWith(
      `[PROJECT] accept_project_edit failed: ${invalidArgs}`,
    );
  });
});
