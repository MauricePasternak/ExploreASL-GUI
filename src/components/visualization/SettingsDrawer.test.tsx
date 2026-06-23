import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useVisualizationStore } from "../../stores/visualizationStore";
import SettingsDrawer from "./SettingsDrawer";

afterEach(cleanup);

function renderComponent() {
  return render(
    <MantineProvider>
      <SettingsDrawer />
    </MantineProvider>,
  );
}

describe("SettingsDrawer", () => {
  beforeEach(() => {
    useVisualizationStore.setState({
      chartData: [],
      domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
      filtersExpanded: false,
      pointSize: 6,
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
    });
  });

  it("does not render contents in DOM when closed", () => {
    renderComponent();
    expect(screen.queryByText("Nivo Chart Settings")).not.toBeInTheDocument();
  });

  it("renders settings drawer when filtersExpanded is true", () => {
    useVisualizationStore.setState({ filtersExpanded: true });
    renderComponent();

    // Verify drawer container and sections exist
    expect(screen.getByTestId("settings-drawer")).toBeInTheDocument();
    expect(screen.getByText("Nivo Chart Settings")).toBeInTheDocument();
    expect(screen.getByText("Axes Range Filters")).toBeInTheDocument();
    expect(screen.getByText("NiiVue Image Viewer Settings")).toBeInTheDocument();
  });

  it("renders chart options and switches correctly", () => {
    useVisualizationStore.setState({ filtersExpanded: true });
    renderComponent();

    expect(screen.getByTestId("setting-point-size")).toBeInTheDocument();
    expect(screen.getByTestId("setting-swarm-spacing")).toBeInTheDocument();
    expect(screen.getByTestId("setting-chart-opacity")).toBeInTheDocument();
    expect(screen.getByTestId("setting-show-grid-x")).toBeInTheDocument();
    expect(screen.getByTestId("setting-show-grid-y")).toBeInTheDocument();
  });

  it("renders axis range inputs", () => {
    useVisualizationStore.setState({ filtersExpanded: true });
    renderComponent();

    expect(screen.getByTestId("filter-x-min")).toBeInTheDocument();
    expect(screen.getByTestId("filter-x-max")).toBeInTheDocument();
    expect(screen.getByTestId("filter-y-min")).toBeInTheDocument();
    expect(screen.getByTestId("filter-y-max")).toBeInTheDocument();
  });

  it("renders X-Axis and Y-Axis settings", () => {
    useVisualizationStore.setState({ filtersExpanded: true });
    renderComponent();

    expect(screen.getByTestId("setting-x-legend-override")).toBeInTheDocument();
    expect(screen.getByTestId("setting-x-legend-offset")).toBeInTheDocument();
    expect(screen.getByTestId("setting-x-tick-size")).toBeInTheDocument();
    expect(screen.getByTestId("setting-x-tick-padding")).toBeInTheDocument();
    expect(screen.getByTestId("setting-x-tick-rotation")).toBeInTheDocument();

    expect(screen.getByTestId("setting-y-legend-override")).toBeInTheDocument();
    expect(screen.getByTestId("setting-y-legend-offset")).toBeInTheDocument();
    expect(screen.getByTestId("setting-y-tick-size")).toBeInTheDocument();
    expect(screen.getByTestId("setting-y-tick-padding")).toBeInTheDocument();
    expect(screen.getByTestId("setting-y-tick-rotation")).toBeInTheDocument();
  });

  it("renders NiiVue viewer settings", () => {
    useVisualizationStore.setState({ filtersExpanded: true });
    renderComponent();

    expect(screen.getByTestId("setting-nv-slice-type")).toBeInTheDocument();
    expect(screen.getByTestId("setting-nv-colormap")).toBeInTheDocument();
    expect(screen.getByTestId("setting-nv-back-color")).toBeInTheDocument();
    expect(screen.getByTestId("setting-nv-colorbar")).toBeInTheDocument();
    expect(screen.getByTestId("setting-nv-crosshair")).toBeInTheDocument();
    expect(screen.getByTestId("setting-nv-radiological")).toBeInTheDocument();
    expect(screen.getByTestId("setting-nv-corner-orientation")).toBeInTheDocument();
  });
});
