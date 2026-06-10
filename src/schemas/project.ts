import { z } from "zod";
import { DataParSchema } from "./dataParSchema";

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

export const ProjectFileSchema = z.object({
  version: z.literal("0.1.0"),
  projectMeta: ProjectMetaSchema,
  uiState: z
    .object({
      importActiveStep: z.number().int().min(0).optional(),
      importCompleted: z.boolean().optional(),
      importPhase: z.enum(IMPORT_EXECUTION_PHASES).optional(),
      navbarCollapsed: z.boolean().optional(),
      dataParametersAdvancedVisibility: z
        .object({
          showAdvancedSections: z.boolean().default(false),
          showAdvancedM0Params: z.boolean().default(false),
          showAdvancedQuantification: z.boolean().default(false),
          showAdvancedGeneralSettings: z.boolean().default(false),
          showAdvancedASLProcessing: z.boolean().default(false),
          showAdvancedAtlases: z.boolean().default(false),
        })
        .default({}),
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
    dataParametersAdvancedVisibility: {
      showAdvancedSections: false,
      showAdvancedM0Params: false,
      showAdvancedQuantification: false,
      showAdvancedGeneralSettings: false,
      showAdvancedASLProcessing: false,
      showAdvancedAtlases: false,
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
    return project.uiState?.importCompleted === true;
  }
  return false;
}
