import type { SubjectInfo, SubjectModuleStatus } from "../../schemas/processingSchemas";
import { PROCESSING_MODULES } from "../../schemas/processingSchemas";
import {
  collectAslRuns,
  getEntriesFor,
  getEntryFor,
  type SubjectStatusIndex,
} from "./subjectStatusIndex";

export type ModuleName = (typeof PROCESSING_MODULES)[number];

export interface StepStatus {
  name: string;
  status: "pending" | "running" | "complete";
}

// Status-file names are ExploreASL identifiers; show their meaning, not the filename.
const MODULE_STEP_LABELS = {
  structural: {
    "010_LinearReg_T1w2MNI": "Align anatomy scan to a standard brain template",
    "020_LinearReg_FLAIR2T1w": "Align FLAIR scan with anatomy scan",
    "030_FLAIR_BiasfieldCorrection": "Correct uneven brightness in FLAIR scan",
    "040_LST_Segment_FLAIR_WMH": "Identify white matter lesions in FLAIR scan",
    "050_LST_T1w_LesionFilling_WMH": "Fill in white matter lesions on anatomy image",
    "060_Segment_T1w": "Separate brain tissues in anatomy scan",
    "070_CleanUpWMH_SEGM": "Refine white matter lesion outlines",
    "080_Resample2StandardSpace": "Place anatomy scan in standard brain space",
    "090_GetVolumetrics": "Measure brain tissue volumes",
    "100_VisualQC_Structural": "Create anatomy quality-control images",
  },
  asl: {
    "020_RealignASL": "Correct movement between ASL images",
    "030_RegisterASL": "Align ASL images with anatomy scan",
    "040_ResampleASL": "Resample ASL images",
    "050_PreparePV": "Prepare tissue maps to correct mixed-tissue signals",
    "060_ProcessM0": "Process M0 reference scan",
    "070_CreateAnalysisMask": "Create brain mask for ASL analysis",
    "080_Quantification": "Calculate blood flow from ASL images",
    "090_VisualQC_ASL": "Create ASL quality-control images",
  },
  population: {
    "010_CreatePopulationTemplates": "Create group brain templates",
    "020_CreateAnalysisMask": "Create brain mask for group analysis",
    "030_CreateBiasfield": "Create group intensity correction map",
    "040_GetDICOMStatistics": "Summarize scan acquisition settings",
    "050_GetVolumeStatistics": "Calculate group volume statistics",
    "060_GetMotionStatistics": "Summarize subject movement",
    "065_GetRegistrationStatistics": "Summarize image alignment",
    "070_GetROIstatistics": "Calculate statistics for brain regions",
    "080_SortBySpatialCoV": "Sort results by spatial variation",
    "090_DeleteTempFiles": "Remove temporary files",
    "100_GZipAllFiles": "Compress output files",
  },
} satisfies Record<ModuleName, Record<string, string>>;

const STEP_LABELS: Record<string, string> = {
  ...MODULE_STEP_LABELS.structural,
  ...MODULE_STEP_LABELS.asl,
  ...MODULE_STEP_LABELS.population,
  "070_SkullStrip_T1w": "Remove non-brain tissue from anatomy scan",
  "999_ready": "Module complete",
  "Processing...": "Processing this module",
};

export function processingStepLabel(code: string): string {
  return (
    STEP_LABELS[code] ??
    code
      .replace(/^\d+_/, "")
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
  );
}

// Optional steps before the latest recorded status may have been skipped.
export function remainingStepNames(module: ModuleName, completed: string[]): string[] {
  const lastRecorded = Math.max(0, ...completed.map((name) => Number.parseInt(name, 10) || 0));
  return Object.keys(MODULE_STEP_LABELS[module]).filter(
    (name) => Number.parseInt(name, 10) > lastRecorded,
  );
}

export function getStepsForSubject(
  index: SubjectStatusIndex,
  subjectSession: string,
  module: ModuleName,
  run?: string,
): StepStatus[] {
  const entry = getEntryFor(index, subjectSession, module, run);
  if (!entry) return [];
  const steps: StepStatus[] = entry.completedSteps.map((name) => ({
    name,
    status: "complete" as const,
  }));
  if (entry.locked && entry.status !== "complete") {
    steps.push({ name: "Processing...", status: "running" });
  }
  return steps;
}

export function getStatusForSubject(
  index: SubjectStatusIndex,
  subjectSession: string,
  module: ModuleName,
  run?: string,
): SubjectModuleStatus | undefined {
  return getEntryFor(index, subjectSession, module, run);
}

export function getRunsForSubjectInfo(subject: SubjectInfo, index: SubjectStatusIndex): string[] {
  const aslEntries = getEntriesFor(index, subject.subjectSession, "asl");
  return collectAslRuns(subject.aslRuns, aslEntries);
}

export function getSubjectOverallStatus(
  index: SubjectStatusIndex,
  subjectSession: string,
  module: ModuleName,
): {
  status: SubjectModuleStatus["status"];
  locked: boolean;
  completedRunsCount: number;
} {
  const subjectStatuses = getEntriesFor(index, subjectSession, module);
  if (subjectStatuses.length === 0) {
    return { status: "pending", locked: false, completedRunsCount: 0 };
  }

  const locked = subjectStatuses.some((s) => s.locked);
  const completedRunsCount = subjectStatuses.filter((s) => s.status === "complete").length;

  let status: SubjectModuleStatus["status"] = "pending";
  if (subjectStatuses.every((s) => s.status === "complete")) {
    status = "complete";
  } else if (
    subjectStatuses.some(
      (s) => s.status === "complete" || s.status === "incomplete" || s.status === "outdated",
    )
  ) {
    status = "incomplete";
  }

  return { status, locked, completedRunsCount };
}

export function calcModuleProgress(
  subjects: SubjectInfo[],
  module: ModuleName,
  index: SubjectStatusIndex,
): { complete: number; total: number } {
  if (module === "population") {
    return {
      complete: getEntriesFor(index, "", module).some((s) => s.status === "complete") ? 1 : 0,
      total: 1,
    };
  }
  const eligible = subjects.filter((s) => {
    if (module === "structural") return s.hasStructural;
    if (module === "asl") return s.hasASL;
    return true;
  });

  const complete = eligible.filter((s) => {
    const { status } = getSubjectOverallStatus(index, s.subjectSession, module);
    return status === "complete";
  }).length;

  return { complete, total: eligible.length };
}
