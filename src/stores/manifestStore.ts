import { create } from "zustand";
import { readAllSubjectQcOutputs, type SubjectQcOutputs } from "../lib/manifestQc";
import { type ManifestUiState, type ManifestVerdict } from "../schemas/project";
import type { ReviewerMode } from "../schemas/manifestSchemas";
import { useProjectStore } from "./projectStore";
import { useProcessingStore } from "./processingStore";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { commands } from "../lib/ipc";
import { captureProjectLease, isCurrentProjectLease } from "../lib/projectLifecycle";

type FlatManifestVerdicts = Record<string, ManifestVerdict>;
type NestedManifestVerdicts = Record<string, FlatManifestVerdicts>;

export interface ManifestDisagreement {
  subjectSession: string;
  verdictsByReviewer: Record<string, ManifestVerdict>;
}

export type StaleVerdicts = Record<string, Set<string>>;

interface ManifestState {
  step: 0 | 1 | 2;
  filter: "all" | "neutral" | "pass" | "fail" | "no-info";
  staleVerdicts: StaleVerdicts;
  priorModulesMtimes: Record<string, number | null>;
  qcData: Record<string, SubjectQcOutputs> | null;
  qcLoaded: boolean;
  qcLoading: boolean;
  dataPar: Record<string, string | number | boolean> | null;
  setStep: (step: 0 | 1 | 2) => void;
  setFilter: (filter: ManifestState["filter"]) => void;
  loadPriorModulesMtimes: () => Promise<void>;
  computeStaleVerdicts: () => void;
  resetStep: () => void;
  resetManifest: () => void;
  loadQcData: (projectRoot: string) => Promise<void>;
  loadDataPar: (projectRoot: string) => Promise<void>;
}

function createInitialManifestState() {
  return {
    step: 0 as const,
    filter: "all" as const,
    staleVerdicts: {} as StaleVerdicts,
    priorModulesMtimes: {},
    qcData: null,
    qcLoaded: false,
    qcLoading: false,
    dataPar: null,
  };
}

export function reviewerMode(manifest: ManifestUiState | undefined): ReviewerMode {
  return (manifest?.reviewers?.length ?? 0) >= 2 ? "multi" : "single";
}

function registeredReviewerVerdicts(manifest: ManifestUiState | undefined): NestedManifestVerdicts {
  const verdicts = manifest?.verdicts ?? {};
  return (manifest?.reviewers ?? []).reduce<NestedManifestVerdicts>((slices, reviewer) => {
    slices[reviewer.id] = verdicts[reviewer.id] ?? {};
    return slices;
  }, {});
}

function completeSubjectSessions(verdictsByReviewer: NestedManifestVerdicts): string[] {
  const reviewerVerdicts = Object.values(verdictsByReviewer);
  if (reviewerVerdicts.length === 0) return [];

  return Array.from(new Set(reviewerVerdicts.flatMap(Object.keys)))
    .filter((subjectSession) =>
      reviewerVerdicts.every((verdicts) => verdicts[subjectSession] !== undefined),
    )
    .sort();
}

function completeVerdictsForSubject(
  verdictsByReviewer: NestedManifestVerdicts,
  subjectSession: string,
): Record<string, ManifestVerdict> | null {
  const fullVerdicts: Record<string, ManifestVerdict> = {};
  for (const [reviewerId, verdicts] of Object.entries(verdictsByReviewer)) {
    const verdict = verdicts[subjectSession];
    if (!verdict) return null;
    fullVerdicts[reviewerId] = verdict;
  }
  return fullVerdicts;
}

export function deriveDisagreements(manifest: ManifestUiState | undefined): ManifestDisagreement[] {
  if (reviewerMode(manifest) === "single") return [];

  const verdictsByReviewer = registeredReviewerVerdicts(manifest);
  return completeSubjectSessions(verdictsByReviewer).reduce<ManifestDisagreement[]>(
    (rows, subjectSession) => {
      const fullVerdicts = completeVerdictsForSubject(verdictsByReviewer, subjectSession);
      if (!fullVerdicts) return rows;
      const statuses = new Set(Object.values(fullVerdicts).map(({ status }) => status));
      if (statuses.size > 1) rows.push({ subjectSession, verdictsByReviewer: fullVerdicts });
      return rows;
    },
    [],
  );
}

function emptyStaleVerdicts(manifest: ManifestUiState | undefined): StaleVerdicts {
  return Object.fromEntries((manifest?.reviewers ?? []).map(({ id }) => [id, new Set<string>()]));
}

