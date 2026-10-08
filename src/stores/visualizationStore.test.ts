import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useVisualizationStore, acceptedVisualizationSettings } from "./visualizationStore";
import { useProjectStore } from "./projectStore";
import { projectFixture } from "../test/projectFixtures";
import { projectView } from "../schemas/project";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";

describe("visualizationStore", () => {
  beforeEach(() => {
    resetProjectLifecycleForTests();
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProjectStore.setState({ project: projectView(projectFixture()) });
    activateProjectLease("project-1", "/project");
    vi.mocked(invoke).mockReset();
    useVisualizationStore.getState().reset();
  });
  afterEach(() => {
    useProjectStore.getState().cancelAutosave();
    resetProjectLifecycleForTests();
  });

  it("selectPoint sets selectedPointId", () => {
    const { selectPoint } = useVisualizationStore.getState();
    selectPoint("sub-X_01_ASL_1");
    expect(useVisualizationStore.getState().selectedPointId).toBe("sub-X_01_ASL_1");
    useVisualizationStore.getState().setChartData([]);
    useVisualizationStore.getState().setViewerState({ status: "loaded" });
    expect(invoke).not.toHaveBeenCalled();
    expect(useProjectStore.getState().pendingEdits).toBe(0);
  });

  it("setAxisAssignment merges with existing", async () => {
    const first = {
      ...projectFixture("project-1", "Project", "/project", {
        uiState: { dataVis: { axisAssignment: { x: "GM_vol", y: null, colorBy: null } } },
      }),
      acceptedRevision: 1,
    };
    const second = {
      ...projectFixture("project-1", "Project", "/project", {
        uiState: { dataVis: { axisAssignment: { x: "GM_vol", y: "Total_GM_B", colorBy: null } } },
      }),
      acceptedRevision: 2,
    };
    vi.mocked(invoke).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { setAxisAssignment } = useVisualizationStore.getState();
    setAxisAssignment({ x: "GM_vol" });
    setAxisAssignment({ y: "Total_GM_B" });
    await useProjectStore.getState().flushEdits();
    const { axisAssignment } = acceptedVisualizationSettings();
    expect(axisAssignment.x).toBe("GM_vol");
    expect(axisAssignment.y).toBe("Total_GM_B");
    expect(axisAssignment.colorBy).toBeNull();
    expect(vi.mocked(invoke).mock.calls[1]![1]).toMatchObject({
      edit: { kind: "visualization", config: { axisAssignment } },
    });
  });

  it("reset clears all state", () => {
    const store = useVisualizationStore.getState();
    store.setChartData([
      { id: "test", x: 1, y: 2, participantId: "p", subject: "s", session: "01", run: "ASL_1" },
    ]);
    store.reset();
    expect(useVisualizationStore.getState().chartData).toEqual([]);
    expect(useVisualizationStore.getState().selectedPointId).toBeNull();
  });

  it("sets new Nivo and NiiVue parameters", async () => {
    const accepted = {
      ...projectFixture("project-1", "Project", "/project", {
        uiState: { dataVis: { nvBackColor: "white" } },
      }),
      acceptedRevision: 1,
    };
    vi.mocked(invoke).mockResolvedValueOnce(accepted);
    useVisualizationStore.getState().setNvBackColor("white");
    expect(acceptedVisualizationSettings().nvBackColor).toBe("black");
    await useProjectStore.getState().flushEdits();
    expect(acceptedVisualizationSettings().nvBackColor).toBe("white");
    expect(useProjectStore.getState().isDirty).toBe(true);
  });
});
