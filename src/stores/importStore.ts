import { z } from "zod";
import { create } from "zustand";

import { type ImportSubjectStatus } from "../lib/importStatus";
import { getMaxRestorableImportStep } from "../lib/importStepAccess";

import {
  ImportSnapshotSchema,
  IMPORT_EXECUTION_PHASES,
  PathPatternSchema,
  TokenAssignmentSchema,
  ModalityAliasSchema,
  SessionAliasSchema,
  SubjectRenameSchema,
  MetadataGroupSchema,
  SubjectRowSchema,
} from "../schemas/importSchemas";
import type {
  ImportProgress,
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

// =============================================================================
// State Interface
// =============================================================================

export type ImportPhase = "idle" | "preparing" | "running" | "completed" | "failed" | "cancelled";

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
  failedSubjects: string[];
  importProgress: Record<string, ImportProgress>;
  importRunning: boolean;
  importSummary: {
    succeeded: number;
    failed: number;
    errors: string[];
  } | null;

  // Snapshot
  mostRecentConfig: ImportSnapshot | null;

  // MATLAB selection
  selectedMatlabPath: string;
  setSelectedMatlabPath: (path: string) => void;

  // Actions
  setActiveStep: (step: number) => void;
  setSourceDataPath: (path: string) => void;
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
  startImport: () => void;
  setImportPhase: (phase: ImportPhase) => void;
  addLogLine: (line: string) => void;
  addLogLines: (lines: string[]) => void;
  markSubjectRunning: (subject: string, step?: "DCM2NII" | "NII2BIDS") => void;
  markSubjectCompleted: (subject: string, duration: number) => void;
  markSubjectFailed: (subject: string, step: "DCM2NII" | "NII2BIDS", message: string) => void;
  markSubjectCancelled: (subject: string) => void;
  completeImport: () => void;
  failImport: () => void;
  cancelImport: () => void;
  resetImportPhase: () => void;
  setImportRunning: (running: boolean) => void;
  updateImportProgress: (subject: string, progress: ImportProgress) => void;
  setImportSummary: (summary: ImportState["importSummary"]) => void;
  setMostRecentConfig: (snapshot: ImportSnapshot) => void;
  applyStaleness: (staleness: Record<string, boolean>) => void;
  reconstructProgressFromLockFiles: (
    statuses: ImportSubjectStatus[],
    subjects: string[],
    staleness: Record<string, boolean>,
  ) => void;
  loadPersistedState: (persisted: Record<string, unknown>) => void;
  resetImport: () => void;
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
  failedSubjects: [] as string[],
  importProgress: {} as Record<string, ImportProgress>,
  importRunning: false,
  importSummary: null as ImportState["importSummary"],
  mostRecentConfig: null as ImportSnapshot | null,
  selectedMatlabPath: "",
};

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
  if (phase === "preparing" || phase === "running") {
    return "failed";
  }

  if (phase === "idle" || phase === "completed" || phase === "failed" || phase === "cancelled") {
    return phase;
  }

  return INITIAL_STATE.importPhase;
}

// =============================================================================
// Store
// =============================================================================

