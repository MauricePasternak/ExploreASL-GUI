import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Niivue, NVImage } from "@niivue/niivue";
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
    setColormap = vi.fn((id: string, colormap: string) => {
      this.volumes.find((volume) => volume.id === id)!.colormap = colormap;
    });
    addVolume(volume: NVImage) {
      this.volumes = [volume];
    }
    updateGLVolume = vi.fn();
    removeVolumeByIndex = vi.fn((index: number) => {
      this.volumes.splice(index, 1);
    });
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
      <NiftiViewer
        pane="primary"
        modality="qCBF"
        scan={
          useVisualizationStore
            .getState()
            .chartData.find((p) => p.id === useVisualizationStore.getState().selectedPointId) ??
          null
        }
      />
    </MantineProvider>,
  );
}

describe("NiftiViewer", () => {
  beforeEach(() => {
    resetProjectLifecycleForTests();
    useVisualizationStore.setState({
      selectedPointId: null,
      chartData: [],
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

  it("shows WebGL2 error when unavailable", async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof originalGetContext;
    renderComponent();
    expect(await screen.findByTestId("viewer-error")).toHaveTextContent("WebGL2 not available");
  });

  it("renders canvas when webgl available", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;
    renderComponent();
    expect(screen.getByTestId("niivue-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("primary-hover")).toHaveTextContent("—");
  });

  it.each([1738, 60])(
    "ignores stale qCBF cal_max %i and preserves voxel scaling",
    async (calMax) => {
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
      header.setFloat32(128, 50, true); // cal_min inside scaled range
      header.setFloat32(124, calMax, true); // stale limits may also be inside scaled range
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(new Uint8Array(bytes).buffer)),
      );
      const decode = vi.spyOn(NVImage, "loadFromUrl");
      const install = vi.spyOn(Niivue.prototype, "addVolume");
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
      });

      renderComponent();
      expect(screen.getByTestId("nifti-viewer-header")).toHaveTextContent(
        "Subject: Subject01 | Session: 02 | Run: 01",
      );
      await waitFor(() =>
        expect(decode).toHaveBeenCalledWith(
          expect.objectContaining({
            url: "niivue://localhost/qCBF/sub-01/01.nii.gz",
            name: "qCBF_sub-01_01.nii.gz",
          }),
        ),
      );
      await waitFor(() => expect(install).toHaveBeenCalledOnce());
      const volume = install.mock.calls[0][0];
      expect(volume.cal_min).toBeGreaterThanOrEqual(50);
      expect(volume.cal_max).toBeLessThanOrEqual(90);
      expect(volume.cal_max! - volume.cal_min!).toBeGreaterThan(20);
      expect(volume.img).toEqual(voxels);
      expect(volume.hdr!.scl_slope).toBe(2);
      expect(volume.hdr!.scl_inter).toBe(10);
      expect(header.getFloat32(124, true)).toBe(calMax); // source bytes unchanged
      volume.colormap = "gray";
      expect(volume.cal_max! - volume.cal_min!).toBeGreaterThan(20);
      const nv = install.mock.contexts[0] as Niivue;
      nv.screenSlices = [
        { leftTopWidthHeight: [0, 0, 200, 200], axCorSag: 0 } as Niivue["screenSlices"][number],
      ];
      vi.spyOn(nv, "canvasPos2frac").mockReturnValue([0, 0, 0]);
      vi.spyOn(nv, "frac2mm").mockReturnValue([0, 0, 0, 1]);
      const voxel = vi.spyOn(volume, "mm2vox").mockReturnValue([0, 0, 0]);
      const sample = vi.spyOn(volume, "getValue");
      const canvas = screen.getByTestId("niivue-canvas") as HTMLCanvasElement;
      canvas.width = canvas.height = 200;
      vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      } as DOMRect);
      const draws = vi.mocked(nv.drawScene).mock.calls.length;
      fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10 });
      fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10 });
      await waitFor(() =>
        expect(screen.getByTestId("primary-hover")).toHaveTextContent("CBF 50 mL/100g/min"),
      );
      expect(nv.canvasPos2frac).toHaveBeenCalledWith([20, 20]);
      expect(sample).toHaveBeenCalledTimes(1);
      expect(vi.mocked(nv.drawScene).mock.calls).toHaveLength(draws);
      expect(fetch).toHaveBeenCalledTimes(1);
      voxel.mockReturnValue([-1, 0, 0]);
      fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20 });
      await waitFor(() => expect(screen.getByTestId("primary-hover")).toHaveTextContent("—"));
      expect(sample).toHaveBeenCalledTimes(1);
    },
  );

  it("auto-windows rT1 independently of CBF limits and stale in-range header limits", async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;
    const voxels = Float32Array.from({ length: 8 ** 3 }, (_, i) => -100 + (i % 21) * 200);
    const bytes = NVImage.createNiftiArray([8, 8, 8], [1, 1, 1], undefined, 16, voxels);
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    header.setFloat32(124, 118, true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(bytes).buffer)),
    );
    const install = vi.spyOn(Niivue.prototype, "addVolume");
    render(
      <MantineProvider env="test">
        <NiftiViewer
          pane="companion"
          modality="rT1"
          scan={{ id: "A", participantId: "A", subject: "A", session: "1", run: "ASL_1" }}
          windowLimits={[20, 80]}
        />
      </MantineProvider>,
    );
    await waitFor(() => expect(install).toHaveBeenCalledOnce());
    const volume = install.mock.calls[0][0];
    expect(volume.cal_max).toBeGreaterThan(3000);
    volume.colormap = "gray";
    expect(volume.cal_max).toBeGreaterThan(3000);
    expect(volume.img).toEqual(voxels);
    expect(header.getFloat32(124, true)).toBe(118);
  });

  it("renders error overlay when loading fails", async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;

    const decode = vi.spyOn(NVImage, "loadFromUrl").mockRejectedValue(new Error("Failed to load"));

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
    });

    renderComponent();
    const errorEl = await screen.findByTestId("viewer-error");
    expect(errorEl).toHaveTextContent("Failed to load image for sub-01_01.");

    decode.mockRestore();
  });

  it("discards a viewer completion from a replaced same-ID lifecycle", async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === "webgl2") return {} as WebGL2RenderingContext;
      return originalGetContext.call(document.createElement("canvas"), type);
    }) as typeof originalGetContext;
    let resolveLoad!: (image: NVImage) => void;
    const install = vi.spyOn(Niivue.prototype, "addVolume");
    const decode = vi.spyOn(NVImage, "loadFromUrl").mockImplementation(
      () =>
        new Promise<NVImage>((resolve) => {
          resolveLoad = resolve;
        }),
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
    });
    renderComponent();
    await waitFor(() => expect(resolveLoad).toBeTypeOf("function"));

    invalidateProjectLease();
    activateProjectLease("same-id", "/project-b");
    useVisualizationStore.getState().reset();
    resolveLoad({} as NVImage);
    await Promise.resolve();

    expect(install).not.toHaveBeenCalled();
    expect(useVisualizationStore.getState().selectedPointId).toBeNull();
    decode.mockRestore();
  });
});
