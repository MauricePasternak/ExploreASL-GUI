import { z } from "zod";
import { DataParSchema } from "./dataParSchema";
import { ProcessConfigSchema, ProcessingPhaseSchema } from "./processingSchemas";
import {
  compressSnapshot,
  decompressSnapshot,
  stableJsonStringify,
} from "../lib/snapshotCompression";
import { ImportSnapshotSchema, MappingStateSchema, IMPORT_EXECUTION_PHASES } from "./importSchemas";

export const PROJECT_PHASES = [
  "import",
  "parameters",
  "processing",
  "visualization",
  "manifest",
] as const;

export const ProjectMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  createdAt: z.string(),
  lastOpened: z.string(),
  currentPhase: z.enum(PROJECT_PHASES),
  dataSource: z.enum(["dicom", "bids"]),
});

export const MANIFEST_FAIL_REASONS = [
  "motion",
  "coverage",
  "dropout",
  "artifact",
  "registration",
  "other",
] as const;

export const ManifestVerdictSchema = z
  .object({
    status: z.enum(["pass", "fail"]),
    reason: z.enum(MANIFEST_FAIL_REASONS).optional(),
    notes: z.string().max(500).optional(),
    setAt: z.number().int(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "fail" && !v.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reason is required when status is fail",
        path: ["reason"],
      });
    }
  });

export const ReviewerSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
});

const FlatManifestVerdictsSchema = z.record(z.string(), ManifestVerdictSchema);
const NestedManifestVerdictsSchema = z.record(z.string(), FlatManifestVerdictsSchema);

export const ManifestUiStateSchema = z
  .object({
    reviewers: z.array(ReviewerSchema).max(5).optional(),
    activeReviewerId: z.string().uuid().optional(),
    verdicts: z.union([FlatManifestVerdictsSchema, NestedManifestVerdictsSchema]).optional(),
    resolvedVerdicts: FlatManifestVerdictsSchema.optional(),
    lastRunVersions: z
      .object({
        exploreASL: z.string().optional(),
        matlab: z.string().optional(),
        gui: z.string().optional(),
      })
      .optional(),
    lastPopulationRunMtime: z.number().nullable().optional(),
  })
  .superRefine((state, ctx) => {
    if (!state.verdicts || Object.keys(state.verdicts).length === 0) return;

    const multiReviewerMode = (state.reviewers?.length ?? 0) >= 2;
    const nestedVerdicts = NestedManifestVerdictsSchema.safeParse(state.verdicts).success;

    if (multiReviewerMode !== nestedVerdicts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: multiReviewerMode
          ? "multi-reviewer mode requires reviewer-indexed verdicts"
          : "single-reviewer mode requires flat verdicts",
        path: ["verdicts"],
      });
      return;
    }

    if (!multiReviewerMode) return;

    const reviewerIds = new Set(state.reviewers?.map(({ id }) => id));
    for (const reviewerId of Object.keys(state.verdicts)) {
      if (!reviewerIds.has(reviewerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "multi-reviewer verdicts must be indexed by a registered reviewer ID",
          path: ["verdicts", reviewerId],
        });
      }
    }
  });

export type ManifestFailReason = (typeof MANIFEST_FAIL_REASONS)[number];
export type ManifestVerdict = z.infer<typeof ManifestVerdictSchema>;
export type Reviewer = z.infer<typeof ReviewerSchema>;
export type ManifestUiState = z.infer<typeof ManifestUiStateSchema>;

export const ImportUiStateSchema = z.object({
  activeStep: z.number().int().min(0).optional(),
  completed: z.boolean().optional(),
  bidsReviewConfirmed: z.boolean().default(false),
  skippedSubjects: z.array(z.string()).default([]),
  selectedProfileId: z.string().optional(),
  currentPhase: z.enum(IMPORT_EXECUTION_PHASES).optional(),
  mostRecentConfig: z
    .preprocess((val) => {
      if (val === null || val === undefined) return null;
      if (typeof val === "string") return val;
      return val;
    }, z.string().nullable())
    .transform((v) => (v === null ? null : decompressSnapshot(v)))
    .nullable()
    .optional(),
});

