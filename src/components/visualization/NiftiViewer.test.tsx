import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Niivue } from "@niivue/niivue";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisualizationStore } from "../../stores/visualizationStore";
import NiftiViewer from "./NiftiViewer";
import {
  activateProjectLease,
  invalidateProjectLease,
  resetProjectLifecycleForTests,
} from "../../lib/projectLifecycle";

vi.mock("@niivue/niivue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@niivue/niivue")>();
  // Retain real viewer options; the windowing regression restores real volume loading.
  class MockNiivue extends actual.Niivue {
    attachToCanvas = vi.fn();
    setRadiologicalConvention = vi.fn();
    setSliceType = vi.fn();
    setMultiplanarLayout = vi.fn();
    setColormap = vi.fn();
    loadVolumes() {
      return Promise.resolve(this);
    }
    updateGLVolume = vi.fn();
    removeVolumeByIndex = vi.fn();
    drawScene = vi.fn();
    closePAQD = vi.fn();
    setVolume = vi.fn();
    cleanup = vi.fn();
  }
  return { ...actual, Niivue: MockNiivue };
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("loads qCBF with automatic windowing and renders subject/session/run header", async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;

    const actual = await vi.importActual<typeof import("@niivue/niivue")>("@niivue/niivue");
    const voxels = Float32Array.from({ length: 8 ** 3 }, (_, i) => 20 + (i % 21));
    const bytes = actual.NVImage.createNiftiArray([8, 8, 8], [1, 1, 1], undefined, 16, voxels);
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    header.setFloat32(112, 2, true); // scl_slope
    header.setFloat32(116, 10, true); // scl_inter
    header.setFloat32(124, 1738, true); // stale cal_max
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(bytes).buffer)),
    );
    const loadVolumesMock = vi
      .spyOn(Niivue.prototype, "loadVolumes")
      .mockImplementation(actual.Niivue.prototype.loadVolumes);
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
    await waitFor(() =>
      expect(loadVolumesMock).toHaveBeenCalledWith([
        expect.objectContaining({
          url: "niivue://localhost/qCBF/sub-01/01.nii.gz",
          name: "qCBF_sub-01_01.nii.gz",
        }),
      ]),
    );
    await waitFor(() => expect(useVisualizationStore.getState().viewerState.status).toBe("loaded"));
    const volume = (loadVolumesMock.mock.contexts[0] as Niivue).volumes[0];
    expect(volume.cal_min).toBeGreaterThanOrEqual(50);
    expect(volume.cal_max).toBeLessThanOrEqual(90);
    expect(volume.cal_max! - volume.cal_min!).toBeGreaterThan(20);
    expect(volume.img).toEqual(voxels);
    expect(volume.hdr!.scl_slope).toBe(2);
    expect(volume.hdr!.scl_inter).toBe(10);
    expect(volume.hdr!.cal_max).toBe(1738);
    loadVolumesMock.mockRestore();
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
