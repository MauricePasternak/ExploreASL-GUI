import { z } from "zod";
import { create } from "zustand";

import { invoke } from "@tauri-apps/api/core";

import { formatBidsScanValidationError } from "../lib/bids/errorFormatter";
import { logAction } from "../lib/debug";
import { type ImportSubjectStatus } from "../lib/importStatus";
import { getMaxRestorableImportStep } from "../lib/importStepAccess";
import {
  isCurrentProjectLease,
  isProjectWorkAccepted,
  type ProjectLease,
} from "../lib/projectLifecycle";
import { portableKey, type StagingValidationIssue } from "../lib/stagingValidation";
import { useGlobalStore } from "./globalStore";

import type {
  DerivedMetadataGroup,
  ImportLifecycle,
  ImportProgress,
  ImportRunSnapshot,
  ImportSnapshot,
  MetadataGroup,
  ModalityAlias,
  PathPattern,
  SessionAlias,
  SubjectRename,
  SubjectRow,
  TokenAssignment,
  TokenTag,
} from "../schemas/importSchemas";
import {
  DerivedMetadataGroupSchema,
  IMPORT_EXECUTION_PHASES,
  ImportSnapshotSchema,
  MetadataGroupSchema,
  ModalityAliasSchema,
  PathPatternSchema,
  SessionAliasSchema,
  SubjectRenameSchema,
  SubjectRowSchema,
  TokenAssignmentSchema,
} from "../schemas/importSchemas";

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
  // Step tracking
  activeStep: number;

  // Step 1: Ingestion
  sourceDataPath: string;
  rawPaths: string[];
  pathPatterns: PathPattern[];
  bMatchDirectories: boolean;
  ingestionComplete: boolean;

  // Step 2: Tokenizer
  /** pattern signature → assignments for that pattern */
  tokenizerConfigs: Record<string, TokenAssignment[]>;

  // Step 3: Aliases
  modalityAliases: ModalityAlias[];
  sessionAliases: SessionAlias[];
  runAliases: SessionAlias[];
  subjectRenames: SubjectRename[];

  // Step 4: Metadata
  metadataGroups: MetadataGroup[];
  subjectRows: SubjectRow[];

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

  // Snapshot
  mostRecentConfig: ImportSnapshot | null;
  /** Runtime-only configuration captured for current native reservation. */
  pendingImportConfig: ImportSnapshot | null;

  // BIDS review (session-only, not persisted)
  bidsReview: BidsReviewState;
  sourceAvailability: DicomSourceAvailability;
  requiresManualSave: boolean;
  stagingPreflight: StagingPreflightState;

  // Execution profile selection (persisted to .easl via uiState.import.selectedProfileId)
  selectedProfileId: string | null;
  /** Inline pre-run error (e.g. missing/invalid profile). Not persisted. */
  profileError: string | null;
  setSelectedProfileId: (id: string | null) => void;
  autoSelectProfile: () => void;
  clearProfileError: () => void;

  // Actions
  setActiveStep: (step: number) => void;
  setSourceDataPath: (path: string) => void;
  relinkCompatibleSource: (path: string) => void;
  relinkIncompatibleSource: (path: string, paths: string[], patterns: PathPattern[]) => void;
  setSourceAvailability: (availability: DicomSourceAvailability) => void;
  clearManualSaveRequirement: () => void;
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
  setIngestionResults: (paths: string[], patterns: PathPattern[]) => void;
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
  setMostRecentConfig: (snapshot: ImportSnapshot) => void;
  applyStaleness: (staleness: Record<string, boolean>) => void;
  reconstructProgressFromLockFiles: (
    statuses: ImportSubjectStatus[],
    subjects: string[],
    staleness: Record<string, boolean>,
  ) => void;
  loadPersistedState: (persisted: Record<string, unknown>) => void;
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
  activeStep: 0,
  sourceDataPath: "",
  rawPaths: [] as string[],
  pathPatterns: [] as PathPattern[],
  bMatchDirectories: true,
  ingestionComplete: false,
  tokenizerConfigs: {} as Record<string, TokenAssignment[]>,
  modalityAliases: [] as ModalityAlias[],
  sessionAliases: [] as SessionAlias[],
  runAliases: [] as SessionAlias[],
  subjectRenames: [] as SubjectRename[],
  metadataGroups: [] as MetadataGroup[],
  subjectRows: [] as SubjectRow[],
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
  mostRecentConfig: null as ImportSnapshot | null,
  pendingImportConfig: null as ImportSnapshot | null,
  bidsReview: {
    scanComplete: false,
    scanError: null,
    detectedGroups: [] as DerivedMetadataGroup[],
    skippedSubjects: [] as string[],
  },
  selectedProfileId: null as string | null,
  profileError: null as string | null,
  sourceAvailability: {
    status: "unconfigured",
    savedPath: null,
    message: null,
  } as DicomSourceAvailability,
  requiresManualSave: false,
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
    rawPaths: [],
    pathPatterns: [],
    tokenizerConfigs: {},
    modalityAliases: [],
    sessionAliases: [],
    runAliases: [],
    subjectRenames: [],
    metadataGroups: [],
    subjectRows: [],
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