export const LastRunSchema = z.object({
  profileId: z.string(),
  exploreASLVersion: z.string().optional(),
  matlabVersion: z.string().optional(),
  guiVersion: z.string().optional(),
  Mtime: z.number().int().nullable().optional(),
});

export const DEFAULT_ADVANCED_VISIBILITY = {
  showAdvancedSections: false,
  showAdvancedM0Params: false,
  showAdvancedQuantification: false,
  showAdvancedGeneralSettings: false,
  showAdvancedASLProcessing: false,
  showAdvancedAtlases: false,
};

export const AdvancedVisibilitySchema = z.object({
  showAdvancedSections: z.boolean().default(false),
  showAdvancedM0Params: z.boolean().default(false),
  showAdvancedQuantification: z.boolean().default(false),
  showAdvancedGeneralSettings: z.boolean().default(false),
  showAdvancedASLProcessing: z.boolean().default(false),
  showAdvancedAtlases: z.boolean().default(false),
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
          structural: z
            .object({
              completed: z.boolean().optional(),
              lastRun: LastRunSchema.optional(),
            })
            .optional(),
          asl: z
            .object({
              completed: z.boolean().optional(),
              lastRun: LastRunSchema.optional(),
            })
            .optional(),
          population: z
            .object({
              completed: z.boolean().optional(),
              lastRun: LastRunSchema.optional(),
            })
            .optional(),
        })
        .optional(),
      datapar: z
        .object({
          advancedVisibility: AdvancedVisibilitySchema.default(
            DEFAULT_ADVANCED_VISIBILITY,
          ).optional(),
        })
        .optional(),
      manifest: ManifestUiStateSchema.optional(),
      dataVis: z
        .object({
          qcbfSource: z
            .object({
              relativePath: z.string(),
              fileHash: z.string(),
            })
            .nullable()
            .optional(),
          joinConfig: z
            .object({
              externalSource: z.object({
                absolutePath: z.string(),
                fileHash: z.string(),
                sheetName: z.string().nullable(),
              }),
              keys: z.array(
                z.object({
                  left: z.string(),
                  right: z.string(),
                }),
              ),
              dropRightOn: z.boolean(),
              naTokens: z.array(z.string()),
              delimiter: z.string(),
            })
            .nullable()
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
  mappingState: MappingStateSchema.default({}),
  dataPar: DataParSchema.default({}),
});

/** Schema v1 persisted envelope. Runtime root path and legacy app version are absent. */
export const ProjectV1PersistedSchema = z.object({
  schemaVersion: z.literal(1),
  projectMeta: ProjectMetaSchema.omit({ rootPath: true }),
  uiState: ProjectFileSchema.shape.uiState,
  mappingState: MappingStateSchema.default({}),
  dataPar: DataParSchema.default({}),
});

export type ImportUiState = z.infer<typeof ImportUiStateSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema> & { schemaVersion?: 1 };
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const DEFAULT_PROJECT_FILE = (id: string, name: string, rootPath: string): ProjectFile => ({
  schemaVersion: 1,
  version: "0.1.0",
  projectMeta: {
    id,
    name,
    rootPath,
    createdAt: new Date().toISOString(),
    lastOpened: new Date().toISOString(),
    currentPhase: "import",
    dataSource: "dicom",
  },
  uiState: {
    navbarCollapsed: true,
    import: {
      bidsReviewConfirmed: false,
      skippedSubjects: [],
      selectedProfileId: undefined,
    },
    datapar: {
      advancedVisibility: DEFAULT_ADVANCED_VISIBILITY,
    },
  },
  mappingState: {},
  dataPar: {},
});

export class ProjectMalformedError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ProjectMalformedError";
    if (cause !== undefined) this.cause = cause;
  }
}

export class ProjectUnsupportedVersionError extends Error {
  constructor(readonly schemaVersion: number) {
    super(`Project schema version ${schemaVersion} is not supported by this application.`);
    this.name = "ProjectUnsupportedVersionError";
  }
}

export type VersionedProjectFile = ProjectFile & { schemaVersion: 1 };

