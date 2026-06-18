import { useEffect, useRef } from "react";

import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";

const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * Hydrates processing store from project file on mount, then subscribes
 * to processing store changes and syncs them back to the project store
 * with debounced saves.
 *
 * Use this hook in the processing page component.
 */
export function useProcessingSync() {
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from project store on mount
  useEffect(() => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    const processing = project.uiState.processing;

    if (processing?.config) {
      useProcessingStore.getState().setConfig(processing.config);
    }
    if (processing?.currentPhase !== undefined) {
      useProcessingStore.getState().setPhase(processing.currentPhase);
    }

    // Scan subjects and load lock file statuses
    useProcessingStore.getState().scanAvailableSubjects();
    useProcessingStore.getState().loadLockFileStatus();
  }, []);

  // Subscribe to processing store changes → sync to project store
  useEffect(() => {
    const unsubscribe = useProcessingStore.subscribe((state) => {
      const project = useProjectStore.getState().project;
      if (!project) return;

      useProjectStore.getState().syncProcessingState({
        config: state.config,
        processingPhase: state.processingPhase,
      });

      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = setTimeout(() => {
        useProjectStore.getState().saveProject();
        autosaveTimerRef.current = null;
      }, AUTOSAVE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);
}
