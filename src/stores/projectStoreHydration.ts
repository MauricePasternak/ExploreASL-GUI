import { useDataParStore } from "./dataParStore";
import { useImportStore } from "./importStore";
import { useManifestStore } from "./manifestStore";
import { useProcessingStore } from "./processingStore";
import { useProjectStore } from "./projectStore";
import { useVisualizationStore } from "./visualizationStore";

/** Only transient state resets here. Accepted configuration stays in one cache. */
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
    pendingEdits: 0,
    draftErrors: {},
    saveError: null,
    saving: false,
  });
}
