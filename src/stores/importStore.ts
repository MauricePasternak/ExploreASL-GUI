import { create } from "zustand";

import { getMaxRestorableImportStep } from "../lib/importStepAccess";

import type {
  ImportProgress,
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

export type ImportPhase =
  | "idle"
  | "preparing"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

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
  setTokenizerConfig: (
    patternSignature: string,
    assignments: TokenAssignment[],
  ) => void;
  setModalityAliases: (aliases: ModalityAlias[]) => void;
  updateModalityAlias: (
    captured: string,
    mapped: ModalityAlias["mapped"],
  ) => void;
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
  markSubjectRunning: (subject: string) => void;
  markSubjectCompleted: (subject: string, duration: number) => void;
  markSubjectFailed: (
    subject: string,
    step: "DCM2NII" | "NII2BIDS",
    message: string,
  ) => void;
  markSubjectCancelled: (subject: string) => void;
  completeImport: () => void;
  failImport: () => void;
  cancelImport: () => void;
  resetImportPhase: () => void;
  setImportRunning: (running: boolean) => void;
  updateImportProgress: (subject: string, progress: ImportProgress) => void;
  setImportSummary: (summary: ImportState["importSummary"]) => void;
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
};

function subjectProgress(
  subject: string,
  existing?: ImportProgress,
): ImportProgress {
  return existing ?? {
    subject,
    session: "",
    status: "pending",
  };
}

function normalizePersistedImportPhase(phase: unknown): ImportPhase {
  if (phase === "preparing" || phase === "running") {
    return "failed";
  }

  if (
    phase === "idle" ||
    phase === "completed" ||
    phase === "failed" ||
    phase === "cancelled"
  ) {
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
        (a) =>
          !(a.blockIndex === blockIndex && a.subBlockIndex === subBlockIndex),
      );

      // Add the new assignment
      const updated = [
        ...filtered,
        { blockIndex, subBlockIndex, tag },
      ];

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
        (a) =>
          !(a.blockIndex === blockIndex && a.subBlockIndex === subBlockIndex),
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
        row.groupId === id ? { ...row, groupId: "global-defaults" } : row
      ),
    }));
  },

  updateMetadataGroup: (id, updates) => {
    set((state) => ({
      metadataGroups: state.metadataGroups.map((g) =>
        g.id === id ? { ...g, ...updates } : g,
      ),
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
      const rowsBySubject = new Map<string, SubjectRow>();
      for (const row of state.subjectRows) {
        if (!rowsBySubject.has(row.subject)) {
          rowsBySubject.set(row.subject, row);
        }
      }

      const importProgress = Object.fromEntries(
        Array.from(rowsBySubject.values()).map((row) => [
          row.subject,
          {
            subject: row.subject,
            session: row.session,
            status: "pending" as const,
          },
        ]),
      );

      return {
        importPhase: "preparing",
        importCompleted: false,
        importLog: [],
        failedSubjects: [],
        importProgress,
        importRunning: false,
        importSummary: null,
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
    set((state) => ({
      importLog: [...state.importLog, line],
    }));
  },

  markSubjectRunning: (subject) => {
    set((state) => {
      const current = subjectProgress(subject, state.importProgress[subject]);
      return {
        failedSubjects: state.failedSubjects.filter((failed) => failed !== subject),
        importProgress: {
          ...state.importProgress,
          [subject]: {
            ...current,
            status: "running",
          },
        },
      };
    });
  },

  markSubjectCompleted: (subject, duration) => {
    set((state) => {
      const current = subjectProgress(subject, state.importProgress[subject]);
      return {
        failedSubjects: state.failedSubjects.filter((failed) => failed !== subject),
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
          progress.status === "running"
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

  loadPersistedState: (persisted) => {
    const safe = (key: string, fallback: unknown) => {
      const val = (persisted as Record<string, unknown>)[key];
      return val !== undefined ? val : fallback;
    };

    const importPhase = normalizePersistedImportPhase(
      safe("importPhase", INITIAL_STATE.importPhase),
    );
    const importCompleted =
      importPhase === "failed"
        ? false
        : (safe("importCompleted", INITIAL_STATE.importCompleted) as boolean);

    const partialState = {
      sourceDataPath: safe("sourceDataPath", INITIAL_STATE.sourceDataPath) as string,
      rawPaths: safe("rawPaths", INITIAL_STATE.rawPaths) as string[],
      pathPatterns: safe("pathPatterns", INITIAL_STATE.pathPatterns) as PathPattern[],
      bMatchDirectories: safe("bMatchDirectories", INITIAL_STATE.bMatchDirectories) as boolean,
      ingestionComplete: safe("ingestionComplete", INITIAL_STATE.ingestionComplete) as boolean,
      tokenizerConfigs: safe("tokenizerConfigs", INITIAL_STATE.tokenizerConfigs) as Record<string, TokenAssignment[]>,
      modalityAliases: safe("modalityAliases", INITIAL_STATE.modalityAliases) as ModalityAlias[],
      sessionAliases: safe("sessionAliases", INITIAL_STATE.sessionAliases) as SessionAlias[],
      runAliases: safe("runAliases", INITIAL_STATE.runAliases) as SessionAlias[],
      subjectRenames: safe("subjectRenames", INITIAL_STATE.subjectRenames) as SubjectRename[],
      metadataGroups: safe("metadataGroups", INITIAL_STATE.metadataGroups) as MetadataGroup[],
      subjectRows: safe("subjectRows", INITIAL_STATE.subjectRows) as SubjectRow[],
      importPhase,
      importCompleted,
      importRunning: false,
    };

    const requestedStep = safe("activeStep", INITIAL_STATE.activeStep) as number;
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
