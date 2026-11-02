import { Box, Button, Checkbox, Group, NativeSelect, Stack, Text } from "@mantine/core";
import type { Niivue } from "@niivue/niivue";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  useVisualizationStore,
  visualizationSettings,
  type CompanionMode,
} from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";
import NiftiViewer, { type CbfWindow } from "./NiftiViewer";

export default function ScanComparisonPanel() {
  const selectedId = useVisualizationStore((s) => s.selectedPointId);
  const points = useVisualizationStore((s) => s.chartData);
  const pinned = useVisualizationStore((s) => s.pinnedScan);
  const mode = useVisualizationStore((s) => s.companionMode);
  const linked = useVisualizationStore((s) => s.linkNavigation);
  const shared = useVisualizationStore((s) => s.shareCbfWindow);
  const inspection = useVisualizationStore((s) => s.inspection);
  const project = useProjectStore((s) => s.project);
  const { axisAssignment, qcbfSource, columnTypes } = visualizationSettings(project);
  const primary = points.find((p) => p.id === selectedId) ?? null;
  const companion = mode === "pinned" ? pinned : mode === "structural" ? primary : null;
  const viewers = useRef<{ primary: Niivue | null; companion: Niivue | null }>({
    primary: null,
    companion: null,
  });
  const [loaded, setLoaded] = useState({ primary: false, companion: false });
  const [limits, setLimits] = useState<CbfWindow | null>(null);
  const primaryKey = JSON.stringify([primary?.participantId, primary?.run]);
  const companionKey = JSON.stringify([
    mode,
    companion?.participantId,
    mode === "pinned" ? companion?.run : null,
  ]);
  const [requests, setRequests] = useState({ primary: primaryKey, companion: companionKey });
  if (requests.primary !== primaryKey || requests.companion !== companionKey) {
    setRequests({ primary: primaryKey, companion: companionKey });
    setLoaded({
      primary: requests.primary === primaryKey && loaded.primary,
      companion: requests.companion === companionKey && loaded.companion,
    });
  }

  const onDisconnect = useCallback((pane: "primary" | "companion") => {
    const pair = viewers.current;
    pair.primary?.broadcastTo([]);
    pair.companion?.broadcastTo([]);
    pair[pane] = null;
  }, []);

  const onReady = useCallback(
    (pane: "primary" | "companion", viewer: Niivue | null) => {
      onDisconnect(pane);
      const pair = viewers.current;
      pair[pane] = viewer;
      setLoaded({ primary: !!pair.primary, companion: !!pair.companion });
    },
    [onDisconnect],
  );

  useEffect(() => {
    const { primary: a, companion: b } = viewers.current;
    if (!loaded.primary || !loaded.companion || !a || !b || !linked) return;
    b.scene.crosshairPos = b.mm2frac(a.frac2mm(a.scene.crosshairPos));
    b.scene.pan2Dxyzmm = [...a.scene.pan2Dxyzmm] as typeof b.scene.pan2Dxyzmm;
    b.drawScene();
    a.broadcastTo(b, { "2d": true, "3d": false });
    b.broadcastTo(a, { "2d": true, "3d": false });
    return () => {
      a.broadcastTo([]);
      b.broadcastTo([]);
    };
  }, [loaded, linked, mode]);

  const onWindowChange = useCallback((next: CbfWindow) => {
    const state = useVisualizationStore.getState();
    if (state.shareCbfWindow && state.companionMode === "pinned")
      setLimits((old) => (old?.[0] === next[0] && old[1] === next[1] ? old : next));
  }, []);

  const motion = inspection?.columns.find(
    (c) =>
      c.source === "qcbf" &&
      c.originalName === "MeanMotion" &&
      (columnTypes[c.name] ?? c.inferredType) !== "excluded",
  );
  function measurement(column: string | null, value: number | string | undefined) {
    const metadata = inspection?.columns.find((c) => c.name === column);
    return `${column ?? "—"}: ${value ?? "—"}${metadata?.units ? ` ${metadata.units}` : ""}${metadata ? ` (${metadata.source})` : ""}`;
  }

  return (
    <Stack data-testid="scan-comparison-panel" className="dataviz-comparison" gap="xs">
      <Group data-testid="comparison-controls" gap="sm" justify="space-between" align="flex-end">
        <Group data-testid="comparison-mode-controls" gap="xs" align="flex-end">
          <Text
            component="label"
            htmlFor="comparison-companion-mode"
            size="xs"
            fw={500}
            pb={6}
            data-testid="companion-mode-label"
          >
            Companion
          </Text>
          <NativeSelect
            data-testid="companion-mode"
            id="comparison-companion-mode"
            aria-label="Companion"
            size="xs"
            w={140}
            value={mode}
            onChange={(event) =>
              useVisualizationStore.getState().setCompanionMode(event.target.value as CompanionMode)
            }
          >
            <option value="off">Off</option>
            <option value="structural">Structural</option>
            <option value="pinned" disabled={!pinned}>
              Pinned
            </option>
          </NativeSelect>
          <Button
            data-testid="pin-current"
            size="xs"
            disabled={!primary}
            onClick={() => {
              if (primary) {
                setLimits(null);
                useVisualizationStore.getState().pinScan(primary);
              }
            }}
          >
            Pin current
          </Button>
          <Button
            data-testid="unpin"
            size="xs"
            variant="default"
            disabled={!pinned}
            onClick={() => {
              setLimits(null);
              useVisualizationStore.getState().unpinScan();
            }}
          >
            Unpin
          </Button>
        </Group>
        <Group data-testid="comparison-link-controls" gap="sm" pb={6}>
          <Checkbox
            data-testid="link-navigation"
            label="Link navigation"
            size="xs"
            checked={linked}
            onChange={(event) =>
              useVisualizationStore.getState().setLinkNavigation(event.currentTarget.checked)
            }
          />
          <Checkbox
            data-testid="share-cbf-window"
            label="Share CBF window"
            size="xs"
            disabled={mode !== "pinned" || !loaded.primary || !loaded.companion}
            checked={shared && mode === "pinned"}
            onChange={(event) => {
              const image = viewers.current.companion?.volumes[0];
              const enabled = event.currentTarget.checked;
              if (
                enabled &&
                image &&
                Number.isFinite(image.cal_min) &&
                Number.isFinite(image.cal_max)
              )
                setLimits([image.cal_min!, image.cal_max!]);
              else setLimits(null);
              useVisualizationStore.getState().setShareCbfWindow(enabled);
            }}
          />
        </Group>
      </Group>
      {pinned && (
        <Text size="xs" data-testid="pinned-identity">
          Pinned: {pinned.subject || pinned.participantId} | Session: {pinned.session} | Run:{" "}
          {pinned.run}
        </Text>
      )}
      {primary && (
        <Box data-testid="scan-measurements" className="dataviz-measurements">
          <Text
            size="xs"
            fw={500}
            className="dataviz-measurement-wide"
            data-testid="measurement-identity"
          >
            Subject: {primary.subject} | Session: {primary.session} | Run: {primary.run}
          </Text>
          <Text size="xs" data-testid="measurement-x">
            X — {measurement(axisAssignment.x, primary.x)}
          </Text>
          <Text size="xs" data-testid="measurement-y">
            Y — {measurement(axisAssignment.y, primary.y)}
          </Text>
          <Text size="xs" data-testid="measurement-motion">
            Mean motion:{" "}
            {motion && primary.meanMotion !== undefined
              ? `${primary.meanMotion} ${motion.units}`
              : "—"}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            className="dataviz-measurement-wide"
            data-testid="measurement-source"
          >
            Source: {qcbfSource?.relativePath.split(/[\\/]/).pop() ?? "—"}
          </Text>
        </Box>
      )}
      <Box data-testid="comparison-panes" className="dataviz-panes" data-companion={mode !== "off"}>
        <NiftiViewer
          pane="primary"
          modality="qCBF"
          scan={primary}
          onReady={onReady}
          onDisconnect={onDisconnect}
          onWindowChange={onWindowChange}
          windowLimits={shared && mode === "pinned" ? limits : null}
        />
        {mode !== "off" && (
          <NiftiViewer
            pane="companion"
            modality={mode === "structural" ? "rT1" : "qCBF"}
            scan={companion}
            onReady={onReady}
            onDisconnect={onDisconnect}
            onWindowChange={onWindowChange}
            windowLimits={shared && mode === "pinned" ? limits : null}
          />
        )}
      </Box>
    </Stack>
  );
}
