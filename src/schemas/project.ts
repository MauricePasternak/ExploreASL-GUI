import { z } from "zod";
import { DataParSchema } from "./dataParSchema";
import { ImportSnapshotSchema } from "./importSchemas";
import { ProcessConfigSchema, ProcessingPhaseSchema } from "./processingSchemas";

export const PROJECT_PHASES = ["import", "parameters", "processing"] as const;
export const IMPORT_EXECUTION_PHASES = [
  "idle",
  "preparing",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const ProjectMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  createdAt: z.string(),
  lastOpened: z.string(),
  currentPhase: z.enum(PROJECT_PHASES),
});

export const ImportUiStateSchema = z.object({
	activeStep: z.number().int().min(0).optional(),
	completed: z.boolean().optional(),
	currentPhase: z.enum(IMPORT_EXECUTION_PHASES).optional(),
	mostRecentConfig: ImportSnapshotSchema.nullable().optional(),
});

export const ProjectFileSchema = z.object({
  version: z.literal("0.1.0"),
  projectMeta: ProjectMetaSchema,
  uiState: z
    .object({
      import: ImportUiStateSchema.optional(),
      navbarCollapsed: z.boolean().optional(),
      processing: z
        .object({
          config: ProcessConfigSchema.optional(),
          currentPhase: ProcessingPhaseSchema.optional(),
        })
        .optional(),
      datapar: z
        .object({
          advancedVisibility: z
            .object({
              showAdvancedSections: z.boolean().default(false),
              showAdvancedM0Params: z.boolean().default(false),
              showAdvancedQuantification: z.boolean().default(false),
              showAdvancedGeneralSettings: z.boolean().default(false),
              showAdvancedASLProcessing: z.boolean().default(false),
              showAdvancedAtlases: z.boolean().default(false),
            })
            .default({
              showAdvancedSections: false,
              showAdvancedM0Params: false,
              showAdvancedQuantification: false,
              showAdvancedGeneralSettings: false,
              showAdvancedASLProcessing: false,
              showAdvancedAtlases: false,
            })
            .optional(),
        })
        .optional(),
    })
    .passthrough()
    .default({}),
  mappingState: z.object({}).passthrough().default({}),
  exploreAslConfig: z
    .object({
      sourcestructure: z.object({}).passthrough().default({}),
      studyPar: z.object({}).passthrough().default({}),
      dataPar: DataParSchema.default({}),
    })
    .default({
      sourcestructure: {},
      studyPar: {},
      dataPar: {},
    }),
});

export type ImportUiState = z.infer<typeof ImportUiStateSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const DEFAULT_PROJECT_FILE = (
  id: string,
  name: string,
  rootPath: string,
): ProjectFile => ({
  version: "0.1.0",
  projectMeta: {
    id,
    name,
    rootPath,
    createdAt: new Date().toISOString(),
    lastOpened: new Date().toISOString(),
    currentPhase: "import",
  },
  uiState: {
    navbarCollapsed: true,
    datapar: {
      advancedVisibility: {
        showAdvancedSections: false,
        showAdvancedM0Params: false,
        showAdvancedQuantification: false,
        showAdvancedGeneralSettings: false,
        showAdvancedASLProcessing: false,
        showAdvancedAtlases: false,
      },
    },
  },
  mappingState: {},
  exploreAslConfig: {
    sourcestructure: {},
    studyPar: {},
    dataPar: {},
  },
});

export const PROJECT_FILE_NAME = "project.easl";

export function canAccessPhase(project: ProjectFile, targetPhase: ProjectPhase) {
  const currentPhase = project.projectMeta.currentPhase;
  if (PROJECT_PHASES.indexOf(targetPhase) <= PROJECT_PHASES.indexOf(currentPhase)) {
    return true;
  }
  if (targetPhase === "parameters") {
    return true;
  }
  if (targetPhase === "processing") {
    return project.uiState?.import?.completed === true;
  }
  return false;
}
