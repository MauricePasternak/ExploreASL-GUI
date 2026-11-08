import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Niivue, NVImage } from "@niivue/niivue";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisualizationStore } from "../../stores/visualizationStore";
import VisualizeStep from "./VisualizeStep";
import { useProjectStore } from "../../stores/projectStore";
import { projectFixture } from "../../test/projectFixtures";
import { projectView } from "../../schemas/project";

vi.mock("@nivo/scatterplot", () => ({
  ResponsiveScatterPlotCanvas: () => <div data-testid="scatter-canvas" />,
}));
vi.mock("@nivo/swarmplot", () => ({
  ResponsiveSwarmPlotCanvas: () => <div data-testid="swarm-canvas" />,
}));
vi.mock("@niivue/niivue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@niivue/niivue")>();
  class MockNiivue extends actual.Niivue {
    attachToCanvas = vi.fn();
    setRadiologicalConvention = vi.fn();
    setSliceType = vi.fn();
    setMultiplanarLayout = vi.fn();
    setColormap = vi.fn(() => {
      // Real NiiVue recalculates automatic limits whenever the colormap changes.
      this.volumes[0].cal_min = 10;
      this.volumes[0].cal_max = 80;
    });
    addVolume(image: NVImage) {
      this.volumes = [image];
    }
    frac2mm = vi.fn(() => [12, 24, 36, 1] as [number, number, number, number]);
    mm2frac = vi.fn(() => [0.2, 0.3, 0.4] as [number, number, number]);
    updateGLVolume = vi.fn();
    removeVolumeByIndex = vi.fn((index: number) => {
      this.volumes.splice(index, 1);
    });
    drawScene = vi.fn();
    cleanup = vi.fn();
  }
  return { ...actual, Niivue: MockNiivue };
});

const originalGetContext = HTMLCanvasElement.prototype.getContext;
afterEach(cleanup);

function renderComponent() {
  return render(
    <MantineProvider env="test">
      <VisualizeStep />
    </MantineProvider>,
  );
}

