import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exists } from "@tauri-apps/plugin-fs";
import { Store } from "@tauri-apps/plugin-store";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectSnapshot_Serialize as ProjectSnapshot } from "../generated/bindings";
import { showErrorNotification } from "../lib/errorNotifications";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { projectView } from "../schemas/project";
import { useGlobalStore } from "../stores/globalStore";
import { useImportStore } from "../stores/importStore";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import { useVisualizationStore } from "../stores/visualizationStore";
import { projectFixture } from "../test/projectFixtures";
import { TestMantineProvider } from "../test/render";
import RecentProjectsList from "./landing/RecentProjectsList";
import Layout from "./Layout";

vi.mock("../lib/errorNotifications", () => ({ showErrorNotification: vi.fn() }));

const name = "Étude – ASL / 2026 🧠";
const original = projectFixture("project-1", "Brain Study", "/project");
const renamed: ProjectSnapshot = {
  ...original,
  acceptedRevision: 1,
  document: {
    ...original.document,
    projectMeta: { ...original.document.projectMeta, name },
  },
};
const saved = { ...renamed, persistedRevision: 1 };
const phaseChanged: ProjectSnapshot = {
  ...renamed,
  acceptedRevision: 2,
  document: {
    ...renamed.document,
    projectMeta: { ...renamed.document.projectMeta, currentPhase: "parameters" },
  },
};

function Phase() {
  return <div data-testid="rename-test-route">{useLocation().pathname}</div>;
}

function renderShell(path = "/project/project-1/import") {
  return render(
    <TestMantineProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout onOpenSettings={() => undefined} />}>
            <Route path="/project/:id/:phase" element={<Phase />} />
            <Route path="/" element={<RecentProjectsList onOpen={() => undefined} />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TestMantineProvider>,
  );
}

function editName(value?: string) {
  fireEvent.click(screen.getByTestId("layout-project-rename-btn"));
  const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Project name" });
  if (value !== undefined) fireEvent.change(input, { target: { value } });
  return input;
}

function edits() {
  return vi.mocked(invoke).mock.calls.filter(([command]) => command === "accept_project_edit");
}

function seedProject() {
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
  activateProjectLease("project-1", "/project");
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useProjectStore.setState({ project: projectView(original), loaded: true });
}

