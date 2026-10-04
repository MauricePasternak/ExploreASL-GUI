import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisualizationStore } from "../../stores/visualizationStore";
import NiftiViewer from "./NiftiViewer";
import {
  activateProjectLease,
  invalidateProjectLease,
  resetProjectLifecycleForTests,
} from "../../lib/projectLifecycle";

vi.mock("@niivue/niivue", () => {
  class MockNiivue {
    attachToCanvas = vi.fn();
    setRadiologicalConvention = vi.fn();
    setSliceType = vi.fn();
    setMultiplanarLayout = vi.fn();
    setColormap = vi.fn();
    loadVolumes() {
      return Promise.resolve();
    }
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

const originalGetContext = HTMLCanvasElement.prototype.getContext;
function renderComponent() {
  return render(
    <MantineProvider env="test">
      <NiftiViewer />
    </MantineProvider>,
  );
}

describe("NiftiViewer", () => {
  beforeEach(() => {
    resetProjectLifecycleForTests();
    useVisualizationStore.setState({
      selectedPointId: null,
      chartData: [],
      viewerState: { status: "idle" },
      webglAvailable: false,
    });
  });

  afterEach(() => {
    cleanup();
    resetProjectLifecycleForTests();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("shows placeholder before click", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;
    renderComponent();
    expect(screen.getByTestId("nifti-viewer")).toHaveTextContent(
      "Click on a datapoint to load in its respective qCBF image.",
    );
  });

  it("shows WebGL2 error when unavailable", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof originalGetContext;
    renderComponent();
    expect(screen.getByTestId("nifti-viewer")).toHaveTextContent("WebGL2 not available");
  });

  it("renders canvas when webgl available", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;
    renderComponent();
    expect(screen.getByTestId("niivue-canvas")).toBeInTheDocument();
  });

  it("renders subject/session/run header when point is selected", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;

    useVisualizationStore.setState({
      selectedPointId: "sub-01_run-01",
      chartData: [
        {
          id: "sub-01_run-01",
          x: 10,
          y: 20,
          participantId: "sub-01",
          subject: "Subject01",
          session: "02",
          run: "01",
        },
      ],
      viewerState: { status: "loaded" },
      webglAvailable: true,
    });

    renderComponent();
    expect(screen.getByTestId("nifti-viewer-header")).toHaveTextContent(
      "Subject: Subject01 | Session: 02 | Run: 01",
    );
  });

  it("renders error overlay when loading fails", async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;

    const { Niivue } = await import("@niivue/niivue");
    const loadVolumesMock = vi
      .spyOn(Niivue.prototype, "loadVolumes")
      .mockRejectedValue(new Error("Failed to load"));

    useVisualizationStore.setState({
      selectedPointId: "sub-01_run-01",
      chartData: [
        {
          id: "sub-01_run-01",
          x: 10,
          y: 20,
          participantId: "sub-01",
          subject: "Subject01",
          session: "02",
          run: "01",
        },
      ],
      webglAvailable: true,
    });

    renderComponent();
    const errorEl = await screen.findByTestId("viewer-error");
    expect(errorEl).toHaveTextContent("Failed to load image for sub-01_01.");

    loadVolumesMock.mockRestore();
  });

  it("discards a viewer completion from a replaced same-ID lifecycle", async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;
    const { Niivue } = await import("@niivue/niivue");
    let resolveLoad!: () => void;
    const loadVolumesMock = vi.spyOn(Niivue.prototype, "loadVolumes").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }) as unknown as ReturnType<typeof Niivue.prototype.loadVolumes>,
    );
    activateProjectLease("same-id", "/project-a");
    useVisualizationStore.setState({
      selectedPointId: "point-a",
      chartData: [
        {
          id: "point-a",
          x: 10,
          y: 20,
          participantId: "sub-a",
          subject: "A",
          session: "01",
          run: "01",
        },
      ],
      webglAvailable: true,
    });
    renderComponent();
    await waitFor(() => expect(resolveLoad).toBeTypeOf("function"));

    invalidateProjectLease();
    activateProjectLease("same-id", "/project-b");
    useVisualizationStore.getState().reset();
    resolveLoad();
    await Promise.resolve();

    expect(useVisualizationStore.getState().viewerState).toEqual({ status: "idle" });
    expect(useVisualizationStore.getState().selectedPointId).toBeNull();
    loadVolumesMock.mockRestore();
  });
});
