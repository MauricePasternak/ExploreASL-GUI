import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { useVisualizationStore } from "../stores/visualizationStore";
import { __resetProjectRevisionForTests, useProjectStore } from "../stores/projectStore";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useVisualizationSync } from "./useVisualizationSync";
import {
  activateProjectLease,
  invalidateProjectLease,
  resetProjectLifecycleForTests,
} from "../lib/projectLifecycle";

describe("useVisualizationSync", () => {
  beforeEach(() => {
    resetProjectLifecycleForTests();
    __resetProjectRevisionForTests();
    useVisualizationStore.setState({
      qcbfSource: null,
      joinConfig: null,
      columnTypes: {},
      identifiers: null,
      levelOrderings: {},
      axisAssignment: { x: null, y: null, colorBy: null },
      domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
      stage: "selectData",
      splitRatio: 0.6,
      filtersExpanded: false,
      pointSize: 10,
      swarmSpacing: 2,
      chartOpacity: 0.8,
      showGridX: true,
      showGridY: true,
      nvRadiological: false,
      nvColorbar: true,
      nvCrosshair: true,
      nvCornerOrientation: false,
      nvColormap: "gray",
      nvSliceType: "multiplanar",
      nvBackColor: "black",
      xTickSize: 5,
      xTickPadding: 5,
      xTickRotation: -20,
      xLegendOverride: null,
      xLegendOffset: 36,
      yTickSize: 5,
      yTickPadding: 5,
      yTickRotation: 0,
      yLegendOverride: null,
      yLegendOffset: -40,
      availableFiles: [],
      inspection: null,
      chartData: [],
      selectedPointId: null,
      viewerState: { status: "idle" },
      viewerError: null,
      webglAvailable: false,
      exclusionCount: { plotted: 0, excluded: 0 },
    });
    useProjectStore.setState({ project: null, isDirty: false, loaded: false });
  });

  afterEach(() => {
    cleanup();
    resetProjectLifecycleForTests();
  });

  it("leaves coordinator-hydrated visualization state unchanged on mount", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "test",
          name: "Test",
          rootPath: "/tmp",
          createdAt: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          currentPhase: "visualization",
          dataSource: "dicom" as const,
        },
        uiState: {
          dataVis: {
            qcbfSource: { relativePath: "test.tsv", fileHash: "abc" },
            columnTypes: { GM_vol: "continuous" },
            stage: "columnTypes",
            pointSize: 15,
            nvColormap: "warm",
          },
        },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });
    useVisualizationStore.getState().hydrate({
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc" },
      columnTypes: { GM_vol: "continuous" },
      stage: "columnTypes",
      pointSize: 15,
      nvColormap: "warm",
    });
    activateProjectLease("test", "/tmp");

    renderHook(() => useVisualizationSync());

    const state = useVisualizationStore.getState();
    expect(state.qcbfSource).toEqual({ relativePath: "test.tsv", fileHash: "abc" });
    expect(state.columnTypes).toEqual({ GM_vol: "continuous" });
    expect(state.stage).toBe("columnTypes");
    expect(state.pointSize).toBe(15);
    expect(state.nvColormap).toBe("warm");
  });

  it("syncs visualization changes to top-level isDirty without nesting isDirty on project", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "test",
          name: "Test",
          rootPath: "/tmp",
          createdAt: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          currentPhase: "visualization",
          dataSource: "dicom" as const,
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });
    activateProjectLease("test", "/tmp");

    renderHook(() => useVisualizationSync());

    act(() => {
      useVisualizationStore.getState().setPointSize(22);
    });

    const project = useProjectStore.getState().project!;
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(project.uiState.dataVis?.pointSize).toBe(22);
    expect("isDirty" in project).toBe(false);
  });

  it("does not autosave a different project after a stale timer fires", () => {
    vi.useFakeTimers();
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-a",
          name: "Project A",
          rootPath: "/tmp/project-a",
          createdAt: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          currentPhase: "visualization",
          dataSource: "dicom" as const,
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
      saveProject,
    });
    activateProjectLease("project-a", "/tmp/project-a");

    renderHook(() => useVisualizationSync());

    act(() => {
      useVisualizationStore.getState().setPointSize(22);
    });

    invalidateProjectLease();
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-b",
          name: "Project B",
          rootPath: "/tmp/project-b",
          createdAt: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          currentPhase: "visualization",
          dataSource: "dicom" as const,
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
      },
      isDirty: true,
      loaded: true,
      saveProject,
    });
    activateProjectLease("project-b", "/tmp/project-b");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(saveProject).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("cancels pending autosave and waits for manual Save after external relink", () => {
    vi.useFakeTimers();
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-a",
          name: "Project A",
          rootPath: "/tmp/project-a",
          createdAt: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          currentPhase: "visualization",
          dataSource: "dicom" as const,
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
      saveProject,
    });
    useVisualizationStore.setState({
      joinConfig: {
        externalSource: { absolutePath: "/old.csv", fileHash: "same", sheetName: null },
        keys: [{ left: "participant_id", right: "SubjectID" }],
        dropRightOn: true,
        naTokens: [""],
        delimiter: ",",
      },
    });
    activateProjectLease("project-a", "/tmp/project-a");
    renderHook(() => useVisualizationSync());

    act(() => useVisualizationStore.getState().setPointSize(22));
    act(() =>
      useVisualizationStore.getState().relinkMatchingExternalSource({
        absolutePath: "/new.csv",
        fileHash: "same",
        sheetName: null,
      }),
    );
    act(() => vi.advanceTimersByTime(2000));

    expect(saveProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState()).toMatchObject({ isDirty: true });
    expect(
      useProjectStore.getState().project?.uiState.dataVis?.joinConfig?.externalSource.absolutePath,
    ).toBe("/new.csv");
    vi.useRealTimers();
  });
});
