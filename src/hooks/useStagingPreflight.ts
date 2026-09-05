import { useEffect, useMemo } from "react";

import type { ImportPlan } from "../lib/importPlan";
import { fingerprintImportPlan, preflightStagingPlan } from "../lib/stagingPreflight";
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
  registerProjectTask,
} from "../lib/projectLifecycle";
import { useImportStore } from "../stores/importStore";

/** Runs only while Preview is mounted. Project restore therefore always needs a fresh check. */
export function useStagingPreflight(projectRoot: string, plan: ImportPlan) {
  const fingerprint = useMemo(() => fingerprintImportPlan(projectRoot, plan), [projectRoot, plan]);
  const state = useImportStore((store) => store.stagingPreflight);
  const begin = useImportStore((store) => store.beginStagingPreflight);
  const resolve = useImportStore((store) => store.resolveStagingPreflight);
  const fail = useImportStore((store) => store.failStagingPreflight);
  const reset = useImportStore((store) => store.resetStagingPreflight);

  useEffect(() => {
    let cancelled = false;
    if (!projectRoot || plan.localIssues.length > 0) {
      queueMicrotask(() => {
        if (!cancelled) reset();
      });
      return () => {
        cancelled = true;
      };
    }
    const lease = captureProjectLease();
    if (!lease || !isProjectWorkAccepted()) {
      queueMicrotask(() => {
        if (!cancelled) reset();
      });
      return () => {
        cancelled = true;
      };
    }
    const requestId = begin(fingerprint, lease);
    const task = preflightStagingPlan(plan.entries)
      .then((result) => {
        if (!cancelled && isCurrentProjectLease(lease) && isProjectWorkAccepted()) {
          resolve(requestId, fingerprint, lease, result);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && isCurrentProjectLease(lease) && isProjectWorkAccepted()) {
          fail(
            requestId,
            fingerprint,
            lease,
            error instanceof Error ? error.message : "Native preflight failed.",
          );
        }
      });
    try {
      void registerProjectTask(task);
    } catch {
      // Transition closed admission between render and scheduling.
    }
    return () => {
      cancelled = true;
    };
  }, [
    begin,
    fail,
    fingerprint,
    plan.entries,
    plan.localIssues.length,
    projectRoot,
    reset,
    resolve,
  ]);

  return { fingerprint, state };
}