export const useManifestStore = create<ManifestState>((set, get) => ({
  ...createInitialManifestState(),

  setStep: (step) => set({ step }),

  setFilter: (filter) => set({ filter }),

  resetStep: () => set({ step: 0 }),

  resetManifest: () => set(createInitialManifestState()),

  loadPriorModulesMtimes: async () => {
    const lease = captureProjectLease();
    const project = useProjectStore.getState().project;
    const projectRoot = project?.projectMeta.rootPath;
    if (!projectRoot) return;
    const projectId = project?.projectMeta.id;
    const isCurrentProject = () => {
      if (lease) return isCurrentProjectLease(lease);
      const currentProject = useProjectStore.getState().project;
      return (
        currentProject?.projectMeta.rootPath === projectRoot &&
        currentProject?.projectMeta.id === projectId
      );
    };
    const currentManifest = () => useProjectStore.getState().project?.uiState?.manifest;

    const manifest = project?.uiState?.manifest;
    const verdicts = Object.values(registeredReviewerVerdicts(manifest)).flatMap(Object.keys);

    let subjects = useProcessingStore.getState().availableSubjects;
    if (subjects.length === 0) {
      await useProcessingStore
        .getState()
        .scanAvailableSubjects()
        .catch((err) => {
          console.warn("[manifestStore] scanAvailableSubjects failed during mtime load:", err);
        });
      subjects = useProcessingStore.getState().availableSubjects;
    }
    if (!isCurrentProject()) return;

    const subjectSessions = Array.from(
      new Set([...subjects.map((s) => s.subjectSession), ...verdicts]),
    );

    if (subjectSessions.length === 0) {
      const activeManifest = currentManifest();
      set({
        staleVerdicts: emptyStaleVerdicts(activeManifest),
        priorModulesMtimes: {},
      });
      return;
    }

    try {
      const mtimes = await commands.readPriorModulesMtimes(projectRoot, subjectSessions);
      if (!isCurrentProject()) return;
      set({ priorModulesMtimes: mtimes });
      get().computeStaleVerdicts();
    } catch (err) {
      console.warn("[manifestStore] failed to read prior modules mtimes for staleness", err);
      if (!isCurrentProject()) return;
      const activeManifest = currentManifest();
      set({
        staleVerdicts: emptyStaleVerdicts(activeManifest),
      });
    }
  },

  computeStaleVerdicts: () => {
    const project = useProjectStore.getState().project;
    const manifest = project?.uiState?.manifest;
    const priorModulesMtimes = get().priorModulesMtimes;

    const staleByReviewer = Object.fromEntries(
      Object.entries(registeredReviewerVerdicts(manifest)).map(([reviewerId, verdicts]) => {
        const stale = new Set<string>();
        for (const [subjectSession, verdict] of Object.entries(verdicts)) {
          if (verdict.setAt === 0) continue;
          const current = priorModulesMtimes[subjectSession];
          if (current !== undefined && current !== null && verdict.setAt !== current) {
            stale.add(subjectSession);
          }
        }
        return [reviewerId, stale];
      }),
    );
    set({ staleVerdicts: staleByReviewer });
  },

  loadQcData: async (projectRoot) => {
    if (get().qcLoading) return;
    const lease = captureProjectLease();
    const isCurrent = () => !lease || isCurrentProjectLease(lease);
    set({ qcLoading: true });
    try {
      let subjects = useProcessingStore.getState().availableSubjects;
      if (subjects.length === 0) {
        await useProcessingStore
          .getState()
          .scanAvailableSubjects()
          .catch((err) => {
            console.warn("[manifestStore] scanAvailableSubjects failed during QC load:", err);
          });
        subjects = useProcessingStore.getState().availableSubjects;
      }
      if (!isCurrent()) return;

      const subjectSessions = subjects.map((s) => s.subjectSession);
      const data = await readAllSubjectQcOutputs(projectRoot, subjectSessions);
      if (!isCurrent()) return;
      set({ qcData: data, qcLoaded: true, qcLoading: false });
    } catch (err) {
      if (!isCurrent()) return;
      console.warn("[manifestStore] failed to load QC data", err);
      set({ qcData: null, qcLoaded: true, qcLoading: false });
    }
  },

  loadDataPar: async (projectRoot) => {
    const lease = captureProjectLease();
    const isCurrent = () => !lease || isCurrentProjectLease(lease);
    const path = `${projectRoot}/derivatives/ExploreASL/dataPar.json`;
    try {
      if (await exists(path)) {
        if (!isCurrent()) return;
        const raw = await readTextFile(path);
        if (!isCurrent()) return;
        const parsed = JSON.parse(raw);
        set({ dataPar: parsed });
      } else {
        if (!isCurrent()) return;
        set({ dataPar: null });
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.warn("[manifestStore] failed to load dataPar.json", err);
      set({ dataPar: null });
    }
  },
}));
