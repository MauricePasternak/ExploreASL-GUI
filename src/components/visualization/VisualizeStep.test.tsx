import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisualizationStore } from "../../stores/visualizationStore";
import VisualizeStep from "./VisualizeStep";

vi.mock("@nivo/scatterplot", () => ({
  ResponsiveScatterPlotCanvas: () => <div data-testid="scatter-canvas" />,
}));
vi.mock("@nivo/swarmplot", () => ({
  ResponsiveSwarmPlotCanvas: () => <div data-testid="swarm-canvas" />,
}));
vi.mock("@niivue/niivue", () => {
  class MockNiivue {
    attachToCanvas = vi.fn();
    setRadiologicalConvention = vi.fn();
    setSliceType = vi.fn();
    setMultiplanarLayout = vi.fn();
    setColormap = vi.fn();
    loadVolumes = vi.fn(() => Promise.resolve());
    updateGLVolume = vi.fn();
    removeVolumeByIndex = vi.fn();
    drawScene = vi.fn();
    volumes: unknown[] = [];
    opts = { backColor: [0, 0, 0, 1], multiplanarShowRender: 2 };
    sliceTypeMultiplanar = 4;
    cleanup = vi.fn();
    constructor() {}
  }
  return { Niivue: MockNiivue, MULTIPLANAR_TYPE: { GRID: 2 }, SHOW_RENDER: { ALWAYS: 1 } };
});
vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      project: { projectMeta: { rootPath: "/test/project" } },
    }),
}));

const originalGetContext = HTMLCanvasElement.prototype.getContext;
afterEach(cleanup);

function renderComponent() {
  return render(
    <MantineProvider>
      <VisualizeStep />
    </MantineProvider>,
  );
}

describe("VisualizeStep", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;
    useVisualizationStore.setState({
      splitRatio: 0.6,
      selectedPointId: null,
      chartData: [],
      viewerState: { status: "idle" },
      webglAvailable: false,
      axisAssignment: { x: null, y: null, colorBy: null },
      qcbfSource: null,
      joinConfig: null,
      domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
    });
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("renders the visualize step container", () => {
    renderComponent();
    expect(screen.getByTestId("dataviz-visualize-step")).toBeInTheDocument();
  });

  it("renders both panels", () => {
    renderComponent();
    expect(screen.getByTestId("dataviz-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("dataviz-viewer-panel")).toBeInTheDocument();
  });

  it("renders the panel group", () => {
    renderComponent();
    expect(screen.getByTestId("dataviz-panel-group")).toBeInTheDocument();
  });
});
