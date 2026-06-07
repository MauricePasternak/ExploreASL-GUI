import { create } from "zustand";

import { getMaxUnlockedImportStep } from "../lib/importStepAccess";

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
  importProgress: {} as Record<string, ImportProgress>,
  importRunning: false,
  importSummary: null as ImportState["importSummary"],
};

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
    };

    const requestedStep = safe("activeStep", INITIAL_STATE.activeStep) as number;
    const maxStep = getMaxUnlockedImportStep(partialState);

    set({
      ...partialState,
      activeStep: Math.min(requestedStep, maxStep),
    });
  },

  resetImport: () => {
    set({ ...INITIAL_STATE });
  },
}));
