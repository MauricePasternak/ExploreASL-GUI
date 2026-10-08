import { useEffect } from "react";
import { useProcessingStore } from "../stores/processingStore";
import { captureProjectLease, isCurrentProjectLease } from "../lib/projectLifecycle";

/** Runtime subject/lock discovery only. Configuration has no page-owned timer. */
export function useProcessingSync() {
  useEffect(() => {
    const lease = captureProjectLease();
    let cancelled = false;
    async function discover() {
      await Promise.resolve();
      if (cancelled || !isCurrentProjectLease(lease)) return;
      await useProcessingStore.getState().scanAvailableSubjects();
      if (cancelled || !isCurrentProjectLease(lease) || useProcessingStore.getState().activeRunId)
        return;
      await useProcessingStore.getState().loadLockFileStatus();
    }
    void discover();
    return () => {
      cancelled = true;
    };
  }, []);
}