export const useImportStore = create<ImportState>((set) => ({
  ...INITIAL_STATE,

  setActiveStep: (step) => {
    set({ activeStep: step });
  },

  setSourceDataPath: (path) => {
    set({ sourceDataPath: path });
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
    set((state) => ({
      metadataGroups: [...state.metadataGroups, group],
    }));
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

  startImport: () => {
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
      };

      const rowsBySubject = new Map<string, SubjectRow>();
      for (const row of state.subjectRows) {
        if (!rowsBySubject.has(row.subject)) {
          rowsBySubject.set(row.subject, row);
        }
      }

      const importProgress = Object.fromEntries(
        Array.from(rowsBySubject.values()).map((row) => {
          const existing = state.importProgress[row.subject];
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
        failedSubjects: [],
        importProgress,
        importRunning: false,
        importSummary: null,
        mostRecentConfig: snapshot,
      };
    });
  },

  setImportPhase: (phase) => {
    set({
      importPhase: phase,
      importRunning: phase === "running",
    });
  },

  addLogLine: (line) => {
    set((state) => {
      const trimmed = line.trim();
      const isDup = state.importLog.slice(-40).some((l) => l.trim() === trimmed);
      if (isDup) return {};
      return {
        importLog: [...state.importLog, line],
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
      if (state.failedSubjects.includes(subject)) {
        return {};
      }
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

  markSubjectCompleted: (subject, duration) => {
    set((state) => {
      if (state.failedSubjects.includes(subject)) {
        return {};
      }
      const current = subjectProgress(subject, state.importProgress[subject]);
      return {
        importProgress: {
          ...state.importProgress,
          [subject]: {
            ...current,
            status: "completed",
            duration,
            error: undefined,
            errorStep: undefined,
          },
        },
      };
    });
  },

  markSubjectFailed: (subject, step, message) => {
    set((state) => {
      const current = subjectProgress(subject, state.importProgress[subject]);
      return {
        failedSubjects: state.failedSubjects.includes(subject)
          ? state.failedSubjects
          : [...state.failedSubjects, subject],
        importProgress: {
          ...state.importProgress,
          [subject]: {
            ...current,
            status: "failed",
            errorStep: step,
            error: message,
          },
        },
      };
    });
  },

  markSubjectCancelled: (subject) => {
    set((state) => {
      const current = subjectProgress(subject, state.importProgress[subject]);
      return {
        failedSubjects: state.failedSubjects.filter((failed) => failed !== subject),
        importProgress: {
          ...state.importProgress,
          [subject]: {
            ...current,
            status: "cancelled",
          },
        },
      };
    });
  },

  completeImport: () => {
    set({
      importPhase: "completed",
      importCompleted: true,
      importRunning: false,
    });
  },

  failImport: () => {
    set({
      importPhase: "failed",
      importCompleted: false,
      importRunning: false,
    });
  },

  cancelImport: () => {
    set((state) => {
      const importProgress = Object.fromEntries(
        Object.entries(state.importProgress).map(([subject, progress]) => [
          subject,
          progress.status === "running" || progress.status === "pending"
            ? { ...progress, status: "cancelled" as const }
            : progress,
        ]),
      );

      return {
        importPhase: "cancelled",
        importCompleted: false,
        importRunning: false,
        failedSubjects: state.failedSubjects.filter(
          (subject) => importProgress[subject]?.status === "failed",
        ),
        importProgress,
      };
    });
  },

  resetImportPhase: () => {
    set({
      importPhase: "idle",
      importCompleted: false,
      importLog: [],
      failedSubjects: [],
      importRunning: false,
      importSummary: null,
    });
  },

  setImportRunning: (running) => {
    set({ importRunning: running });
  },

  updateImportProgress: (subject, progress) => {
    set((state) => ({
      importProgress: {
        ...state.importProgress,
        [subject]: progress,
      },
    }));
  },

  setImportSummary: (summary) => {
    set({ importSummary: summary });
  },

  setMostRecentConfig: (snapshot) => {
    set({ mostRecentConfig: snapshot });
  },

  setSelectedMatlabPath: (path) => {
    set({ selectedMatlabPath: path });
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
      if (state.importPhase === "running" || state.importPhase === "preparing") {
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
    });

    const parsed = schema.parse(persisted);

    const importPhase = normalizePersistedImportPhase(parsed.importPhase);
    const importCompleted = importPhase === "failed" ? false : parsed.importCompleted;

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
      importPhase,
      importCompleted,
      importRunning: false,
    };

    const requestedStep = parsed.activeStep;
    const maxStep = getMaxRestorableImportStep(partialState);

    set({
      ...partialState,
      activeStep: Math.min(requestedStep, maxStep),
    });
  },

  resetImport: () => {
    set({ ...INITIAL_STATE });
  },
}));
