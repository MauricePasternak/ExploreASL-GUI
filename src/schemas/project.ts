import { z } from "zod";
import { DataParSchema } from "./dataParSchema";
import { ImportSnapshotSchema } from "./importSchemas";
import { ProcessConfigSchema, ProcessingPhaseSchema } from "./processingSchemas";

export const PROJECT_PHASES = ["import", "parameters", "processing", "visualization"] as const;
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
      population: z.object({ completed: z.boolean().optional() }).optional(),
      dataVis: z
        .object({
          contractSources: z
            .array(
              z.object({
                relativePath: z.string(),
                fileHash: z.string(),
              }),
            )
            .optional(),
          columnTypes: z.record(z.string(), z.string()).optional(),
          identifiers: z
            .object({
              subject: z.string(),
              session: z.string(),
              run: z.string(),
            })
            .nullable()
            .optional(),
          levelOrderings: z.record(z.string(), z.array(z.string())).optional(),
          axisAssignment: z
            .object({
              x: z.string().nullable().optional(),
              y: z.string().nullable().optional(),
              colorBy: z.string().nullable().optional(),
            })
            .optional(),
          domainFilters: z
            .object({
              xMin: z.number().nullable().optional(),
              xMax: z.number().nullable().optional(),
              yMin: z.number().nullable().optional(),
              yMax: z.number().nullable().optional(),
            })
            .optional(),
          stage: z.string().optional(),
          splitRatio: z.number().optional(),
          filtersExpanded: z.boolean().optional(),
          pointSize: z.number().optional(),
          swarmSpacing: z.number().optional(),
          chartOpacity: z.number().optional(),
          showGridX: z.boolean().optional(),
          showGridY: z.boolean().optional(),
          nvRadiological: z.boolean().optional(),
          nvColorbar: z.boolean().optional(),
          nvCrosshair: z.boolean().optional(),
          nvCornerOrientation: z.boolean().optional(),
          nvColormap: z.string().optional(),
          nvSliceType: z.string().optional(),
          nvBackColor: z.string().optional(),
          xTickSize: z.number().optional(),
          xTickPadding: z.number().optional(),
          xTickRotation: z.number().optional(),
          xLegendOverride: z.string().nullable().optional(),
          xLegendOffset: z.number().optional(),
          yTickSize: z.number().optional(),
          yTickPadding: z.number().optional(),
          yTickRotation: z.number().optional(),
          yLegendOverride: z.string().nullable().optional(),
          yLegendOffset: z.number().optional(),
        })
        .passthrough()
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

export const DEFAULT_PROJECT_FILE = (id: string, name: string, rootPath: string): ProjectFile => ({
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
  if (targetPhase === "visualization") {
    return project.uiState?.population?.completed === true;
  }
  return false;
}
