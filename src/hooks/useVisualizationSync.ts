import { useEffect, useRef } from "react";
import {
  useVisualizationStore,
  type StepperStage,
  type NvSliceType,
  type NvBackColor,
} from "../stores/visualizationStore";
import { useProjectStore } from "../stores/projectStore";

const AUTOSAVE_DEBOUNCE_MS = 2000;

const VALID_STAGES: readonly StepperStage[] = [
  "selectFile",
  "columnTypes",
  "levelOrdering",
  "visualize",
] as const;

function extractPersisted(state: ReturnType<typeof useVisualizationStore.getState>) {
  return {
    contractSources: state.contractSources,
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

  // Hydrate from project store on mount
  useEffect(() => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    const dataVis = project.uiState?.dataVis;
    if (!dataVis) return;

    const store = useVisualizationStore.getState();

    if (dataVis.contractSources) store.setContractSources(dataVis.contractSources);
    if (dataVis.columnTypes) store.setColumnTypes(dataVis.columnTypes);
    if (dataVis.identifiers) store.setIdentifiers(dataVis.identifiers);
    if (dataVis.levelOrderings) store.setLevelOrderings(dataVis.levelOrderings);
    if (dataVis.axisAssignment) store.setAxisAssignment(dataVis.axisAssignment);
    if (dataVis.domainFilters) store.setDomainFilters(dataVis.domainFilters);
    if (dataVis.stage && VALID_STAGES.includes(dataVis.stage as StepperStage)) {
      store.setStage(dataVis.stage as StepperStage);
    }
    if (dataVis.splitRatio !== undefined) store.setSplitRatio(dataVis.splitRatio);
    if (dataVis.filtersExpanded !== undefined) store.setFiltersExpanded(dataVis.filtersExpanded);
    if (dataVis.pointSize !== undefined) store.setPointSize(dataVis.pointSize);
    if (dataVis.swarmSpacing !== undefined) store.setSwarmSpacing(dataVis.swarmSpacing);
    if (dataVis.chartOpacity !== undefined) store.setChartOpacity(dataVis.chartOpacity);
    if (dataVis.showGridX !== undefined) store.setShowGridX(dataVis.showGridX);
    if (dataVis.showGridY !== undefined) store.setShowGridY(dataVis.showGridY);
    if (dataVis.nvRadiological !== undefined) store.setNvRadiological(dataVis.nvRadiological);
    if (dataVis.nvColorbar !== undefined) store.setNvColorbar(dataVis.nvColorbar);
    if (dataVis.nvCrosshair !== undefined) store.setNvCrosshair(dataVis.nvCrosshair);
    if (dataVis.nvCornerOrientation !== undefined)
      store.setNvCornerOrientation(dataVis.nvCornerOrientation);
    if (dataVis.nvColormap !== undefined) store.setNvColormap(dataVis.nvColormap);
    if (dataVis.nvSliceType !== undefined) store.setNvSliceType(dataVis.nvSliceType as NvSliceType);
    if (dataVis.nvBackColor !== undefined) store.setNvBackColor(dataVis.nvBackColor as NvBackColor);
    if (dataVis.xTickSize !== undefined) store.setXTickSize(dataVis.xTickSize);
    if (dataVis.xTickPadding !== undefined) store.setXTickPadding(dataVis.xTickPadding);
    if (dataVis.xTickRotation !== undefined) store.setXTickRotation(dataVis.xTickRotation);
    if (dataVis.xLegendOverride !== undefined) store.setXLegendOverride(dataVis.xLegendOverride);
    if (dataVis.xLegendOffset !== undefined) store.setXLegendOffset(dataVis.xLegendOffset);
    if (dataVis.yTickSize !== undefined) store.setYTickSize(dataVis.yTickSize);
    if (dataVis.yTickPadding !== undefined) store.setYTickPadding(dataVis.yTickPadding);
    if (dataVis.yTickRotation !== undefined) store.setYTickRotation(dataVis.yTickRotation);
    if (dataVis.yLegendOverride !== undefined) store.setYLegendOverride(dataVis.yLegendOverride);
    if (dataVis.yLegendOffset !== undefined) store.setYLegendOffset(dataVis.yLegendOffset);
  }, []);

  // Subscribe to persisted field changes → sync to project store with debounced save
  useEffect(() => {
    let prevPersisted = extractPersisted(useVisualizationStore.getState());

    const unsubscribe = useVisualizationStore.subscribe((state) => {
      const project = useProjectStore.getState().project;
      if (!project) return;

      const persisted = extractPersisted(state);

      // Skip if persisted fields haven't changed
      if (JSON.stringify(prevPersisted) === JSON.stringify(persisted)) return;
      prevPersisted = persisted;

      // Update project store's uiState.dataVis
      useProjectStore.setState((prev) => ({
        project: prev.project
          ? {
              ...prev.project,
              uiState: {
                ...prev.project.uiState,
                dataVis: persisted,
              },
              isDirty: true,
            }
          : null,
      }));

      if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = setTimeout(() => {
        useProjectStore.getState().saveProject().catch(console.error);
        autosaveTimerRef.current = null;
      }, AUTOSAVE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current);
    };
  }, []);
}
