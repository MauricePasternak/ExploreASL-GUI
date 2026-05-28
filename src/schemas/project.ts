import { z } from "zod";

export const PROJECT_PHASES = ["import", "parameters", "processing"] as const;

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
  uiState: z.object({}).passthrough().default({}),
  mappingState: z.object({}).passthrough().default({}),
  exploreAslConfig: z
    .object({
      sourcestructure: z.object({}).passthrough().default({}),
      studyPar: z.object({}).passthrough().default({}),
      dataPar: z.object({}).passthrough().default({}),
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
  uiState: {},
  mappingState: {},
  exploreAslConfig: {
    sourcestructure: {},
    studyPar: {},
    dataPar: {},
  },
});

export const PROJECT_FILE_NAME = "project.easl";

export function canAccessPhase(currentPhase: ProjectPhase, targetPhase: ProjectPhase) {
  return PROJECT_PHASES.indexOf(targetPhase) <= PROJECT_PHASES.indexOf(currentPhase);
}
