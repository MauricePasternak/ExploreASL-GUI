import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const GB_PER_WORKER = 4;
const MAX_DEFAULT_WORKERS = 4;
const DEFAULT_CORES = 4;
const DEFAULT_WORKERS = 4;

function calcDefaultWorkers(cores: number, memMb: number): number {
  const memGB = memMb / 1024;
  const workersByMemory = Math.floor(memGB / GB_PER_WORKER);
  return Math.min(workersByMemory, cores, MAX_DEFAULT_WORKERS);
}

export interface ProcessingEnvironment {
  systemCores: number;
  defaultWorkers: number;
}

// Module-level singleton cache: the IPC calls are identical across components on
// the same page, so dedupe them. The promise is shared; subscribers read the
// cached values once it resolves. A second hook mount reuses the in-flight
// promise rather than issuing a duplicate request.
interface CachedEnv {
  cores: number;
  memMb: number;
}

let envPromise: Promise<CachedEnv> | null = null;

function fetchEnvironment(): Promise<CachedEnv> {
  if (envPromise) return envPromise;
  envPromise = (async () => {
    const [cores, memMb] = await Promise.all([
      invoke<number>("get_cpu_cores").catch(() => DEFAULT_CORES),
      invoke<number>("get_available_memory_mb").catch(() => 0),
    ]);
    return { cores, memMb };
  })();
  envPromise.catch(() => {
    // Allow retry on next mount after a failure.
    envPromise = null;
  });
  return envPromise;
}

/** Test-only: reset the singleton cache between test cases. */
export function __resetProcessingEnvironmentCacheForTests() {
  envPromise = null;
}

export function useProcessingEnvironment(): ProcessingEnvironment {
  const [env, setEnv] = useState<ProcessingEnvironment>({
    systemCores: 0,
    defaultWorkers: 0,
  });

  useEffect(() => {
    let active = true;
    fetchEnvironment()
      .then(({ cores, memMb }) => {
        if (!active) return;
        setEnv({
          systemCores: cores,
          defaultWorkers: memMb > 0 ? calcDefaultWorkers(cores, memMb) : DEFAULT_WORKERS,
        });
      })
      .catch(() => {
        if (!active) return;
        setEnv({ systemCores: DEFAULT_CORES, defaultWorkers: DEFAULT_WORKERS });
      });
    return () => {
      active = false;
    };
  }, []);

  return env;
}
