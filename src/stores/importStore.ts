import { z } from "zod";
import { create } from "zustand";

import { invoke } from "@tauri-apps/api/core";

import { formatBidsScanValidationError } from "../lib/bids/errorFormatter";
import { logAction } from "../lib/debug";
import { inspectSourcePath } from "../lib/projectPaths";
import { type ImportSubjectStatus } from "../lib/importStatus";
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
  type ProjectLease,
} from "../lib/projectLifecycle";
import { portableKey, type StagingValidationIssue } from "../lib/stagingValidation";
import { useGlobalStore } from "./globalStore";
import { useProjectStore } from "./projectStore";
import type { ProjectFile } from "../schemas/project";
import type { MappingState } from "../generated/project/MappingState";

import type {
  DerivedMetadataGroup,
  ImportLifecycle,
  ImportProgress,
  ImportRunSnapshot,
  MetadataGroup,
  ModalityAlias,
  PathPattern,
  SessionAlias,
  SubjectRename,
  SubjectRow,
  TokenAssignment,
  TokenTag,
} from "../schemas/importSchemas";
import { DerivedMetadataGroupSchema } from "../schemas/importSchemas";

/** Display defaults only. Accepted settings live in the project cache. */
export const EMPTY_IMPORT_SETTINGS: Required<MappingState> = {
  sourceDataPath: "",
  rawPaths: [],
  pathPatterns: [],
  bMatchDirectories: true,
  ingestionComplete: false,
  tokenizerConfigs: {},
  modalityAliases: [],
  sessionAliases: [],
  runAliases: [],
  subjectRenames: [],
  metadataGroups: [],
  subjectRows: [],
};
export function importSettings(project: ProjectFile | null) {
  return { ...EMPTY_IMPORT_SETTINGS, ...project?.mappingState };
}
export const acceptedImportSettings = () => importSettings(useProjectStore.getState().project);

function editMapping(
  update: Partial<MappingState> | ((mapping: Required<MappingState>) => Partial<MappingState>),
) {
  void useProjectStore
    .getState()
    .submitEdit((project) => ({
      kind: "import",
      mapping: {
        ...project.mappingState,
        ...(typeof update === "function" ? update(importSettings(project)) : update),
      },
      preferences: {
        activeStep: project.uiState.import?.activeStep,
        selectedProfileId: project.uiState.import?.selectedProfileId,
      },
    }))
    .catch(() => undefined);
}

// =============================================================================
// State Interface
// =============================================================================

export type ImportPhase = ImportLifecycle;

export type StagingPreflightStatus = "idle" | "pending" | "valid" | "invalid" | "failed";

/** Runtime-only native staging validation. Never serialized into project.easl. */
export interface StagingPreflightState {
  status: StagingPreflightStatus;
  fingerprint: string | null;
  requestId: number;
  lease: ProjectLease | null;
  issues: StagingValidationIssue[];
  error: string | null;
}

/** Session-only BIDS review scan state. Not persisted to .easl. */
export interface BidsReviewState {
  scanComplete: boolean;
  scanError: string | null;
  detectedGroups: DerivedMetadataGroup[];
  /**
   * Subjects skipped by the BIDS scanner (e.g. missing ASL sidecars).
   * Format convention: `"sub-XX_<session>"` per design D2/D11/D20.
   */
  skippedSubjects: string[];
}

export type DicomSourceAvailability =
  | { status: "unconfigured" | "available"; savedPath: string | null; message: null }
  | { status: "missing" | "unreadable" | "ambiguous"; savedPath: string; message: string };

export interface ImportState {
  // Step 5: Import execution
  importPhase: ImportPhase;
  importCompleted: boolean;
  importLog: string[];
  importProgress: Record<string, ImportProgress>;
  importRunning: boolean;
  importSummary: {
    succeeded: number;
    failed: number;
    errors: string[];
  } | null;
  /** Session-only native attachment. Never persisted to project.easl. */
  activeRunId: string | null;
  ownershipGeneration: number | null;
  /** Session-only ordering guard for delayed command responses/events. */
  nativeSnapshotUpdatedAtMs: number | null;
  confirmationRequired: boolean;
  terminalRunId: string | null;
  /** Session-only ownership guard for an in-flight native stop confirmation. */
  confirmingStoppedRunId: string | null;
  confirmingStoppedGeneration: number | null;
  importRunError: string | null;