function persistedProjectMeta(projectMeta: ProjectMeta) {
  return {
    id: projectMeta.id,
    name: projectMeta.name,
    createdAt: projectMeta.createdAt,
    lastOpened: projectMeta.lastOpened,
    currentPhase: projectMeta.currentPhase,
    dataSource: projectMeta.dataSource,
  };
}

function persistedProjectDto(project: ProjectFile) {
  return {
    schemaVersion: 1 as const,
    projectMeta: persistedProjectMeta(project.projectMeta),
    uiState: project.uiState,
    mappingState: project.mappingState,
    dataPar: project.dataPar,
  };
}

function encodeRuntimeSnapshots(dto: ReturnType<typeof persistedProjectDto>) {
  return JSON.parse(
    JSON.stringify(dto, (key, value) => {
      if (key === "mostRecentConfig" && value && typeof value === "object") {
        const snapshot = ImportSnapshotSchema.safeParse(value);
        if (snapshot.success) return compressSnapshot(snapshot.data);
      }
      return value;
    }),
  ) as unknown;
}

function hydrateV1Project(project: z.infer<typeof ProjectV1PersistedSchema>): VersionedProjectFile {
  return {
    ...project,
    version: "0.1.0",
    projectMeta: { ...project.projectMeta, rootPath: "" },
  };
}

function normalizeSnapshot(input: unknown, allowObject: boolean): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const project = structuredClone(input) as Record<string, unknown>;
  const uiState = project.uiState;
  if (!uiState || typeof uiState !== "object" || Array.isArray(uiState)) return project;
  const importState = (uiState as Record<string, unknown>).import;
  if (!importState || typeof importState !== "object" || Array.isArray(importState)) return project;
  const snapshot = (importState as Record<string, unknown>).mostRecentConfig;
  if (snapshot && typeof snapshot === "object") {
    if (!allowObject)
      throw new ProjectMalformedError("Schema v1 snapshots must be compressed strings.");
    (importState as Record<string, unknown>).mostRecentConfig = compressSnapshot(
      ImportSnapshotSchema.parse(snapshot),
    );
  }
  return project;
}

/** Parses supported persisted formats into the runtime v1 representation. */
export function parseProject(raw: string): VersionedProjectFile {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    throw new ProjectMalformedError("Project file is not valid JSON.", error);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ProjectMalformedError("Project file envelope must be an object.");
  }
  const envelope = input as Record<string, unknown>;
  if (Number.isInteger(envelope.schemaVersion) && (envelope.schemaVersion as number) > 1) {
    throw new ProjectUnsupportedVersionError(envelope.schemaVersion as number);
  }
  const isV1 = envelope.schemaVersion === 1;
  const isLegacy = envelope.schemaVersion === undefined && envelope.version === "0.1.0";
  if (!isV1 && !isLegacy) {
    throw new ProjectMalformedError("Project file has no supported schema envelope.");
  }
  try {
    const normalized = normalizeSnapshot(input, isLegacy);
    if (isLegacy) {
      const legacy = ProjectFileSchema.parse(normalized);
      const migrated = ProjectV1PersistedSchema.parse(
        encodeRuntimeSnapshots(persistedProjectDto(legacy)),
      );
      return hydrateV1Project(migrated);
    }
    return hydrateV1Project(ProjectV1PersistedSchema.parse(normalized));
  } catch (error) {
    if (error instanceof ProjectMalformedError) throw error;
    throw new ProjectMalformedError("Project file has invalid supported data.", error);
  }
}

/** Canonical persisted v1 DTO. Runtime root and legacy version never cross this boundary. */
export function serializeProject(project: VersionedProjectFile): string {
  const serialized = stableJsonStringify(encodeRuntimeSnapshots(persistedProjectDto(project)), 2);
  parseProject(serialized);
  return serialized;
}

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
    if (project.projectMeta.dataSource === "bids") {
      return project.uiState?.import?.bidsReviewConfirmed === true;
    }
    return project.uiState?.import?.completed === true;
  }
  if (targetPhase === "visualization") {
    return project.uiState?.processing?.population?.completed === true;
  }
  if (targetPhase === "manifest") {
    return project.uiState?.processing?.population?.completed === true;
  }
  return false;
}
