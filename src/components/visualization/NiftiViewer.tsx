import { Loader, Overlay, Skeleton, Text } from "@mantine/core";
import { MULTIPLANAR_TYPE, Niivue, NVImage, SHOW_RENDER } from "@niivue/niivue";
import { useEffect, useRef, useState } from "react";

import { visualizationSettings, type ScanIdentity } from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";
import { captureProjectLease, isCurrentProjectLease } from "../../lib/projectLifecycle";

const getBackColor = (color: string): [number, number, number, number] => {
  if (color === "white") return [1, 1, 1, 1];
  if (color === "gray") return [0.15, 0.15, 0.15, 1];
  return [0, 0, 0, 1];
};

function configureViewerLayout(nv: Niivue, sliceType: string) {
  if (sliceType === "multiplanar") {
    nv.setSliceType(nv.sliceTypeMultiplanar);
    nv.setMultiplanarLayout(MULTIPLANAR_TYPE.GRID);
    nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS;
  } else if (sliceType === "axial") nv.setSliceType(nv.sliceTypeAxial);
  else if (sliceType === "coronal") nv.setSliceType(nv.sliceTypeCoronal);
  else if (sliceType === "sagittal") nv.setSliceType(nv.sliceTypeSagittal);
  else if (sliceType === "render") nv.setSliceType(nv.sliceTypeRender);
}

export type CbfWindow = [number, number];
interface Props {
  scan: ScanIdentity | null;
  modality: "qCBF" | "rT1";
  pane: "primary" | "companion";
  onReady?: (pane: "primary" | "companion", viewer: Niivue | null) => void;
  onDisconnect?: (pane: "primary" | "companion") => void;
  onWindowChange?: (limits: CbfWindow) => void;
  windowLimits?: CbfWindow | null;
}