  // BIDS review (session-only, not persisted)
  bidsReview: BidsReviewState;
  sourceAvailability: DicomSourceAvailability;
  stagingPreflight: StagingPreflightState;

  /** Inline pre-run error (e.g. missing/invalid profile). Not persisted. */
  profileError: string | null;
  setSelectedProfileId: (id: string | null) => void;
  autoSelectProfile: () => void;
  clearProfileError: () => void;

  // Actions
  setActiveStep: (step: number) => void;
  setSourceDataPath: (path: string, lease?: ProjectLease | null) => Promise<void>;
  relinkCompatibleSource: (path: string, lease?: ProjectLease | null) => Promise<void>;
  relinkIncompatibleSource: (
    path: string,
    paths: string[],
    patterns: PathPattern[],
    lease?: ProjectLease | null,
  ) => Promise<void>;
  setSourceAvailability: (availability: DicomSourceAvailability) => void;
  inspectSourceAvailability: () => Promise<void>;
  beginStagingPreflight: (fingerprint: string, lease: ProjectLease | null) => number;
  resolveStagingPreflight: (
    requestId: number,
    fingerprint: string,
    lease: ProjectLease | null,
    result: { valid: boolean; issues: StagingValidationIssue[] },
  ) => void;
  failStagingPreflight: (
    requestId: number,
    fingerprint: string,
    lease: ProjectLease | null,
    error: string,
  ) => void;
  resetStagingPreflight: () => void;
  setIngestionResults: (
    paths: string[],
    patterns: PathPattern[],
    lease?: ProjectLease | null,
  ) => void;
  setBMatchDirectories: (value: boolean) => void;
  setTokenAssignment: (
    patternSignature: string,
    blockIndex: number,
    subBlockIndex: number | null,
    tag: TokenTag,
  ) => void;
  removeTokenAssignment: (
    patternSignature: string,
    blockIndex: number,
    subBlockIndex: number | null,
  ) => void;
  setTokenizerConfig: (patternSignature: string, assignments: TokenAssignment[]) => void;
  setModalityAliases: (aliases: ModalityAlias[]) => void;
  updateModalityAlias: (captured: string, mapped: ModalityAlias["mapped"]) => void;
  setSessionAliases: (aliases: SessionAlias[]) => void;
  setRunAliases: (aliases: SessionAlias[]) => void;
  setSubjectRenames: (renames: SubjectRename[]) => void;
  updateSubjectRename: (original: string, target: string) => void;
  addMetadataGroup: (group: MetadataGroup) => void;
  removeMetadataGroup: (id: string) => void;
  updateMetadataGroup: (id: string, updates: Partial<MetadataGroup>) => void;
  setSubjectRows: (rows: SubjectRow[]) => void;
  updateSubjectRowGroup: (rowIds: string[], groupId: string) => void;
  startImport: (subjects?: string[]) => void;
  addLogLines: (lines: string[]) => void;
  markSubjectRunning: (subject: string, step?: "DCM2NII" | "NII2BIDS") => void;
  bindImportRunSnapshot: (snapshot: ImportRunSnapshot) => void;
  reconcileImportRunSnapshot: (snapshot: ImportRunSnapshot, lease?: ProjectLease | null) => void;
  markSubjectDiagnosticFailure: (subject: string, message: string) => void;
  applyStaleness: (staleness: Record<string, boolean>) => void;
  reconstructProgressFromLockFiles: (
    statuses: ImportSubjectStatus[],
    subjects: string[],
    staleness: Record<string, boolean>,
  ) => void;
  resetImport: () => void;
  // BIDS review actions
  startBidsScan: (rootPath: string) => Promise<void>;
  setDetectedGroups: (groups: DerivedMetadataGroup[]) => void;
  retryBidsScan: (rootPath: string) => Promise<void>;
  rescanConfirmedBidsProject: (rootPath: string) => Promise<void>;
  backToLanding: () => void;
  resetBidsReview: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const INITIAL_STATE = {
  importPhase: "idle" as ImportPhase,
  importCompleted: false,
  importLog: [] as string[],
  importProgress: {} as Record<string, ImportProgress>,
  importRunning: false,
  importSummary: null as ImportState["importSummary"],
  activeRunId: null as string | null,
  ownershipGeneration: null as number | null,
  nativeSnapshotUpdatedAtMs: null as number | null,
  confirmationRequired: false,
  terminalRunId: null as string | null,
  confirmingStoppedRunId: null as string | null,
  confirmingStoppedGeneration: null as number | null,
  importRunError: null as string | null,
  bidsReview: {
    scanComplete: false,
    scanError: null,
    detectedGroups: [] as DerivedMetadataGroup[],
    skippedSubjects: [] as string[],
  },
  profileError: null as string | null,
  sourceAvailability: {
    status: "unconfigured",
    savedPath: null,
    message: null,
  } as DicomSourceAvailability,
  stagingPreflight: {
    status: "idle" as StagingPreflightStatus,
    fingerprint: null,
    requestId: 0,
    lease: null,
    issues: [] as StagingValidationIssue[],
    error: null,
  },
};

const NATIVE_PHASE_ORDER: Record<ImportPhase, number> = {
  idle: 0,
  preparing: 1,
  running: 2,
  finalizing: 3,
  cancelling: 3,
  completed: 4,
  failed: 4,
  cancelled: 4,
  interrupted: 4,
};

function snapshotRegressesLifecycle(current: ImportPhase, incoming: ImportPhase): boolean {
  // Cancelling -> Running is the one intentional rollback: native cancellation
  // failure restores actionable process ownership. Every other lower phase is
  // an obsolete response/event, including equal-millisecond readiness races.
  if (current === "cancelling" && incoming === "running") return false;
  return NATIVE_PHASE_ORDER[incoming] < NATIVE_PHASE_ORDER[current];
}

function createInitialImportState() {
  return {
    ...INITIAL_STATE,
    importLog: [],
    failedSubjects: [],
    importProgress: {},
    bidsReview: {
      scanComplete: false,
      scanError: null,
      detectedGroups: [],
      skippedSubjects: [],
    },
  };
}

function subjectProgress(subject: string, existing?: ImportProgress): ImportProgress {
  return (
    existing ?? {
      subject,
      session: "",
      status: "pending",
    }
  );
}

async function scanBidsSidecars(rootPath: string) {
  let groupsWithId: Array<
    Record<string, unknown> & { fingerprintHash?: string; id?: string; label?: string }
  > = [];

  try {
    const result = (await invoke("scan_bids_sidecars", { rootPath })) as {
      groups: Array<Record<string, unknown> & { fingerprintHash?: string; id?: string }>;
      skipped: string[];
    };

    // Map fingerprintHash to id to match schema expectations.
    groupsWithId = (result.groups ?? []).map((g) => ({
      ...g,
      id: g.id ?? g.fingerprintHash,
    }));

    const detectedGroups = DerivedMetadataGroupSchema.array().parse(groupsWithId);
    const skippedSubjects = z.array(z.string()).parse(result.skipped ?? []);

    return {
      detectedGroups,
      skippedSubjects,
    };
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (err instanceof z.ZodError) {
      message = formatBidsScanValidationError(err, groupsWithId);
    }
    // @ts-expect-error - Error cause option is not defined in ES2020 target library
    throw new Error(message, { cause: err });
  }
}

// =============================================================================
// Store
// =============================================================================

export const useImportStore = create<ImportState>((set, get) => ({
  ...INITIAL_STATE,

  setActiveStep: (step) => {
    void useProjectStore
      .getState()
      .submitEdit((project) => ({
        kind: "import",
        mapping: project.mappingState,
        preferences: {
          activeStep: step,
          selectedProfileId: project.uiState.import?.selectedProfileId,
        },
      }))
      .catch(() => undefined);
  },

  setSourceDataPath: async (path, lease = captureProjectLease()) => {
    if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
    await useProjectStore.getState().submitEdit((project) => ({
      kind: "import",
      mapping: { ...project.mappingState, sourceDataPath: path },
      preferences: {
        activeStep: project.uiState.import?.activeStep,
        selectedProfileId: project.uiState.import?.selectedProfileId,
      },
    }));
    if (!isCurrentProjectLease(lease)) return;
    const accepted = acceptedImportSettings().sourceDataPath;
    set({ sourceAvailability: { status: "available", savedPath: accepted, message: null } });
  },

  relinkCompatibleSource: async (path, lease = captureProjectLease()) => {
    if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
    await useProjectStore
      .getState()
      .submitEdit({ kind: "relinkDicom", path, rawPaths: [], patterns: [], compatible: true });
    if (isCurrentProjectLease(lease))
      set({
        sourceAvailability: {
          status: "available",
          savedPath: acceptedImportSettings().sourceDataPath,
          message: null,
        },
      });
  },

  relinkIncompatibleSource: async (path, paths, patterns, lease = captureProjectLease()) => {
    if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
    await useProjectStore
      .getState()
      .submitEdit({ kind: "relinkDicom", path, rawPaths: paths, patterns, compatible: false });
    if (!isCurrentProjectLease(lease)) return;
    set({
      importProgress: {},
      importPhase: "idle",
      importCompleted: false,
      importLog: [],
      importRunning: false,
      importSummary: null,
      sourceAvailability: {
        status: "available",
        savedPath: acceptedImportSettings().sourceDataPath,
        message: null,
      },
    });
  },

  setSourceAvailability: (sourceAvailability) => set({ sourceAvailability }),
  inspectSourceAvailability: async () => {
    const project = useProjectStore.getState().project;
    const path = project?.mappingState.sourceDataPath;
    const lease = captureProjectLease();
    if (!project || project.projectMeta.dataSource !== "dicom" || !path) return;
    set({
      sourceAvailability: {
        status: "unreadable",
        savedPath: path,
        message: "Checking saved DICOM source.",
      },
    });
    try {
      const inspected = await inspectSourcePath(project.projectMeta.rootPath, path);
      if (!isCurrentProjectLease(lease)) return;
      set({
        sourceAvailability:
          inspected.exists && inspected.readable && inspected.isDirectory
            ? { status: "available", savedPath: path, message: null }
            : {
                status: inspected.exists ? "unreadable" : "missing",
                savedPath: path,
                message:
                  "Saved DICOM source is unavailable. Relink it before scanning or importing.",
              },
      });
    } catch (error) {
      if (isCurrentProjectLease(lease))
        set({
          sourceAvailability: {
            status: "unreadable",
            savedPath: path,
            message: `Cannot inspect saved DICOM source. Relink it before scanning or importing. ${error instanceof Error ? error.message : String(error)}`,
          },
        });
    }
  },

  beginStagingPreflight: (fingerprint, lease) => {
    const requestId = get().stagingPreflight.requestId + 1;
    set({
      stagingPreflight: {
        status: "pending",
        fingerprint,
        requestId,
        lease,
        issues: [],
        error: null,
      },
    });
    return requestId;
  },

  resolveStagingPreflight: (requestId, fingerprint, lease, result) => {
    const current = get().stagingPreflight;
    if (
      current.requestId !== requestId ||
      current.fingerprint !== fingerprint ||
      current.lease !== lease ||
      !isCurrentProjectLease(lease) ||
      !isProjectWorkAccepted()
    ) {
      return;
    }
    set({
      stagingPreflight: {
        ...current,
        status: result.valid ? "valid" : "invalid",
        issues: result.issues,
        error: null,
      },
    });
  },

  failStagingPreflight: (requestId, fingerprint, lease, error) => {
    const current = get().stagingPreflight;
    if (
      current.requestId !== requestId ||
      current.fingerprint !== fingerprint ||
      current.lease !== lease ||
      !isCurrentProjectLease(lease) ||
      !isProjectWorkAccepted()
    ) {
      return;
    }
    set({ stagingPreflight: { ...current, status: "failed", error } });
  },

  resetStagingPreflight: () => {
    const current = get().stagingPreflight;
    set({
      stagingPreflight: {
        status: "idle",
        fingerprint: null,
        requestId: current.requestId + 1,
        lease: null,
        issues: [],
        error: null,
      },
    });
  },

  setIngestionResults: (paths, patterns, lease = captureProjectLease()) => {
    if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
    editMapping({
      rawPaths: paths,
      pathPatterns: patterns,
      ingestionComplete: paths.length > 0,
    });
  },

  setBMatchDirectories: (value) => {
    editMapping({ bMatchDirectories: value });
  },

  setTokenAssignment: (patternSignature, blockIndex, subBlockIndex, tag) => {
    editMapping((state) => {
      const existing = state.tokenizerConfigs[patternSignature] ?? [];

      // Remove any existing assignment at this exact position
      const filtered = existing.filter(
        (a) => !(a.blockIndex === blockIndex && a.subBlockIndex === subBlockIndex),
      );

      // Add the new assignment
      const updated = [...filtered, { blockIndex, subBlockIndex, tag }];

      return {
        tokenizerConfigs: {
          ...state.tokenizerConfigs,
          [patternSignature]: updated,
        },
      };
    });
  },

  removeTokenAssignment: (patternSignature, blockIndex, subBlockIndex) => {
    editMapping((state) => {
      const existing = state.tokenizerConfigs[patternSignature] ?? [];
      const filtered = existing.filter(
        (a) => !(a.blockIndex === blockIndex && a.subBlockIndex === subBlockIndex),
      );

      return {
        tokenizerConfigs: {
          ...state.tokenizerConfigs,
          [patternSignature]: filtered,
        },
      };
    });
  },

  setTokenizerConfig: (patternSignature, assignments) => {
    editMapping((state) => ({
      tokenizerConfigs: {
        ...state.tokenizerConfigs,
        [patternSignature]: assignments,
      },
    }));
  },

  setModalityAliases: (aliases) => {
    editMapping({ modalityAliases: aliases });
  },

  updateModalityAlias: (captured, mapped) => {
    editMapping((state) => ({
      modalityAliases: state.modalityAliases.map((a) =>
        a.captured === captured ? { ...a, mapped } : a,
      ),
    }));
  },

  setSessionAliases: (aliases) => {
    editMapping({ sessionAliases: aliases });
  },

  setRunAliases: (aliases) => {
    editMapping({ runAliases: aliases });
  },

  setSubjectRenames: (renames) => {
    editMapping({ subjectRenames: renames });
  },

  updateSubjectRename: (original, target) => {
    editMapping((state) => ({
      subjectRenames: state.subjectRenames.map((r) =>
        r.original === original ? { ...r, target } : r,
      ),
    }));
  },

  addMetadataGroup: (group) => {
    editMapping((state) => {
      if (state.metadataGroups.some((g) => g.id === group.id)) {
        return {};
      }
      return {
        metadataGroups: [...state.metadataGroups, group],
      };
    });
  },

  removeMetadataGroup: (id) => {
    editMapping((state) => ({
      metadataGroups: state.metadataGroups.filter((g) => g.id !== id),
      subjectRows: state.subjectRows.map((row) =>
        row.groupId === id ? { ...row, groupId: "global-defaults" } : row,
      ),
    }));
  },

  updateMetadataGroup: (id, updates) => {
    editMapping((state) => ({
      metadataGroups: state.metadataGroups.map((g) => (g.id === id ? { ...g, ...updates } : g)),
    }));
  },

  setSubjectRows: (rows) => {
    editMapping({ subjectRows: rows });
  },

  updateSubjectRowGroup: (rowIds, groupId) => {
    editMapping((state) => ({
      subjectRows: state.subjectRows.map((row) =>
        rowIds.includes(row.id) ? { ...row, groupId } : row,
      ),
    }));
  },

  startImport: (subjects) => {
    // Pre-validate the execution profile before preparing. On failure we show
    // an inline error and block — we do NOT transition to the `failed` phase
    // (nothing has started yet).
    const global = useGlobalStore.getState();
    const selectedId = useProjectStore.getState().project?.uiState.import?.selectedProfileId;
    const profile = selectedId ? global.getProfileById(selectedId) : undefined;
    if (!profile) {
      set({
        profileError:
          "No execution profile is selected. Choose a valid profile before running import.",
      });
      return;
    }
    if (!global.profileValidationState[profile.id]?.valid) {
      set({
        profileError: `Execution profile "${profile.label}" is invalid. Fix it in Settings before running import.`,
      });
      return;
    }

    set((state) => {
      const rowsBySubject = new Map<string, SubjectRow>();
      for (const row of acceptedImportSettings().subjectRows) {
        if (!rowsBySubject.has(row.subject)) {
          rowsBySubject.set(row.subject, row);
        }
      }

      const selectedSubjectKeys = subjects ? new Set(subjects.map(portableKey)) : null;
      const importProgress = Object.fromEntries(
        Array.from(rowsBySubject.values()).map((row) => {
          const existing = state.importProgress[row.subject];
          const selected =
            selectedSubjectKeys === null || selectedSubjectKeys.has(portableKey(row.subject));
          if (!selected && existing) {
            return [row.subject, existing];
          }
          const status =
            existing && existing.status === "completed"
              ? ("completed" as const)
              : ("pending" as const);
          const duration =
            existing && existing.status === "completed" ? existing.duration : undefined;
          return [
            row.subject,
            {
              subject: row.subject,
              session: row.session,
              status,
              duration,
            },
          ];
        }),
      );

      return {
        importPhase: "preparing",
        importCompleted: false,
        importLog: [],
        importProgress,
        importRunning: false,
        importSummary: null,
        profileError: null,
      };
    });
  },

  addLogLines: (lines) => {
    if (lines.length === 0) return;
    set((state) => {
      const filtered: string[] = [];
      const currentLog = [...state.importLog];
      for (const line of lines) {
        const trimmed = line.trim();
        const isDup =
          currentLog.slice(-40).some((l) => l.trim() === trimmed) ||
          filtered.slice(-40).some((l) => l.trim() === trimmed);
        if (!isDup) {
          filtered.push(line);
        }
      }
      if (filtered.length === 0) return {};
      return {
        importLog: [...state.importLog, ...filtered],
      };
    });
  },

  markSubjectRunning: (subject, step) => {
    set((state) => {
      const current = subjectProgress(subject, state.importProgress[subject]);
      return {
        importProgress: {
          ...state.importProgress,
          [subject]: {
            ...current,
            status: "running",
            currentStep: step,
          },
        },
      };
    });
  },

  markSubjectDiagnosticFailure: (subject, message) => {
    set((state) => {
      const current = subjectProgress(subject, state.importProgress[subject]);
      if (current.status === "completed") return {};
      return {
        importProgress: { ...state.importProgress, [subject]: { ...current, error: message } },
      };
    });
  },

  bindImportRunSnapshot: (snapshot) => {
    const terminal = ["completed", "failed", "cancelled", "interrupted"].includes(
      snapshot.lifecycle,
    );
    set({
      activeRunId: terminal ? null : snapshot.runId,
      terminalRunId: terminal ? snapshot.runId : null,
      ownershipGeneration: snapshot.ownershipGeneration,
      nativeSnapshotUpdatedAtMs: snapshot.updatedAtMs,
      confirmationRequired: snapshot.confirmationRequired,
      importPhase: snapshot.lifecycle,
      importRunning: snapshot.lifecycle === "running" || snapshot.lifecycle === "cancelling",
      importRunError: snapshot.error?.message ?? null,
    });
    useImportStore.getState().reconcileImportRunSnapshot(snapshot);
  },

  reconcileImportRunSnapshot: (snapshot, lease) => {
    if (lease && (!isCurrentProjectLease(lease) || !isProjectWorkAccepted())) return;
    set((state) => {
      const known = state.activeRunId ?? state.terminalRunId;
      if (
        known !== snapshot.runId ||
        (state.ownershipGeneration !== null &&
          state.ownershipGeneration !== snapshot.ownershipGeneration) ||
        (state.nativeSnapshotUpdatedAtMs !== null &&
          snapshot.updatedAtMs < state.nativeSnapshotUpdatedAtMs) ||
        snapshotRegressesLifecycle(state.importPhase, snapshot.lifecycle) ||
        ((["completed", "failed", "cancelled", "interrupted"] as ImportPhase[]).includes(
          state.importPhase,
        ) &&
          !["completed", "failed", "cancelled", "interrupted"].includes(snapshot.lifecycle))
      )
        return {};
      const terminal = ["completed", "failed", "cancelled", "interrupted"].includes(
        snapshot.lifecycle,
      );
      const outcomes = new Map(
        snapshot.subjectOutcomes.map((outcome) => [outcome.subject, outcome]),
      );
      const importProgress = { ...state.importProgress };
      for (const subject of snapshot.selectedSubjects) {
        const current = subjectProgress(subject, importProgress[subject]);
        const outcome = outcomes.get(subject);
        const status = outcome?.committed
          ? "completed"
          : outcome?.outcome === "failed"
            ? "failed"
            : outcome?.outcome === "cancelled"
              ? "cancelled"
              : outcome?.outcome === "interrupted"
                ? "interrupted"
                : snapshot.lifecycle === "cancelled"
                  ? "cancelled"
                  : snapshot.lifecycle === "interrupted"
                    ? "interrupted"
                    : snapshot.lifecycle === "running"
                      ? current.status === "completed"
                        ? "pending"
                        : current.status
                      : "pending";
        importProgress[subject] = {
          ...current,
          status,
          error: outcome?.error?.message ?? current.error,
        };
      }
      const committed = snapshot.subjectOutcomes.filter((outcome) => outcome.committed).length;
      return {
        activeRunId: terminal ? null : snapshot.runId,
        terminalRunId: terminal ? snapshot.runId : null,
        ownershipGeneration: snapshot.ownershipGeneration,
        nativeSnapshotUpdatedAtMs: snapshot.updatedAtMs,
        confirmationRequired: snapshot.confirmationRequired,
        importPhase: snapshot.lifecycle,
        importCompleted: snapshot.lifecycle === "completed",
        importRunning: snapshot.lifecycle === "running" || snapshot.lifecycle === "cancelling",
        importProgress,
        importSummary: terminal
          ? {
              succeeded: committed,
              failed: snapshot.selectedSubjects.length - committed,
              errors: snapshot.error ? [snapshot.error.message] : [],
            }
          : state.importSummary,
        importRunError: snapshot.error?.message ?? null,
        stagingPreflight: snapshot.error?.stagingIssues
          ? {
              ...state.stagingPreflight,
              status: "invalid",
              issues: snapshot.error.stagingIssues,
              error: null,
            }
          : state.stagingPreflight,
      };
    });
  },

  setSelectedProfileId: (id) => {
    void useProjectStore
      .getState()
      .submitEdit((project) => ({
        kind: "import",
        mapping: project.mappingState,
        preferences: {
          activeStep: project.uiState.import?.activeStep,
          ...(id === null ? {} : { selectedProfileId: id }),
        },
      }))
      .catch(() => undefined);
  },

  autoSelectProfile: () => {
    if (useProjectStore.getState().project?.uiState.import?.selectedProfileId) return;
    const { settings, profileValidationState } = useGlobalStore.getState();
    const firstValid = settings.executionProfiles.find(
      (p) => profileValidationState[p.id]?.valid === true,
    );
    if (firstValid) {
      get().setSelectedProfileId(firstValid.id);
    }
  },

  clearProfileError: () => {
    set({ profileError: null });
  },

  applyStaleness: (staleness) => {
    set((state) => {
      const importProgress = { ...state.importProgress };
      for (const [subject, stale] of Object.entries(staleness)) {
        if (importProgress[subject]) {
          importProgress[subject] = { ...importProgress[subject], stale };
        }
      }
      return { importProgress };
    });
  },

  reconstructProgressFromLockFiles: (statuses, subjects, staleness) => {
    set((state) => {
      if (["running", "preparing", "finalizing", "cancelling"].includes(state.importPhase)) {
        return {};
      }

      const statusMap = new Map(statuses.map((s) => [s.subject, s]));
      const importProgress = { ...state.importProgress };

      for (const subject of subjects) {
        const lockStatus = statusMap.get(subject);
        const stale = staleness[subject] ?? false;
        const existing = importProgress[subject];

        if (lockStatus) {
          importProgress[subject] = {
            ...(existing ?? { subject, session: "" }),
            status: lockStatus.status,
            stale,
          };
        } else {
          importProgress[subject] = {
            ...(existing ?? { subject, session: "" }),
            status: "pending" as const,
            stale,
          };
        }

        if (!importProgress[subject].subject) {
          importProgress[subject].subject = subject;
        }
      }

      return { importProgress };
    });
  },

  resetImport: () => {
    set(createInitialImportState());
  },

  // ---------------------------------------------------------------------------
  // BIDS Review Slice
  // ---------------------------------------------------------------------------

  startBidsScan: async (rootPath: string) => {
    console.debug("[importStore] startBidsScan:", rootPath);
    try {
      const { detectedGroups, skippedSubjects } = await scanBidsSidecars(rootPath);

      console.debug("[importStore] scan_bids_sidecars success:", {
        groups: detectedGroups.length,
        skipped: skippedSubjects.length,
      });

      set({
        bidsReview: {
          scanComplete: true,
          scanError: null,
          detectedGroups,
          skippedSubjects,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[importStore] startBidsScan error:", message, err);
      set({
        bidsReview: {
          scanComplete: false,
          scanError: message,
          detectedGroups: [],
          skippedSubjects: [],
        },
      });
    }
  },

  setDetectedGroups: (groups) => {
    console.debug("[importStore] setDetectedGroups:", groups.length);
    set((state) => ({
      bidsReview: { ...state.bidsReview, detectedGroups: groups },
    }));
  },

  /**
   * Clear any previous scan error and re-run the BIDS sidecar scan.
   * @param rootPath - Absolute path to the BIDS project root directory.
   */
  retryBidsScan: async (rootPath: string) => {
    console.debug("[importStore] retryBidsScan:", rootPath);
    logAction("bids_scan_retry", { rootPath });
    set((state) => ({
      bidsReview: { ...state.bidsReview, scanError: null },
    }));
    await useImportStore.getState().startBidsScan(rootPath);
  },

  /**
   * Re-scan an already-confirmed BIDS project. This updates only the
   * session-only review slice; persisted project mapping is overwritten later
   * by confirmBidsReview after the user explicitly confirms.
   */
  rescanConfirmedBidsProject: async (rootPath: string) => {
    console.debug("[importStore] rescanConfirmedBidsProject:", rootPath);
    logAction("bids_confirmed_rescan", { rootPath });
    set({
      bidsReview: {
        scanComplete: false,
        scanError: null,
        detectedGroups: [],
        skippedSubjects: [],
      },
    });

    await useImportStore.getState().startBidsScan(rootPath);
  },

  /**
   * Reset BIDS review state and return to the landing/source-selection view.
   * The calling component must call `navigate("/")` separately.
   */
  backToLanding: () => {
    console.debug("[importStore] backToLanding");
    set({
      bidsReview: {
        scanComplete: false,
        scanError: null,
        detectedGroups: [],
        skippedSubjects: [],
      },
    });
  },

  resetBidsReview: () => {
    set({
      bidsReview: {
        scanComplete: false,
        scanError: null,
        detectedGroups: [],
        skippedSubjects: [],
      },
    });
  },
}));