function normalizePersistedImportPhase(phase: unknown): ImportPhase {
  if (
    phase === "preparing" ||
    phase === "running" ||
    phase === "finalizing" ||
    phase === "cancelling"
  ) {
    return "interrupted";
  }

  if (
    phase === "idle" ||
    phase === "completed" ||
    phase === "failed" ||
    phase === "cancelled" ||
    phase === "interrupted"
  ) {
    return phase;
  }

  return INITIAL_STATE.importPhase;
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
    set({ activeStep: step });
  },

  setSourceDataPath: (path) => {
    set({ sourceDataPath: path });
  },

  relinkCompatibleSource: (path) => {
    set((state) => ({
      sourceDataPath: path,
      mostRecentConfig: state.mostRecentConfig
        ? { ...state.mostRecentConfig, sourceDataPath: path }
        : null,
      sourceAvailability: { status: "available", savedPath: path, message: null },
      requiresManualSave: true,
    }));
  },

  relinkIncompatibleSource: (path, paths, patterns) => {
    set({
      activeStep: 0,
      sourceDataPath: path,
      rawPaths: paths,
      pathPatterns: patterns,
      ingestionComplete: paths.length > 0,
      tokenizerConfigs: {},
      modalityAliases: [],
      sessionAliases: [],
      runAliases: [],
      subjectRenames: [],
      metadataGroups: [],
      subjectRows: [],
      importProgress: {},
      importPhase: "idle",
      importCompleted: false,
      importLog: [],
      importRunning: false,
      importSummary: null,
      mostRecentConfig: null,
      sourceAvailability: { status: "available", savedPath: path, message: null },
      requiresManualSave: true,
    });
  },

  setSourceAvailability: (sourceAvailability) => set({ sourceAvailability }),
  clearManualSaveRequirement: () => set({ requiresManualSave: false }),

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

  setIngestionResults: (paths, patterns) => {
    set({
      rawPaths: paths,
      pathPatterns: patterns,
      ingestionComplete: paths.length > 0,
    });
  },

  setBMatchDirectories: (value) => {
    set({ bMatchDirectories: value });
  },

  setTokenAssignment: (patternSignature, blockIndex, subBlockIndex, tag) => {
    set((state) => {
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
    set((state) => {
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
    set((state) => ({
      tokenizerConfigs: {
        ...state.tokenizerConfigs,
        [patternSignature]: assignments,
      },
    }));
  },

  setModalityAliases: (aliases) => {
    set({ modalityAliases: aliases });
  },

  updateModalityAlias: (captured, mapped) => {
    set((state) => ({
      modalityAliases: state.modalityAliases.map((a) =>
        a.captured === captured ? { ...a, mapped } : a,
      ),
    }));
  },

  setSessionAliases: (aliases) => {
    set({ sessionAliases: aliases });
  },

  setRunAliases: (aliases) => {
    set({ runAliases: aliases });
  },

  setSubjectRenames: (renames) => {
    set({ subjectRenames: renames });
  },

  updateSubjectRename: (original, target) => {
    set((state) => ({
      subjectRenames: state.subjectRenames.map((r) =>
        r.original === original ? { ...r, target } : r,
      ),
    }));
  },

  addMetadataGroup: (group) => {
    set((state) => {
      if (state.metadataGroups.some((g) => g.id === group.id)) {
        return {};
      }
      return {
        metadataGroups: [...state.metadataGroups, group],
      };
    });
  },

  removeMetadataGroup: (id) => {
    set((state) => ({
      metadataGroups: state.metadataGroups.filter((g) => g.id !== id),
      subjectRows: state.subjectRows.map((row) =>
        row.groupId === id ? { ...row, groupId: "global-defaults" } : row,
      ),
    }));
  },

  updateMetadataGroup: (id, updates) => {
    set((state) => ({
      metadataGroups: state.metadataGroups.map((g) => (g.id === id ? { ...g, ...updates } : g)),
    }));
  },

  setSubjectRows: (rows) => {
    set({ subjectRows: rows });
  },

  updateSubjectRowGroup: (rowIds, groupId) => {
    set((state) => ({
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
    const selectedId = get().selectedProfileId;
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
      const snapshot: ImportSnapshot = {
        sourceDataPath: state.sourceDataPath,
        pathPatterns: state.pathPatterns,
        tokenizerConfigs: state.tokenizerConfigs,
        bMatchDirectories: state.bMatchDirectories,
        modalityAliases: state.modalityAliases,
        sessionAliases: state.sessionAliases,
        runAliases: state.runAliases,
        subjectRenames: state.subjectRenames,
        metadataGroups: state.metadataGroups,
        subjectRows: state.subjectRows,
        selectedProfileId: profile.id,
      };

      const rowsBySubject = new Map<string, SubjectRow>();
      for (const row of state.subjectRows) {
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
        pendingImportConfig: snapshot,
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
        mostRecentConfig:
          snapshot.lifecycle === "completed" && state.pendingImportConfig
            ? state.pendingImportConfig
            : state.mostRecentConfig,
        pendingImportConfig: terminal ? null : state.pendingImportConfig,
      };
    });
  },

  setMostRecentConfig: (snapshot) => {
    set({ mostRecentConfig: snapshot });
  },

  setSelectedProfileId: (id) => {
    set({ selectedProfileId: id });
  },

  autoSelectProfile: () => {
    if (get().selectedProfileId) return;
    const { settings, profileValidationState } = useGlobalStore.getState();
    const firstValid = settings.executionProfiles.find(
      (p) => profileValidationState[p.id]?.valid === true,
    );
    if (firstValid) {
      set({ selectedProfileId: firstValid.id });
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

  loadPersistedState: (persisted) => {
    const schema = z.object({
      sourceDataPath: z.string().catch("").default(""),
      rawPaths: z.array(z.string()).catch([]).default([]),
      pathPatterns: z.array(PathPatternSchema).catch([]).default([]),
      bMatchDirectories: z.boolean().catch(true).default(true),
      ingestionComplete: z.boolean().catch(false).default(false),
      tokenizerConfigs: z.record(z.string(), z.array(TokenAssignmentSchema)).catch({}).default({}),
      modalityAliases: z.array(ModalityAliasSchema).catch([]).default([]),
      sessionAliases: z.array(SessionAliasSchema).catch([]).default([]),
      runAliases: z.array(SessionAliasSchema).catch([]).default([]),
      subjectRenames: z.array(SubjectRenameSchema).catch([]).default([]),
      metadataGroups: z.array(MetadataGroupSchema).catch([]).default([]),
      subjectRows: z.array(SubjectRowSchema).catch([]).default([]),
      activeStep: z
        .number()
        .int()
        .min(0)
        .catch(INITIAL_STATE.activeStep)
        .default(INITIAL_STATE.activeStep),
      importPhase: z
        .enum(IMPORT_EXECUTION_PHASES)
        .catch(INITIAL_STATE.importPhase)
        .default(INITIAL_STATE.importPhase),
      importCompleted: z
        .boolean()
        .catch(INITIAL_STATE.importCompleted)
        .default(INITIAL_STATE.importCompleted),
      mostRecentConfig: ImportSnapshotSchema.nullable().catch(null).default(null),
      selectedProfileId: z.string().nullable().catch(null).default(null),
    });

    const parsed = schema.parse(persisted);

    const importPhase = normalizePersistedImportPhase(parsed.importPhase);
    const importCompleted =
      parsed.importCompleted && (importPhase === "completed" || importPhase === "idle");
    const persistedPhase: ImportPhase =
      importCompleted && importPhase === "idle" ? "completed" : importPhase;

    const partialState = {
      sourceDataPath: parsed.sourceDataPath,
      rawPaths: parsed.rawPaths,
      pathPatterns: parsed.pathPatterns,
      bMatchDirectories: parsed.bMatchDirectories,
      ingestionComplete: parsed.ingestionComplete,
      tokenizerConfigs: parsed.tokenizerConfigs,
      modalityAliases: parsed.modalityAliases,
      sessionAliases: parsed.sessionAliases,
      runAliases: parsed.runAliases,
      subjectRenames: parsed.subjectRenames,
      metadataGroups: parsed.metadataGroups,
      subjectRows: parsed.subjectRows,
      mostRecentConfig: parsed.mostRecentConfig,
      selectedProfileId: parsed.selectedProfileId,
      importPhase: persistedPhase,
      importCompleted,
      importRunning: false,
      activeRunId: null,
      ownershipGeneration: null,
      nativeSnapshotUpdatedAtMs: null,
      confirmationRequired: false,
      terminalRunId: null,
      confirmingStoppedRunId: null,
      confirmingStoppedGeneration: null,
      importRunError: null,
      pendingImportConfig: null,
    };

    const requestedStep = parsed.activeStep;
    const maxStep = getMaxRestorableImportStep(partialState);

    set({
      ...createInitialImportState(),
      ...partialState,
      activeStep: Math.min(requestedStep, maxStep),
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
