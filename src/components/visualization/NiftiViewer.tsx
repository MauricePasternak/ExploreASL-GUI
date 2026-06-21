import { Loader, Overlay, Skeleton, Stack, Text, useMantineColorScheme } from "@mantine/core";
import { MULTIPLANAR_TYPE, Niivue, SHOW_RENDER } from "@niivue/niivue";
import { useEffect, useMemo, useRef, useState } from "react";

import { useVisualizationStore } from "../../stores/visualizationStore";

function configureViewerLayout(nv: Niivue) {
  nv.setSliceType(nv.sliceTypeMultiplanar);
  nv.setMultiplanarLayout(MULTIPLANAR_TYPE.GRID);
  nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS;
  nv.drawScene();
}

export default function NiftiViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<Niivue | null>(null);
  const loadedPointIdRef = useRef<string | null>(null);
  const selectedPointId = useVisualizationStore((s) => s.selectedPointId);
  const chartData = useVisualizationStore((s) => s.chartData);
  const viewerState = useVisualizationStore((s) => s.viewerState);
  const setViewerState = useVisualizationStore((s) => s.setViewerState);
  const setWebglAvailable = useVisualizationStore((s) => s.setWebglAvailable);
  const webglAvailable = useVisualizationStore((s) => s.webglAvailable);

  const { colorScheme } = useMantineColorScheme();
  const [contextLost, setContextLost] = useState(false);
  const [nvReady, setNvReady] = useState(false);

  const point = useMemo(() => {
    return chartData.find((p) => p.id === selectedPointId) || null;
  }, [chartData, selectedPointId]);

  // Check WebGL2 availability on mount
  useEffect(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) {
      setWebglAvailable(false);
      setViewerState({
        status: "error",
        errorMessage: "WebGL2 not available. Cannot render NIfTI images.",
      });
    } else {
      setWebglAvailable(true);
    }
  }, []);

  // Initialize NiiVue once WebGL is available
  useEffect(() => {
    if (!webglAvailable || !canvasRef.current) return;

    const nv = new Niivue({
      dragAndDropEnabled: false,
      backColor: colorScheme === "dark" ? [0, 0, 0, 1] : [1, 1, 1, 1],
      show3Dcrosshair: true,
      loadingText: "",
    });

    nv.attachToCanvas(canvasRef.current);
    nv.setRadiologicalConvention(false);
    configureViewerLayout(nv);
    nvRef.current = nv;
    setNvReady(true);

    // Handle WebGL context loss
    const canvas = canvasRef.current;
    function handleContextLost(e: Event) {
      e.preventDefault();
      setContextLost(true);
      setViewerState({
        status: "error",
        errorMessage: "WebGL context lost. Restart the application to restore the viewer.",
      });
    }
    canvas.addEventListener("webglcontextlost", handleContextLost);

    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      nvRef.current = null;
      setNvReady(false);
    };
  }, [webglAvailable, setViewerState]);

  // Load volume when selectedPointId changes or NiiVue becomes ready
  useEffect(() => {
    if (!nvReady) return;

    async function loadVolume() {
      const nv = nvRef.current;
      console.log("[NiftiViewer] selectedPointId changed to:", selectedPointId);
      if (!nv) {
        console.warn("[NiftiViewer] NiiVue instance is not initialized yet");
        return;
      }
      if (!selectedPointId) {
        console.log("[NiftiViewer] No selectedPointId, clearing viewer");
        loadedPointIdRef.current = null;
        setViewerState({ status: "idle" });
        return;
      }

      if (!point) {
        console.error("[NiftiViewer] Datapoint not found in chartData for ID:", selectedPointId);
        return;
      }

      if (selectedPointId === loadedPointIdRef.current && nv.volumes.length > 0) {
        return;
      }

      console.log("[NiftiViewer] Found matching datapoint:", point);
      setViewerState({ status: "loading" });

      const url = `niivue://localhost/qCBF/${point.participantId}/${point.run}.nii.gz`;
      console.log("[NiftiViewer] Loading volume from URL:", url);

      // Extract the extension dynamically from the URL (e.g. .nii.gz or .nii)
      const urlParts = url.split("/");
      const lastSegment = urlParts[urlParts.length - 1];
      const dotIndex = lastSegment.indexOf(".");
      const ext = dotIndex !== -1 ? lastSegment.slice(dotIndex) : ".nii.gz";

      try {
        // Remove existing volumes before loading new one
        if (nv.volumes.length > 0) {
          console.log("[NiftiViewer] Removing existing volume:", nv.volumes[0].name);
          nv.removeVolumeByIndex(0);
        }

        await nv.loadVolumes([{ url, name: `qCBF_${point.participantId}_${point.run}${ext}` }]);
        console.log("[NiftiViewer] Volume loaded successfully");
        if (nv.volumes.length > 0) {
          nv.setColormap(nv.volumes[0].id, "gray");
        }
        configureViewerLayout(nv);
        nv.updateGLVolume();
        loadedPointIdRef.current = selectedPointId;
        setViewerState({ status: "loaded" });
      } catch (err) {
        console.error("[NiftiViewer] Failed to load NIfTI from URL:", url, err);
        setViewerState({
          status: "error",
          errorMessage: `Failed to load image for ${point.participantId}_${point.run}.`,
        });
      }
    }
    loadVolume();
  }, [selectedPointId, point, nvReady, setViewerState]);

  // Update background on theme change
  useEffect(() => {
    const nv = nvRef.current;
    if (!nv) return;
    nv.opts.backColor = colorScheme === "dark" ? [0, 0, 0, 1] : [1, 1, 1, 1];
    nv.drawScene();
  }, [colorScheme]);

  if (!webglAvailable) {
    return (
      <Stack data-testid="nifti-viewer" align="center" justify="center" h="100%">
        <Text c="red">
          {viewerState.errorMessage ?? "WebGL2 not available. Cannot render NIfTI images."}
        </Text>
      </Stack>
    );
  }

  if (contextLost) {
    return (
      <Stack data-testid="nifti-viewer" align="center" justify="center" h="100%">
        <Text c="red">WebGL context lost. Restart the application to restore the viewer.</Text>
      </Stack>
    );
  }

  return (
    <Stack data-testid="nifti-viewer" h="100%" gap={0}>
      {selectedPointId && point ? (
        <div
          data-testid="nifti-viewer-header"
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid rgba(128,128,128,0.2)",
            background: colorScheme === "dark" ? "#1a1a1a" : "#f8f9fa",
          }}
        >
          <Text size="sm" fw={500}>
            Subject: {point.subject || point.participantId} | Session: {point.session || "01"} |
            Run: {point.run || "01"}
          </Text>
        </div>
      ) : (
        <div
          data-testid="nifti-viewer-header-placeholder"
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid rgba(128,128,128,0.2)",
            background: colorScheme === "dark" ? "#1a1a1a" : "#f8f9fa",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Skeleton height={22} width={280} radius="xs" />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, width: "100%", position: "relative" }}>
        {!selectedPointId && (
          <>
            <Skeleton
              height="100%"
              width="100%"
              data-testid="nifti-viewer-image-skeleton"
              style={{ position: "absolute", top: 0, left: 0, zIndex: 0 }}
            />
            <Stack
              align="center"
              justify="center"
              h="100%"
              style={{ position: "absolute", zIndex: 1, width: "100%", top: 0, left: 0 }}
            >
              <Text
                c="dimmed"
                size="sm"
                fw={500}
                ta="center"
                px="md"
                data-testid="nifti-viewer-overlay-text"
              >
                Click on a datapoint to load in its respective qCBF image.
              </Text>
            </Stack>
          </>
        )}

        {viewerState.status === "loading" && (
          <Overlay
            center
            fixed={false}
            zIndex={2}
            color={colorScheme === "dark" ? "#000" : "#fff"}
            backgroundOpacity={0.85}
          >
            <Loader size="xl" />
          </Overlay>
        )}

        {viewerState.status === "error" && viewerState.errorMessage && selectedPointId && (
          <Overlay
            center
            fixed={false}
            zIndex={2}
            color={colorScheme === "dark" ? "#000" : "#fff"}
            opacity={0.85}
          >
            <Stack align="center" justify="center" h="100%" p="md">
              <Text c="red" size="sm" ta="center" fw={500} data-testid="viewer-error">
                {viewerState.errorMessage}
              </Text>
            </Stack>
          </Overlay>
        )}

        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            visibility: !selectedPointId ? "hidden" : "visible",
          }}
          data-testid="niivue-canvas"
        />
      </div>
    </Stack>
  );
}
