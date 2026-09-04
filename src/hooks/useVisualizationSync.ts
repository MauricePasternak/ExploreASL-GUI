import { useEffect, useRef } from "react";
import { useVisualizationStore } from "../stores/visualizationStore";
import { useProjectStore } from "../stores/projectStore";
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
} from "../lib/projectLifecycle";

const AUTOSAVE_DEBOUNCE_MS = 2000;

export function extractPersistedVisualizationState(
  state: ReturnType<typeof useVisualizationStore.getState>,
) {
  return {
    qcbfSource: state.qcbfSource,
    joinConfig: state.joinConfig,
    columnTypes: state.columnTypes,
    identifiers: state.identifiers,
    levelOrderings: state.levelOrderings,
    axisAssignment: state.axisAssignment,
    domainFilters: state.domainFilters,
    stage: state.stage,
    splitRatio: state.splitRatio,
    filtersExpanded: state.filtersExpanded,
    pointSize: state.pointSize,
    swarmSpacing: state.swarmSpacing,
    chartOpacity: state.chartOpacity,
    showGridX: state.showGridX,
    showGridY: state.showGridY,
    nvRadiological: state.nvRadiological,
    nvColorbar: state.nvColorbar,
    nvCrosshair: state.nvCrosshair,
    nvCornerOrientation: state.nvCornerOrientation,
    nvColormap: state.nvColormap,
    nvSliceType: state.nvSliceType,
    nvBackColor: state.nvBackColor,
    xTickSize: state.xTickSize,
    xTickPadding: state.xTickPadding,
    xTickRotation: state.xTickRotation,
    xLegendOverride: state.xLegendOverride,
    xLegendOffset: state.xLegendOffset,
    yTickSize: state.yTickSize,
    yTickPadding: state.yTickPadding,
    yTickRotation: state.yTickRotation,
    yLegendOverride: state.yLegendOverride,
    yLegendOffset: state.yLegendOffset,
  };
}

export function useVisualizationSync() {
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to persisted field changes → sync to project store with debounced save
  useEffect(() => {
    let prevPersisted = extractPersistedVisualizationState(useVisualizationStore.getState());

    const unsubscribe = useVisualizationStore.subscribe((state) => {
      const project = useProjectStore.getState().project;
      if (!project) return;
      const lease = captureProjectLease();
      if (!lease || !isProjectWorkAccepted()) return;

      const persisted = extractPersistedVisualizationState(state);

      // Skip if persisted fields haven't changed
      if (JSON.stringify(prevPersisted) === JSON.stringify(persisted)) return;
      prevPersisted = persisted;

      useProjectStore.getState().syncVisualizationState(persisted);

      if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current);
      if (state.requiresManualSave) {
        autosaveTimerRef.current = null;
        return;
      }
      autosaveTimerRef.current = setTimeout(() => {
        const current = useProjectStore.getState();
        if (isCurrentProjectLease(lease) && isProjectWorkAccepted() && current.project) {
          current.saveProject().catch(console.error);
        }
        autosaveTimerRef.current = null;
      }, AUTOSAVE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current);
    };
  }, []);
}
