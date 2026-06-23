import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisualizationStore } from "../../stores/visualizationStore";
import ChartPanel from "./ChartPanel";

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

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      project: { projectMeta: { rootPath: "/test/project" } },
    }),
}));

afterEach(cleanup);

function renderComponent() {
  return render(
    <MantineProvider>
      <ChartPanel />
    </MantineProvider>,
  );
}

describe("ChartPanel", () => {
  beforeEach(() => {
    useVisualizationStore.setState({
      axisAssignment: { x: null, y: null, colorBy: null },
      columnTypes: {},
      inspection: null,
      contractSources: [],
      chartData: [],
      selectedPointId: null,
      domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
    });
  });

  it("shows prompt when no axes selected", () => {
    renderComponent();
    expect(screen.getByTestId("chart-panel")).toHaveTextContent("Select X and Y columns to begin.");
  });

  it("shows prompt when only X selected", () => {
    useVisualizationStore.setState({
      axisAssignment: { x: "age", y: null, colorBy: null },
    });
    renderComponent();
    expect(screen.getByTestId("chart-panel")).toHaveTextContent(
      "Assign both X and Y to render the chart.",
    );
  });

  it("shows unsupported message when Y is not continuous", () => {
    useVisualizationStore.setState({
      axisAssignment: { x: "age", y: "group", colorBy: null },
      columnTypes: { age: "continuous", group: "nominal" },
      inspection: {
        columns: [
          { name: "age", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
          { name: "group", units: "", inferredType: "nominal", levels: [], isIdentifier: false },
        ],
        rowCount: 5,
        fileHash: "abc",
      },
    });
    renderComponent();
    expect(screen.getByTestId("chart-panel")).toHaveTextContent("Unsupported combination");
  });

  it("shows empty data message when no plottable points", () => {
    useVisualizationStore.setState({
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      inspection: {
        columns: [
          { name: "age", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
          { name: "score", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
        ],
        rowCount: 5,
        fileHash: "abc",
      },
      chartData: [],
      contractSources: [{ relativePath: "test.tsv", fileHash: "abc" }],
    });
    renderComponent();
    expect(screen.getByTestId("chart-panel")).toHaveTextContent("No plottable data");
  });

  it("renders scatter canvas for continuous×continuous", () => {
    useVisualizationStore.setState({
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      inspection: {
        columns: [
          { name: "age", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
          { name: "score", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
        ],
        rowCount: 5,
        fileHash: "abc",
      },
      chartData: [
        { x: 25, y: 100, id: "1", participantId: "p1", subject: "s1", session: "01", run: "01" },
        { x: 30, y: 110, id: "2", participantId: "p2", subject: "s2", session: "01", run: "01" },
      ],
      contractSources: [{ relativePath: "test.tsv", fileHash: "abc" }],
    });
    renderComponent();
    expect(screen.getByTestId("scatter-canvas")).toBeInTheDocument();
  });

  it("renders swarm canvas for categorical×continuous", () => {
    useVisualizationStore.setState({
      axisAssignment: { x: "group", y: "score", colorBy: null },
      columnTypes: { group: "nominal", score: "continuous" },
      inspection: {
        columns: [
          {
            name: "group",
            units: "",
            inferredType: "nominal",
            levels: ["A", "B"],
            isIdentifier: false,
          },
          { name: "score", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
        ],
        rowCount: 5,
        fileHash: "abc",
      },
      chartData: [
        { x: "A", y: 100, id: "1", participantId: "p1", subject: "s1", session: "01", run: "01" },
        { x: "B", y: 110, id: "2", participantId: "p2", subject: "s2", session: "01", run: "01" },
      ],
      contractSources: [{ relativePath: "test.tsv", fileHash: "abc" }],
    });
    renderComponent();
    expect(screen.getByTestId("swarm-canvas")).toBeInTheDocument();
  });

  it("computes linear scale bounds with 5% padding by default", () => {
    useVisualizationStore.setState({
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      inspection: {
        columns: [
          { name: "age", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
          { name: "score", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
        ],
        rowCount: 5,
        fileHash: "abc",
      },
      chartData: [
        { x: 20, y: 100, id: "1", participantId: "p1", subject: "s1", session: "01", run: "01" },
        { x: 40, y: 200, id: "2", participantId: "p2", subject: "s2", session: "01", run: "01" },
      ],
      contractSources: [{ relativePath: "test.tsv", fileHash: "abc" }],
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
    useVisualizationStore.setState({
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      inspection: {
        columns: [
          { name: "age", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
          { name: "score", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
        ],
        rowCount: 5,
        fileHash: "abc",
      },
      chartData: [
        { x: 20, y: 100, id: "1", participantId: "p1", subject: "s1", session: "01", run: "01" },
        { x: 40, y: 200, id: "2", participantId: "p2", subject: "s2", session: "01", run: "01" },
      ],
      contractSources: [{ relativePath: "test.tsv", fileHash: "abc" }],
      domainFilters: { xMin: 15, xMax: 45, yMin: 90, yMax: 210 },
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
    useVisualizationStore.setState({
      axisAssignment: { x: "age", y: "score", colorBy: null },
      columnTypes: { age: "continuous", score: "continuous" },
      inspection: {
        columns: [
          { name: "age", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
          { name: "score", units: "", inferredType: "continuous", levels: [], isIdentifier: false },
        ],
        rowCount: 5,
        fileHash: "abc",
      },
      chartData: [
        { x: 25, y: 100, id: "1", participantId: "p1", subject: "s1", session: "01", run: "01" },
      ],
      contractSources: [{ relativePath: "test.tsv", fileHash: "abc" }],
      selectedPointId: "1",
    });

    const selectPointSpy = vi.spyOn(useVisualizationStore.getState(), "selectPoint");

    renderComponent();

    selectPointSpy.mockClear();

    // Simulate opening settings drawer
    useVisualizationStore.setState({ filtersExpanded: true });

    expect(selectPointSpy).not.toHaveBeenCalledWith(null);
  });
});
