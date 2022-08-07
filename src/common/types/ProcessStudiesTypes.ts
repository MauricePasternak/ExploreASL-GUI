import { RunEASLStatusType } from "./ExploreASLTypes";

/**
 * Type representing the values associated with the tabs in the Process Studies section of the GUI.
 */
export type ProcessStudiesTabOption = "RunExploreASL" | "PrepareARerun";

/**
 * Type which represents the non-Import ExploreASL modules that can be run
 */
export type RunEASLModuleNamesType = "Structural" | "ASL" | "Both" | "Population";

/**
 * Type which represents the main arguments that will eventually be passed to the main ExploreASL command.
 * - `studyRootPath`: The root path of the study on which ExploreASL is being run.
 * - `numberOfCores`: The number of cores to use for the ExploreASL run.
 * - `currentStatus`: The current status of the child process that is being run.
 * - `whichModulesToRun`: The ExploreASL modules that should be run.
 */
export type RunEASLStudySetupType = {
  studyRootPath: string;
  numberOfCores: number;
  currentStatus: RunEASLStatusType;
  whichModulesToRun: RunEASLModuleNamesType;
}
