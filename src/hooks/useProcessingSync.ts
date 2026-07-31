import { useEffect, useRef } from "react";
import { shallow } from "zustand/shallow";

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

  // Subscribe to processing store changes → sync to project store.
  // Use a selector so the callback only fires when `config` or `processingPhase`
  // changes — NOT on every subjectStatuses/workerPids update during a run
  // (those fire dozens of times per second and would hammer projectStore with
  // redundant syncProcessingState calls + JSON.stringify equality checks).
  useEffect(() => {
    const unsubscribe = useProcessingStore.subscribe(
      (state) => ({ config: state.config, processingPhase: state.processingPhase }),
      (slice) => {
        const project = useProjectStore.getState().project;
        if (!project) return;
        const projectId = project.projectMeta.id;

        useProjectStore.getState().syncProcessingState({
          config: slice.config,
          processingPhase: slice.processingPhase,
        });

        if (autosaveTimerRef.current !== null) {
          clearTimeout(autosaveTimerRef.current);
        }
        autosaveTimerRef.current = setTimeout(() => {
          const current = useProjectStore.getState();
          if (current.project?.projectMeta.id === projectId) {
            current.saveProject();
          }
          autosaveTimerRef.current = null;
        }, AUTOSAVE_DEBOUNCE_MS);
      },
      { equalityFn: shallow },
    );

    return () => {
      unsubscribe();
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);
}
