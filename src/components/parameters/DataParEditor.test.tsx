import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDataParStore } from "../../stores/dataParStore";
import { useProjectStore } from "../../stores/projectStore";
import DataParEditor from "./DataParEditor";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn(),
  mkdir: vi.fn(),
}));

function renderEditor() {
  return render(
    <MantineProvider>
      <DataParEditor />
    </MantineProvider>,
  );
}

describe("DataParEditor", () => {
  beforeEach(() => {
    useDataParStore.getState().resetDataPar();
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "test-project",
          name: "Test Project",
          rootPath: "/tmp/test",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastOpened: "2026-01-01T00:00:00.000Z",
          currentPhase: "parameters",
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
  });

  it("renders all basic sections", () => {
    renderEditor();

    expect(screen.getByText("M0 Configuration")).toBeInTheDocument();
    expect(screen.getByText("Quantification")).toBeInTheDocument();
    expect(screen.getByText("General Settings")).toBeInTheDocument();
    expect(screen.getByText("ASL Processing")).toBeInTheDocument();
    expect(screen.getByText("Atlases & Masking")).toBeInTheDocument();
  });

  it("does not render advanced sections by default", () => {
    renderEditor();

    expect(screen.queryByText("Structural")).not.toBeInTheDocument();
    expect(screen.queryByText("Environment")).not.toBeInTheDocument();
  });

  it("shows advanced sections when toggle is on", async () => {
    const user = userEvent.setup();
    renderEditor();

    const toggles = screen.getAllByTestId("advanced-toggle");
    await user.click(toggles[0]);

    expect(screen.getAllByText("Structural").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Environment").length).toBeGreaterThan(0);
  });

  it("hides advanced sections when toggle is off", async () => {
    const user = userEvent.setup();
    renderEditor();

    const toggles = screen.getAllByTestId("advanced-toggle");
    await user.click(toggles[0]);
    await user.click(toggles[0]);

    expect(screen.queryAllByText("Structural")).toHaveLength(0);
    expect(screen.queryAllByText("Environment")).toHaveLength(0);
  });

  it("loads dataPar from project store on mount", () => {
    useProjectStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            exploreAslConfig: {
              ...state.project.exploreAslConfig,
              dataPar: { x: { Q: { Lambda: 0.8 } } },
            },
          }
        : null,
    }));

    renderEditor();

    expect(useDataParStore.getState().dataPar).toEqual({ x: { Q: { Lambda: 0.8 } } });
  });

  it("debounces save to project after field change", async () => {
    vi.useFakeTimers();
    renderEditor();

    act(() => {
      useDataParStore.getState().setDataParField("Lambda", 0.8);
    });

    // Not saved yet (debounced)
    const projectBefore = useProjectStore.getState().project;
    expect(projectBefore?.exploreAslConfig.dataPar).toEqual({});

    // Advance timers past debounce
    act(() => {
      vi.advanceTimersByTime(600);
    });

    const projectAfter = useProjectStore.getState().project;
    expect(projectAfter?.exploreAslConfig.dataPar).toBeDefined();

    vi.useRealTimers();
  });
});
