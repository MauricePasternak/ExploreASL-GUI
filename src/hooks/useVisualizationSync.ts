import { useEffect, useRef } from "react";
import { useVisualizationStore, type StepperStage } from "../stores/visualizationStore";
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
