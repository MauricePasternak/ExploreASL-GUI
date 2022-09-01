/**
 * Module responsible for defining types related to ExploreASL module executation OTHER THAN schemas (i.e. Import, DataPar)
 */

/**
 * Type defining the current modules of ExploreASL, as indicated by the lock directories associated with a particular step
 * One of:
 * - "Structural"
 * - "Structural_FLAIR"
 * - "ASL"
 * - "Population"
 * - "Misc" (i.e. 999_completed)
 */
export type EASLModuleType =
  | "Structural"
  | "Structural_FLAIR"
  | "DARTEL_T1"
  | "LongReg"
  | "ASL"
  | "Population"
  | "Misc"
  | "Import";

/**
 * Type defining a single step of the ExploreASL pipeline. Has properties:
 * - `module`: the module of ExploreASL that this step belongs to
 * - `description`: a description of the step
 * - `loadingBarValue`: the value of the loading bar for this step
 */
export type EASLWorkloadStep = {
  module: EASLModuleType;
  description: string;
  loadingBarValue: number;
};

/**
 * Type defining the set of steps for a whole ExploreASL workload for a given version.
 * Keys are statusFile basenames, values are {@link EASLWorkloadStep} objects:
 * - `module`: the module of ExploreASL that this step belongs to
 * - `description`: a description of the step
 * - `loadingBarValue`: the value of the loading bar for this step
 */
export type EASLWorkload = {
  [statusFileBasename: string]: EASLWorkloadStep;
};

/**
 * Type defining this GUI's current knowledge of ExploreASL workloads for given versions.
 * Keys are version strings, values are {@link EASLWorkload} objects.
 */
export type EASLVersionToWorkloadMappingType = {
  [version: string]: EASLWorkload;
};

/**
 * Type which defines the return of initially starting an ExploreASL Child Process via `api.invoke("ExploreASL:[COMMAND]", ...args)`
 * Has properties:
 * - `pids`: An array of PIDs of the child processes that were started
 * - `channelName`: The name of the IPC channel that the child processes are communicating on
 */
export interface RunEASLStartupReturnType {
  pids: number[];
  channelName: string;
}

/**
 * Type which defines the "on process close" return
 */
export interface RunEASLChildProcSummary extends Record<string, unknown> {
  exitSummaries: {
    pid: number;
    exitCode: number;
  }[];
  numIncompleteSteps: number;
  missedStepsMessages: string[];
}

/**
 * Type which represent the current child process status that was requested to run an ExploreASL module
 */
export type RunEASLStatusType = "Paused" | "Running" | "Standby";