describe("VisualizeStep", () => {
  beforeEach(() => {
    vi.spyOn(NVImage, "loadFromUrl").mockImplementation(
      async () => ({ id: "image", cal_min: 10, cal_max: 80 }) as NVImage,
    );
    useProjectStore.setState({
      project: projectView(
        projectFixture("test", "Test", "/test/project", {
          uiState: {
            dataVis: {
              axisAssignment: { x: "age", y: "Total_GM_B", colorBy: null },
              qcbfSource: { relativePath: "CoV_qCBF.tsv", fileHash: "cov" },
            },
          },
        }),
      ),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;
    useVisualizationStore.setState({
      selectedPointId: null,
      chartData: [],
    });
    useVisualizationStore.getState().resetComparison();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("renders panels and keeps an independent pin across modes and primary clearing", async () => {
    await act(async () => {
      renderComponent();
    });
    expect(screen.getByTestId("dataviz-visualize-step")).toBeInTheDocument();
    expect(screen.getByTestId("dataviz-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("dataviz-viewer-panel")).toBeInTheDocument();
    expect(screen.getByTestId("dataviz-panel-group")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Companion" })).toHaveValue("off");
    act(() =>
      useVisualizationStore.setState({
        chartData: [
          {
            id: "A",
            x: 1,
            y: 2,
            participantId: "sub-A_1",
            subject: "A",
            session: "1",
            run: "ASL_1",
          },
        ],
        selectedPointId: "A",
      }),
    );
    fireEvent.click(screen.getByTestId("pin-current"));
    act(() =>
      useVisualizationStore.setState({
        chartData: [
          {
            id: "B",
            x: 2,
            y: 3,
            participantId: "sub-B_2",
            subject: "B",
            session: "2",
            run: "ASL_2",
          },
        ],
        selectedPointId: "B",
      }),
    );
    await waitFor(() =>
      expect(NVImage.loadFromUrl).toHaveBeenCalledWith(
        expect.objectContaining({ url: "niivue://localhost/qCBF/sub-B_2/ASL_2.nii.gz" }),
      ),
    );
    expect(screen.getByTestId("companion-viewer-header")).toHaveTextContent("Subject: A");
    fireEvent.change(screen.getByTestId("companion-mode"), { target: { value: "structural" } });
    await waitFor(() =>
      expect(NVImage.loadFromUrl).toHaveBeenCalledWith(
        expect.objectContaining({ url: "niivue://localhost/rT1/sub-B_2" }),
      ),
    );
    fireEvent.change(screen.getByTestId("companion-mode"), { target: { value: "pinned" } });
    act(() => useVisualizationStore.getState().selectPoint(null));
    expect(screen.getByTestId("companion-viewer-header")).toHaveTextContent("Subject: A");
    expect(screen.getAllByRole("combobox", { name: "Companion" })).toHaveLength(1);
    fireEvent.click(screen.getByTestId("unpin"));
    expect(screen.queryByTestId("companion-canvas")).not.toBeInTheDocument();
    act(() =>
      useVisualizationStore.setState({
        selectedPointId: "B",
        inspection: {
          columns: [
            {
              name: "Total_GM_B",
              originalName: "Total_GM_B",
              source: "qcbf",
              units: "SD/mean",
              inferredType: "continuous",
              levels: [],
              isIdentifier: false,
            },
          ],
          rowCount: 1,
          qcbfRowCount: 1,
          qcbfHash: "cov",
          externalHash: null,
        },
      }),
    );
    expect(screen.getByTestId("scan-measurements")).toHaveTextContent("SD/mean");
    expect(screen.getByTestId("scan-measurements")).toHaveTextContent("CoV_qCBF.tsv");
    expect(screen.getByTestId("scan-measurements")).not.toHaveTextContent("mL/100g/min");
    expect(screen.getByTestId("scan-measurements")).toHaveTextContent("Mean motion: —");
  });

  it("links world navigation and shares only pinned numeric CBF windows", async () => {
    const install = vi.spyOn(Niivue.prototype, "addVolume");
    await act(async () => {
      renderComponent();
    });
    act(() => {
      const scan = {
        id: "A",
        x: 1,
        y: 2,
        participantId: "A",
        subject: "A",
        session: "1",
        run: "1",
      };
      useVisualizationStore.setState({ chartData: [scan], selectedPointId: "A" });
      useVisualizationStore.getState().pinScan(scan);
    });
    await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    const [a, b] = install.mock.contexts as Niivue[];
    await waitFor(() => expect(a.otherNV).toEqual([b]));
    expect(b.otherNV).toEqual([a]);
    expect(b.mm2frac).toHaveBeenCalledWith([12, 24, 36, 1]);
    expect(a.syncOpts).toEqual({ "2d": true, "3d": false });
    fireEvent.click(screen.getByLabelText("Link navigation"));
    expect(a.otherNV).toEqual([]);
    expect(b.otherNV).toEqual([]);
    await waitFor(() => expect(screen.getByLabelText("Share CBF window")).toBeEnabled());
    b.volumes[0].cal_min = 20;
    fireEvent.click(screen.getByLabelText("Share CBF window"));
    await waitFor(() => expect(a.volumes[0].cal_min).toBe(20));
    act(() => {
      a.volumes[0].cal_max = 70;
      a.onIntensityChange(a.volumes[0]);
    });
    await waitFor(() => expect(b.volumes[0].cal_max).toBe(70));
    act(() =>
      useVisualizationStore.setState({
        chartData: [
          { id: "B", x: 2, y: 3, participantId: "B", subject: "B", session: "1", run: "1" },
        ],
        selectedPointId: "B",
      }),
    );
    await waitFor(() => expect(install).toHaveBeenCalledTimes(3));
    expect(a.volumes[0].cal_min).toBe(20);
    expect(a.volumes[0].cal_max).toBe(70);
    act(() => {
      const project = useProjectStore.getState().project!;
      useProjectStore.setState({
        project: {
          ...project,
          uiState: {
            ...project.uiState,
            dataVis: { ...project.uiState.dataVis!, nvColormap: "hot" },
          },
        },
      });
    });
    expect(a.volumes[0].cal_min).toBe(20);
    expect(a.volumes[0].cal_max).toBe(70);
    expect(b.volumes[0].cal_min).toBe(20);
    expect(b.volumes[0].cal_max).toBe(70);
    fireEvent.change(screen.getByTestId("companion-mode"), { target: { value: "structural" } });
    await waitFor(() => expect(install).toHaveBeenCalledTimes(4));
    expect(b.volumes[0].cal_min).toBe(10);
    expect(screen.getByLabelText("Share CBF window")).toBeDisabled();
    act(() =>
      useVisualizationStore.getState().pinScan(useVisualizationStore.getState().chartData[0]),
    );
    expect(useVisualizationStore.getState().shareCbfWindow).toBe(false);
  });
});
