import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisualizationStore } from "../../stores/visualizationStore";
import ChartPanel from "./ChartPanel";
import { useProjectStore } from "../../stores/projectStore";
import { projectView } from "../../schemas/project";
import { projectFixture } from "../../test/projectFixtures";
import {
  activateProjectLease,
  invalidateProjectLease,
  resetProjectLifecycleForTests,
} from "../../lib/projectLifecycle";

vi.mock("@nivo/scatterplot", () => ({
  ResponsiveScatterPlotCanvas: (props: any) => (
    <div
      data-testid="scatter-canvas"
      data-xscale={props.xScale ? JSON.stringify(props.xScale) : undefined}
      data-yscale={props.yScale ? JSON.stringify(props.yScale) : undefined}
    />
  ),
}));
vi.mock("@nivo/swarmplot", () => ({
  ResponsiveSwarmPlotCanvas: (props: any) => (
    <div
      data-testid="swarm-canvas"
      data-valuescale={props.valueScale ? JSON.stringify(props.valueScale) : undefined}
    />
  ),
}));

function renderComponent() {
  return render(
    <MantineProvider env="test">
      <ChartPanel />
    </MantineProvider>,
  );
}

describe("ChartPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectLifecycleForTests();
    useProjectStore.setState({
      project: projectView(
        projectFixture("same-id", "Test", "/test/project", { uiState: { dataVis: {} } }),
      ),
    });
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      axisAssignment: { x: null, y: null, colorBy: null },
      columnTypes: {},
      qcbfSource: null,
      joinConfig: null,
      domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
    });
    useVisualizationStore.setState({
      inspection: null,
      chartData: [],
      selectedPointId: null,
    });
  });

  afterEach(() => {
    cleanup();
    resetProjectLifecycleForTests();
  });

  it("discards chart rows loaded for a replaced lifecycle", async () => {
    let resolveRows!: (rows: Record<string, string>[]) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRows = resolve;
        }),
    );
    activateProjectLease("same-id", "/test/project");
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      qcbfSource: { relativePath: "old.tsv", fileHash: "old" },
    });
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "age",
            originalName: "age",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
          {
            name: "score",
            originalName: "score",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
        ],
        rowCount: 1,
        qcbfRowCount: 1,
        qcbfHash: "old",
        externalHash: null,
      },
    });
    renderComponent();
    await waitFor(() => expect(resolveRows).toBeTypeOf("function"));

    invalidateProjectLease();
    activateProjectLease("same-id", "/test/project");
    useVisualizationStore.getState().reset();
    const replacementPoint = {
      id: "replacement",
      x: 1,
      y: 2,
      participantId: "replacement",
      subject: "replacement",
      session: "01",
      run: "01",
    };
    useVisualizationStore.setState({ chartData: [replacementPoint] });
    resolveRows([{ age: "99", score: "99" }]);
    await Promise.resolve();

    expect(useVisualizationStore.getState().chartData).toEqual([replacementPoint]);
  });

  it("shows prompt when no axes selected", () => {
    renderComponent();
    expect(screen.getByTestId("chart-panel")).toHaveTextContent("Select X and Y columns to begin.");
  });

  it("shows prompt when only X selected", () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      axisAssignment: { x: "age", y: null, colorBy: null },
    });
    renderComponent();
    expect(screen.getByTestId("chart-panel")).toHaveTextContent(
      "Assign both X and Y to render the chart.",
    );
  });

  it("shows unsupported message when Y is not continuous", () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      axisAssignment: { x: "age", y: "group", colorBy: null },
      columnTypes: { age: "continuous", group: "nominal" },
    });
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "age",
            originalName: "age",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
          {
            name: "group",
            originalName: "group",
            source: "qcbf",
            units: "",
            inferredType: "nominal",
            levels: [],
            isIdentifier: false,
          },
        ],
        rowCount: 5,
        qcbfRowCount: 5,
        qcbfHash: "abc",
        externalHash: null,
      },
    });
    renderComponent();
    expect(screen.getByTestId("chart-panel")).toHaveTextContent("Unsupported combination");
  });

  it("shows empty data message when no plottable points", () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc" },
      joinConfig: null,
    });
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "age",
            originalName: "age",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
          {
            name: "score",
            originalName: "score",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
        ],
        rowCount: 5,
        qcbfRowCount: 5,
        qcbfHash: "abc",
        externalHash: null,
      },
      chartData: [],
    });
    renderComponent();
    expect(screen.getByTestId("chart-panel")).toHaveTextContent("No plottable data");
  });

  it("renders scatter canvas for continuous×continuous", () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc" },
      joinConfig: null,
    });
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "age",
            originalName: "age",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
          {
            name: "score",
            originalName: "score",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
        ],
        rowCount: 5,
        qcbfRowCount: 5,
        qcbfHash: "abc",
        externalHash: null,
      },
      chartData: [
        { x: 25, y: 100, id: "1", participantId: "p1", subject: "s1", session: "01", run: "01" },
        { x: 30, y: 110, id: "2", participantId: "p2", subject: "s2", session: "01", run: "01" },
      ],
    });
    renderComponent();
    expect(screen.getByTestId("scatter-canvas")).toBeInTheDocument();
  });

  it("renders swarm canvas for categorical×continuous", () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      axisAssignment: { x: "group", y: "score", colorBy: null },
      columnTypes: { group: "nominal", score: "continuous" },
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc" },
      joinConfig: null,
    });
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "group",
            originalName: "group",
            source: "qcbf",
            units: "",
            inferredType: "nominal",
            levels: ["A", "B"],
            isIdentifier: false,
          },
          {
            name: "score",
            originalName: "score",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
        ],
        rowCount: 5,
        qcbfRowCount: 5,
        qcbfHash: "abc",
        externalHash: null,
      },
      chartData: [
        { x: "A", y: 100, id: "1", participantId: "p1", subject: "s1", session: "01", run: "01" },
        { x: "B", y: 110, id: "2", participantId: "p2", subject: "s2", session: "01", run: "01" },
      ],
    });
    renderComponent();
    expect(screen.getByTestId("swarm-canvas")).toBeInTheDocument();
  });

  it("computes linear scale bounds with 5% padding by default", () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc" },
      joinConfig: null,
    });
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "age",
            originalName: "age",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
          {
            name: "score",
            originalName: "score",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
        ],
        rowCount: 5,
        qcbfRowCount: 5,
        qcbfHash: "abc",
        externalHash: null,
      },
      chartData: [
        { x: 20, y: 100, id: "1", participantId: "p1", subject: "s1", session: "01", run: "01" },
        { x: 40, y: 200, id: "2", participantId: "p2", subject: "s2", session: "01", run: "01" },
      ],
    });
    renderComponent();

    const canvas = screen.getByTestId("scatter-canvas");
    const xScale = JSON.parse(canvas.getAttribute("data-xscale") || "{}");
    const yScale = JSON.parse(canvas.getAttribute("data-yscale") || "{}");

    // X: min=20, max=40, range=20, pad=1 => min=19, max=41
    expect(xScale.min).toBe(19);
    expect(xScale.max).toBe(41);

    // Y: min=100, max=200, range=100, pad=5 => min=95, max=205
    expect(yScale.min).toBe(95);
    expect(yScale.max).toBe(205);
  });

  it("respects domain filters exactly when provided", () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc" },
      joinConfig: null,
      domainFilters: { xMin: 15, xMax: 45, yMin: 90, yMax: 210 },
    });
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "age",
            originalName: "age",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
          {
            name: "score",
            originalName: "score",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
        ],
        rowCount: 5,
        qcbfRowCount: 5,
        qcbfHash: "abc",
        externalHash: null,
      },
      chartData: [
        { x: 20, y: 100, id: "1", participantId: "p1", subject: "s1", session: "01", run: "01" },
        { x: 40, y: 200, id: "2", participantId: "p2", subject: "s2", session: "01", run: "01" },
      ],
    });
    renderComponent();

    const canvas = screen.getByTestId("scatter-canvas");
    const xScale = JSON.parse(canvas.getAttribute("data-xscale") || "{}");
    const yScale = JSON.parse(canvas.getAttribute("data-yscale") || "{}");

    expect(xScale.min).toBe(15);
    expect(xScale.max).toBe(45);
    expect(yScale.min).toBe(90);
    expect(yScale.max).toBe(210);
  });

  it("does not reset selected point when unrelated visualization store state changes", () => {
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      qcbfSource: { relativePath: "test.tsv", fileHash: "abc" },
      joinConfig: null,
    });
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "age",
            originalName: "age",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
          {
            name: "score",
            originalName: "score",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
        ],
        rowCount: 5,
        qcbfRowCount: 5,
        qcbfHash: "abc",
        externalHash: null,
      },
      chartData: [
        { x: 25, y: 100, id: "1", participantId: "p1", subject: "s1", session: "01", run: "01" },
      ],
      selectedPointId: "1",
    });

    const selectPointSpy = vi.spyOn(useVisualizationStore.getState(), "selectPoint");

    renderComponent();

    selectPointSpy.mockClear();

    // Simulate opening settings drawer
    useProjectStore.getState().acceptSnapshot({
      ...projectFixture("same-id", "Test", "/test/project", {
        uiState: {
          dataVis: {
            ...useProjectStore.getState().project!.uiState.dataVis,
            filtersExpanded: true,
          },
        },
      }),
      acceptedRevision: 1,
    });

    expect(selectPointSpy).not.toHaveBeenCalledWith(null);
  });
});
