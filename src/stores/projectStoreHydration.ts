import type { ProjectFile } from "../schemas/project";
import { createInitialDataParState, useDataParStore } from "./dataParStore";
import { useImportStore } from "./importStore";
import { useManifestStore } from "./manifestStore";
import { useProcessingStore } from "./processingStore";
import { useProjectStore } from "./projectStore";
import { useVisualizationStore } from "./visualizationStore";

export function resetProjectStores(): void {
  useImportStore.getState().resetImport();
  useDataParStore.getState().resetDataPar();
  useProcessingStore.getState().hydrateProcessing();
  useManifestStore.getState().resetManifest();
  useVisualizationStore.getState().reset();
  useProjectStore.setState({
    project: null,
    isDirty: false,
    loaded: false,
    recovery: null,
    recoveredFromBackup: false,
  });
}

export function hydrateProjectStores(project: ProjectFile, isDirty: boolean): void {
  resetProjectStores();
  useProjectStore.setState({
    project,
    isDirty,
    loaded: true,
    recovery: null,
    recoveredFromBackup: false,
  });

  useImportStore.getState().loadPersistedState({
    ...project.mappingState,
    activeStep: project.uiState.import?.activeStep,
    importPhase: project.uiState.import?.currentPhase,
    importCompleted: project.uiState.import?.completed,
    mostRecentConfig: project.uiState.import?.mostRecentConfig,
    selectedProfileId: project.uiState.import?.selectedProfileId,
  });

  const initialDataPar = createInitialDataParState();
  useDataParStore.getState().loadDataPar(project.dataPar);
  useDataParStore.getState().setAdvancedVisibility({
    ...initialDataPar.advancedVisibility,
    ...project.uiState.datapar?.advancedVisibility,
  });
  useProcessingStore.getState().hydrateProcessing(project.uiState.processing);
  useVisualizationStore.getState().hydrate(project.uiState.dataVis);
}