describe("inline project rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedProject();
    useGlobalStore.setState(useGlobalStore.getInitialState(), true);
    useGlobalStore.setState({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        recentProjects: [
          { path: "/other/project.easl", projectId: "other", name },
          { path: "/project/project.easl", projectId: "project-1", name: "Brain Study" },
          { path: "/legacy/project.easl" },
        ],
      },
    });
    useProcessingStore.setState({ processingPhase: "idle", availableSubjects: [] });
    useImportStore.setState({
      importPhase: "idle",
      importRunning: false,
      sourceAvailability: { status: "unconfigured", savedPath: null, message: null },
    });
    useVisualizationStore.setState({
      externalSourceAvailability: { status: "unconfigured", savedPath: null, message: null },
    });
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation(async (command, args) => {
        if (command === "accept_project_edit")
          return (args as { edit: { kind: string } }).edit.kind === "phase"
            ? phaseChanged
            : renamed;
        if (command === "save_project" || command === "get_project_snapshot") return saved;
        if (command === "shutdown_project_runtime")
          return {
            success: true,
            importProcess: { success: true },
            processingWorkers: { success: true },
            lockWatcher: { success: true },
          };
        if (command === "clear_active_project") return null;
        if (command === "validate_all_execution_profiles") return [];
        throw new Error(`Unexpected command ${command}`);
      });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.getState().cancelAutosave();
    resetProjectLifecycleForTests();
    vi.useRealTimers();
  });

  it("focuses/selects inline text, renames on blur during work, and autosaves names shown in recent projects after restart", async () => {
    useGlobalStore.setState((state) => ({
      settings: {
        ...state.settings,
        recentProjects: state.settings.recentProjects.map((entry) =>
          entry.projectId === "project-1"
            ? { ...entry, path: "/project-link/project.easl" }
            : entry,
        ),
      },
    }));
    const { unmount } = renderShell();
    for (const id of [
      "layout-header",
      "layout-header-identity",
      "layout-logo",
      "layout-project-name-text",
      "layout-project-rename-icon",
    ])
      expect(screen.getByTestId(id)).toBeInTheDocument();
    const input = editName();
    expect(input).toHaveFocus();
    expect(input.value.slice(input.selectionStart!, input.selectionEnd!)).toBe("Brain Study");
    expect(screen.queryByTestId("layout-project-name-text")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => useProcessingStore.setState({ processingPhase: "running" }));
    fireEvent.change(input, { target: { value: `  ${name}  ` } });
    vi.useFakeTimers();
    await act(async () => input.blur());
    expect(edits()).toEqual([
      ["accept_project_edit", { generation: 1, edit: { kind: "renameProject", name } }],
    ]);
    expect(screen.getByTestId("layout-project-name-text")).toHaveTextContent(name);
    expect(screen.getByTestId("layout-footer-project-name")).toHaveTextContent(name);
    expect(useProcessingStore.getState().processingPhase).toBe("running");
    expect(useProjectStore.getState().isDirty).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1999));
    expect(invoke).not.toHaveBeenCalledWith("save_project", expect.anything());
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(useProjectStore.getState().isDirty).toBe(false);
    vi.useRealTimers();
    expect(useGlobalStore.getState().settings.recentProjects.map((entry) => entry.path)).toEqual([
      "/other/project.easl",
      "/project-link/project.easl",
      "/legacy/project.easl",
    ]);
    act(() => useProcessingStore.setState({ processingPhase: "idle" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("layout-nav-home"));
    });
    await screen.findByRole("button", { name: "Open legacy" });
    expect(screen.getAllByRole("button", { name: `Open ${name}` })).toHaveLength(2);
    expect(screen.getByTestId("recent-project-path--project-link-project-easl")).toHaveTextContent(
      "/project-link/project.easl",
    );
    const settings = await Store.load("settings.json");
    await waitFor(async () =>
      expect(await settings.get("recentProjects")).toEqual(
        useGlobalStore.getState().settings.recentProjects,
      ),
    );
    unmount();
    useGlobalStore.setState({ settings: DEFAULT_SETTINGS });
    await useGlobalStore.getState().loadSettings();
    renderShell("/");
    expect(await screen.findAllByRole("button", { name: `Open ${name}` })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Open legacy" })).toBeInTheDocument();
  });

  it("does not edit, dirty, revise or autosave unchanged and whitespace-equivalent names", async () => {
    renderShell();
    vi.useFakeTimers();
    for (const value of ["Brain Study", "  Brain Study  "]) {
      const input = editName(value);
      await act(async () => input.blur());
      expect(screen.getByTestId("layout-project-name-text")).toHaveTextContent("Brain Study");
    }
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(invoke).not.toHaveBeenCalled();
    expect(useProjectStore.getState()).toMatchObject({
      isDirty: false,
      project: { acceptedRevision: 0, persistedRevision: 0 },
    });
  });

  it("submits Enter once despite blur, ignores IME Enter, and cancels Escape without a later blur submission", async () => {
    renderShell();
    const input = editName(name);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input).toHaveFocus();
    expect(edits()).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await screen.findByTestId("layout-project-name-text");
    expect(edits()).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId("layout-project-rename-btn")).toHaveFocus());
    useProjectStore.getState().cancelAutosave();
    const cancelled = editName("Discard this");
    fireEvent.keyDown(cancelled, { key: "Escape" });
    fireEvent.blur(cancelled);
    expect(screen.getByTestId("layout-project-name-text")).toHaveTextContent(name);
    expect(screen.getByTestId("layout-project-rename-btn")).toHaveFocus();
    expect(edits()).toHaveLength(1);
  });

  it("keeps invalid and natively rejected drafts visible, blocks Save, and allows correction", async () => {
    renderShell();
    let input = editName();
    for (const value of ["", "   ", "Bad\u0000name", "Bad\u2028name", "Bad\u2029name"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
      expect(screen.getByRole("alert")).toHaveTextContent(/Project name/);
      expect(input).toHaveValue(value);
      expect(useProjectStore.getState().project?.projectMeta.name).toBe("Brain Study");
    }
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("layout-save-status-btn"));
    await waitFor(() => expect(showErrorNotification).toHaveBeenCalled());
    expect(invoke).not.toHaveBeenCalled();
    act(() => input.focus());
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useProjectStore.getState()).toMatchObject({
      saveError: null,
      draftErrors: {},
      isDirty: false,
      project: { acceptedRevision: 0, persistedRevision: 0 },
    });
    expect(screen.getByTestId("layout-project-name-text")).toHaveTextContent("Brain Study");
    expect(screen.getByTestId("layout-save-status-btn")).toHaveAttribute(
      "aria-label",
      "Project changes in sync",
    );
    act(() => useProjectStore.getState().setDraftError("parameter", "Correct parameter"));
    input = editName("");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useProjectStore.getState()).toMatchObject({
      draftErrors: { parameter: "Correct parameter" },
      isDirty: true,
    });
    act(() => useProjectStore.getState().setDraftError("parameter", null));
    input = editName(name);
    vi.mocked(invoke).mockRejectedValueOnce({ message: "Rename rejected", details: "Try again" });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Rename rejected"));
    expect(input).toHaveValue(name);
    expect(useProjectStore.getState().project?.projectMeta.name).toBe("Brain Study");
    fireEvent.keyDown(input, { key: "Escape" });
    await expect(useProjectStore.getState().flushEdits()).resolves.toBeUndefined();
    expect(useProjectStore.getState()).toMatchObject({
      saveError: null,
      draftErrors: {},
      isDirty: false,
    });
    const corrected = editName(name);
    fireEvent.change(corrected, { target: { value: ` ${name} ` } });
    fireEvent.blur(corrected);
    await screen.findByTestId("layout-project-name-text");
    expect(useProjectStore.getState()).toMatchObject({ saveError: null, draftErrors: {} });
  });

  it("waits for the blurred rename before Save, keyboard Save, phase navigation, Home and native close", async () => {
    const user = userEvent.setup();
    for (const action of ["save", "shortcut", "phase", "home", "close"]) {
      seedProject();
      vi.mocked(invoke).mockClear();
      let release!: (reply: ProjectSnapshot) => void;
      const persisted = action === "phase" ? { ...phaseChanged, persistedRevision: 2 } : saved;
      vi.mocked(invoke).mockImplementation(async (command, args) => {
        if (command === "accept_project_edit") {
          if ((args as { edit: { kind: string } }).edit.kind === "phase") return phaseChanged;
          return new Promise<ProjectSnapshot>((resolve) => {
            release = resolve;
          });
        }
        if (command === "save_project" || command === "get_project_snapshot") return persisted;
        if (command === "shutdown_project_runtime") return { success: true };
        if (command === "clear_active_project") return null;
        throw new Error(`Unexpected command ${command}`);
      });
      const { unmount } = renderShell();
      editName(name);
      if (action === "shortcut")
        fireEvent.keyDown(document.activeElement!, { key: "s", ctrlKey: true });
      else if (action === "close") {
        await waitFor(() =>
          expect(
            (window as unknown as { __mockNativeCloseRequestedListener: unknown })
              .__mockNativeCloseRequestedListener,
          ).toBeTypeOf("function"),
        );
        void (
          window as unknown as {
            __mockNativeCloseRequestedListener: (event: { payload: number }) => Promise<void>;
          }
        ).__mockNativeCloseRequestedListener({ payload: 1 });
      } else
        await user.click(
          screen.getByTestId(
            action === "save"
              ? "layout-save-status-btn"
              : action === "phase"
                ? "layout-nav-parameters"
                : "layout-nav-home",
          ),
        );
      await waitFor(() => expect(release).toBeTypeOf("function"));
      expect(invoke).not.toHaveBeenCalledWith("save_project", expect.anything());
      await act(async () => release(renamed));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_project", { generation: 1 }));
      if (action === "phase")
        await waitFor(() =>
          expect(screen.getByTestId("rename-test-route")).toHaveTextContent("/parameters"),
        );
      if (action === "home" || action === "close")
        await waitFor(() => expect(useProjectStore.getState().project).toBeNull());
      if (action === "close") expect(getCurrentWindow().destroy).toHaveBeenCalled();
      expect(edits()[0]).toEqual([
        "accept_project_edit",
        { generation: 1, edit: { kind: "renameProject", name } },
      ]);
      expect(edits()).toHaveLength(action === "phase" ? 2 : 1);
      unmount();
    }
  });

  it("drops old-project drafts and ignores both successful and rejected delayed replies after project replacement", async () => {
    for (const outcome of ["draft", "success", "failure"]) {
      seedProject();
      let resolve!: (reply: ProjectSnapshot) => void;
      let reject!: (reason: unknown) => void;
      vi.mocked(invoke)
        .mockClear()
        .mockImplementation(
          () =>
            new Promise<ProjectSnapshot>((yes, no) => {
              resolve = yes;
              reject = no;
            }),
        );
      const { unmount } = renderShell();
      const input = editName(name);
      if (outcome !== "draft") {
        fireEvent.blur(input);
        await waitFor(() => expect(resolve).toBeTypeOf("function"));
      }
      const next = { ...projectFixture("next", "Next project", "/next"), activationGeneration: 2 };
      act(() => {
        activateProjectLease("next", "/next");
        useProjectStore.setState({
          ...useProjectStore.getInitialState(),
          project: projectView(next),
          loaded: true,
        });
      });
      expect(screen.queryByTestId("layout-project-name-input")).not.toBeInTheDocument();
      const nextInput = editName("Next draft");
      await act(async () => {
        if (outcome === "success") resolve(renamed);
        if (outcome === "failure") reject({ message: "Old rejection", details: "Old project" });
      });
      expect(nextInput).toHaveValue("Next draft");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(useProjectStore.getState()).toMatchObject({
        project: { projectMeta: { id: "next", name: "Next project" } },
        draftErrors: {},
        isDirty: false,
      });
      expect(edits()).toHaveLength(outcome === "draft" ? 0 : 1);
      await expect(useProjectStore.getState().flushEdits()).resolves.toBeUndefined();
      fireEvent.keyDown(nextInput, { key: "Escape" });
      unmount();
    }
  });

  it("retains unsaved renamed state on disk failure and refreshes recent names only after successful retry", async () => {
    renderShell();
    const input = editName(name);
    vi.useFakeTimers();
    await act(async () => input.blur());
    vi.mocked(invoke).mockRejectedValueOnce({
      category: "insufficient_space",
      message: "Disk full",
      details: "Disk full",
    });
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    vi.useRealTimers();
    expect(screen.getByTestId("layout-project-name-text")).toHaveTextContent(name);
    expect(screen.getByTestId("layout-save-status-btn")).toHaveAttribute(
      "aria-label",
      "Project save failed; retry",
    );
    expect(useProjectStore.getState()).toMatchObject({
      isDirty: true,
      project: { acceptedRevision: 1, persistedRevision: 0 },
    });
    expect(useGlobalStore.getState().settings.recentProjects[1].name).toBe("Brain Study");
    expect(showErrorNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Project not saved",
        details: expect.stringMatching(/Free space/),
      }),
    );
    const storageError = useProjectStore.getState().saveError;
    const invalid = editName("");
    fireEvent.click(screen.getByTestId("layout-save-status-btn"));
    await waitFor(() => expect(showErrorNotification).toHaveBeenCalledTimes(2));
    act(() => invalid.focus());
    fireEvent.keyDown(invalid, { key: "Escape" });
    expect(useProjectStore.getState()).toMatchObject({
      saveError: storageError,
      draftErrors: {},
      isDirty: true,
      project: { acceptedRevision: 1, persistedRevision: 0 },
    });
    expect(screen.getByTestId("layout-save-status-btn")).toHaveAttribute(
      "aria-label",
      "Project save failed; retry",
    );
    fireEvent.click(screen.getByTestId("layout-save-status-btn"));
    await waitFor(() => expect(useProjectStore.getState().isDirty).toBe(false));
    expect(useGlobalStore.getState().settings.recentProjects[1]).toEqual({
      path: "/project/project.easl",
      projectId: "project-1",
      name,
    });
    expect(edits()).toHaveLength(1);
  });
});