export default function NiftiViewer({
  scan,
  modality,
  pane,
  onReady,
  onDisconnect,
  onWindowChange,
  windowLimits,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<Niivue | null>(null);
  const generation = useRef(0);
  const lastWorld = useRef<ReturnType<Niivue["frac2mm"]> | null>(null);
  const project = useProjectStore((s) => s.project);
  const {
    nvRadiological,
    nvColorbar,
    nvCrosshair,
    nvCornerOrientation,
    nvColormap,
    nvSliceType,
    nvBackColor,
  } = visualizationSettings(project);
  const participantId = scan?.participantId;
  const run = modality === "qCBF" ? scan?.run : undefined;
  const requestKey = JSON.stringify([modality, participantId, run]);
  const [renderedRequest, setRenderedRequest] = useState(requestKey);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<{
    status: "idle" | "loading" | "loaded" | "error";
    message?: string;
  }>({ status: participantId ? "loading" : "idle" });
  const [hover, setHover] = useState("—");
  const [webglError, setWebglError] = useState<string | null>(null);
  if (renderedRequest !== requestKey) {
    setRenderedRequest(requestKey);
    setState({ status: participantId ? "loading" : "idle" });
    setHover("—");
  }
  const params = useRef({
    onReady,
    onDisconnect,
    onWindowChange,
    windowLimits,
    nvColormap,
    nvSliceType,
  });
  useEffect(() => {
    params.current = {
      onReady,
      onDisconnect,
      onWindowChange,
      windowLimits,
      nvColormap,
      nvSliceType,
    };
  }, [onReady, onDisconnect, onWindowChange, windowLimits, nvColormap, nvSliceType]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let mounted = true;
    if (!document.createElement("canvas").getContext("webgl2")) {
      void Promise.resolve().then(() => {
        if (mounted) setWebglError("WebGL2 not available. Cannot render NIfTI images.");
      });
      return () => {
        mounted = false;
      };
    }
    const nv = new Niivue({ dragAndDropEnabled: false, trustCalMinMax: false, loadingText: "" });
    nvRef.current = nv;
    void Promise.resolve(nv.attachToCanvas(canvas)).then(() => {
      if (mounted) setReady(true);
    });
    function contextLost(event: Event) {
      event.preventDefault();
      generation.current++;
      nv.broadcastTo([]);
      params.current.onReady?.(pane, null);
      setHover("—");
      setWebglError("WebGL context lost. Restart the application to restore the viewer.");
    }
    canvas.addEventListener("webglcontextlost", contextLost);
    return () => {
      mounted = false;
      canvas.removeEventListener("webglcontextlost", contextLost);
      nv.broadcastTo([]);
      params.current.onDisconnect?.(pane);
      nv.onIntensityChange = () => {};
      nv.cleanup();
      nvRef.current = null;
    };
  }, [pane]);

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !ready || webglError) return;
    nv.opts.isColorbar = nvColorbar;
    nv.opts.show3Dcrosshair = nvCrosshair;
    nv.opts.isCornerOrientationText = nvCornerOrientation;
    nv.opts.crosshairWidth = nvCrosshair ? 1 : 0;
    nv.setRadiologicalConvention(nvRadiological);
    nv.opts.backColor = getBackColor(nvBackColor);
    nv.opts.fontColor = nvBackColor === "white" ? [0, 0, 0, 1] : [1, 1, 1, 1];
    configureViewerLayout(nv, nvSliceType);
    const image = nv.volumes[0];
    if (image) {
      const colormap = modality === "rT1" ? "gray" : nvColormap;
      if (image.colormap !== colormap) nv.setColormap(image.id, colormap);
      if (modality === "qCBF" && params.current.windowLimits)
        [image.cal_min, image.cal_max] = params.current.windowLimits;
      nv.updateGLVolume();
    }
    nv.drawScene();
  }, [
    ready,
    webglError,
    modality,
    nvColorbar,
    nvCrosshair,
    nvCornerOrientation,
    nvRadiological,
    nvBackColor,
    nvSliceType,
    nvColormap,
  ]);

  useEffect(() => {
    const nv = nvRef.current;
    if (!ready || !nv || webglError) return;
    const request = ++generation.current;
    const lease = captureProjectLease();
    let active = true;
    const current = () =>
      active &&
      request === generation.current &&
      nvRef.current === nv &&
      (!lease || isCurrentProjectLease(lease));
    if (nv.volumes[0]) lastWorld.current = nv.frac2mm(nv.scene.crosshairPos);
    const world = lastWorld.current;
    nv.broadcastTo([]);
    params.current.onDisconnect?.(pane);
    nv.onIntensityChange = () => {};
    while (nv.volumes.length) nv.removeVolumeByIndex(0);
    const load = async () => {
      if (!participantId) return;
      const suffix = modality === "qCBF" ? `/${run}.nii.gz` : "";
      const name =
        modality === "qCBF" ? `qCBF_${participantId}_${run}.nii.gz` : `rT1_${participantId}.nii.gz`;
      try {
        const image = await NVImage.loadFromUrl({
          url: `niivue://localhost/${modality}/${participantId}${suffix}`,
          name,
          trustCalMinMax: false,
          // NiiVue still accepts in-range header limits; clear display calibration in memory only.
          cal_min: 0,
          cal_max: 0,
          colormap: modality === "rT1" ? "gray" : params.current.nvColormap,
        });
        if (!current()) return;
        const colormap = modality === "rT1" ? "gray" : params.current.nvColormap;
        if (image.colormap !== colormap) image.colormap = colormap;
        if (modality === "qCBF" && params.current.windowLimits)
          [image.cal_min, image.cal_max] = params.current.windowLimits;
        nv.addVolume(image);
        configureViewerLayout(nv, params.current.nvSliceType);
        nv.scene.crosshairPos = world ? nv.mm2frac(world) : [0.5, 0.5, 0.5];
        nv.onIntensityChange = (volume) => {
          if (
            current() &&
            modality === "qCBF" &&
            Number.isFinite(volume.cal_min) &&
            Number.isFinite(volume.cal_max)
          )
            params.current.onWindowChange?.([volume.cal_min!, volume.cal_max!]);
        };
        nv.updateGLVolume();
        setState({ status: "loaded" });
        params.current.onReady?.(pane, nv);
      } catch {
        if (current())
          setState({
            status: "error",
            message:
              modality === "qCBF"
                ? `Failed to load image for ${participantId}_${run}.`
                : `Failed to load structural image for ${participantId}.`,
          });
      }
    };
    void load();
    return () => {
      active = false;
      nv.broadcastTo([]);
      params.current.onDisconnect?.(pane);
      nv.onIntensityChange = () => {};
    };
  }, [participantId, run, modality, ready, pane, webglError]);

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || modality !== "qCBF" || !windowLimits || !nv.volumes[0] || webglError) return;
    [nv.volumes[0].cal_min, nv.volumes[0].cal_max] = windowLimits;
    nv.updateGLVolume();
  }, [windowLimits, modality, webglError]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const nv = nvRef.current;
    if (!canvas || !nv || state.status !== "loaded" || modality !== "qCBF" || webglError) return;
    let frame = 0;
    let position: [number, number] | null = null;
    let lastVoxel = "";
    const clear = () => {
      lastVoxel = "";
      setHover("—");
    };
    const sample = () => {
      frame = 0;
      const image = nv.volumes[0];
      if (!position || !image) {
        clear();
        return;
      }
      const [x, y] = position;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x >= canvas.width ||
        y >= canvas.height
      ) {
        clear();
        return;
      }
      const slice = nv.screenSlices.find(
        ({ leftTopWidthHeight: [left, top, width, height] }) =>
          x >= Math.min(left, left + width) &&
          x < Math.max(left, left + width) &&
          y >= top &&
          y < top + height,
      );
      if (!slice || slice.axCorSag < 0 || slice.axCorSag > 2) {
        clear();
        return;
      }
      const frac = nv.canvasPos2frac(position);
      if (Array.from(frac).some((v) => !Number.isFinite(v) || v < 0 || v > 1)) {
        clear();
        return;
      }
      const mm = nv.frac2mm(frac);
      const voxel = Array.from(image.mm2vox(Array.from(mm).slice(0, 3), true));
      const dims = image.dimsRAS;
      if (!dims || voxel.some((v, i) => !Number.isFinite(v) || v < 0 || v >= dims[i + 1])) {
        clear();
        return;
      }
      const nearest = voxel.map(Math.round);
      if (nearest.some((v, i) => v >= dims[i + 1])) {
        clear();
        return;
      }
      const key = nearest.join(",");
      if (key === lastVoxel) return;
      lastVoxel = key;
      const value = image.getValue(nearest[0], nearest[1], nearest[2]);
      setHover(
        Number.isFinite(value) && image.matRAS
          ? `CBF ${Number(value.toFixed(2))} mL/100g/min | ${Array.from(
              image.vox2mm(nearest, image.matRAS),
            )
              .slice(0, 3)
              .map((v) => v.toFixed(1))
              .join(", ")} mm`
          : "—",
      );
    };
    const move = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      position = [
        ((event.clientX - rect.left) * canvas.width) / rect.width,
        ((event.clientY - rect.top) * canvas.height) / rect.height,
      ];
      if (!frame) frame = requestAnimationFrame(sample);
    };
    const leave = () => {
      position = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clear();
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, [state.status, participantId, run, modality, webglError]);

  return (
    <div
      data-testid={pane === "primary" ? "nifti-viewer" : "companion-viewer"}
      className="dataviz-viewer"
    >
      <div
        data-testid={
          scan
            ? `${pane === "primary" ? "nifti-viewer" : "companion-viewer"}-header`
            : `${pane}-header-placeholder`
        }
        className="dataviz-viewer-header"
      >
        {scan ? (
          <>
            <Text size="sm" fw={600} data-testid={`${pane}-modality`}>
              {modality === "qCBF" ? "ASL · qCBF" : "Structural · rT1"}
            </Text>
            <Text size="xs" data-testid={`${pane}-identity`}>
              Subject: {scan.subject || scan.participantId} | Session: {scan.session || "01"}
              {modality === "qCBF" && ` | Run: ${scan.run || "01"}`}
            </Text>
          </>
        ) : (
          <Skeleton height={22} width="80%" />
        )}
      </div>
      <div data-testid={`${pane}-image`} className="dataviz-image">
        {!scan && !webglError && (
          <>
            <Skeleton
              height="100%"
              width="100%"
              data-testid={`${pane}-image-skeleton`}
              style={{ position: "absolute" }}
            />
            <Text
              data-testid={`${pane}-idle`}
              style={{ position: "absolute", inset: 20 }}
              ta="center"
            >
              Click on a datapoint to load in its respective qCBF image.
            </Text>
          </>
        )}
        {state.status === "loading" && !webglError && (
          <Overlay
            data-testid={`${pane}-loading`}
            role="status"
            aria-label={`Loading ${modality} image`}
            center
          >
            <Loader />
          </Overlay>
        )}
        {(webglError || state.status === "error") && (
          <Overlay data-testid={`${pane}-error`} role="alert" center>
            <Text c="red" data-testid={pane === "primary" ? "viewer-error" : "companion-error"}>
              {webglError || state.message}
            </Text>
          </Overlay>
        )}
        <canvas
          ref={canvasRef}
          data-testid={pane === "primary" ? "niivue-canvas" : "companion-canvas"}
          aria-label={`${modality} volume. Click or scroll slices; drag 3D to rotate.`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
            visibility: scan && state.status === "loaded" && !webglError ? "visible" : "hidden",
            backgroundColor: "#000",
          }}
        />
      </div>
      <div data-testid={`${pane}-viewer-footer`} className="dataviz-viewer-footer">
        {modality === "qCBF" ? (
          <Text size="xs" data-testid={`${pane}-hover`}>
            {hover}
          </Text>
        ) : (
          <Text size="xs" c="dimmed" data-testid={`${pane}-intensity-label`}>
            Structural intensity (a.u.)
          </Text>
        )}
        {modality === "qCBF" && windowLimits && (
          <Text size="xs" data-testid={`${pane}-cbf-window`}>
            CBF window: {windowLimits[0]}–{windowLimits[1]} mL/100g/min
          </Text>
        )}
      </div>
    </div>
  );
}
