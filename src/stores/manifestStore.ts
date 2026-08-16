import { create } from "zustand";
import { readAllSubjectQcOutputs, type SubjectQcOutputs } from "../lib/manifestQc";
import { cohensKappa, fleissKappa, type KappaResult } from "../lib/interRaterAgreement";
import {
  ManifestVerdictSchema,
  type ManifestUiState,
  type ManifestVerdict,
} from "../schemas/project";
import type { ReviewerMode } from "../schemas/manifestSchemas";
import { useProjectStore } from "./projectStore";
import { useProcessingStore } from "./processingStore";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

type FlatManifestVerdicts = Record<string, ManifestVerdict>;
type NestedManifestVerdicts = Record<string, FlatManifestVerdicts>;

export interface ManifestDisagreement {
  subjectSession: string;
  verdictsByReviewer: Record<string, ManifestVerdict>;
}

export interface AgreementResults {
  overall: KappaResult;
  perGroup: Record<string, KappaResult>;
}

export type StaleVerdicts = Set<string> | Record<string, Set<string>>;

interface ManifestState {
  step: 0 | 1 | 2;
  filter: "all" | "neutral" | "pass" | "fail" | "no-info";
  reviewerMode: ReviewerMode;
  disagreements: ManifestDisagreement[];
  agreementResults: AgreementResults | null;
  staleVerdicts: StaleVerdicts;
  priorModulesMtimes: Record<string, number | null>;
  qcData: Record<string, SubjectQcOutputs> | null;
  qcLoaded: boolean;
  qcLoading: boolean;
  dataPar: Record<string, string | number | boolean> | null;
  setStep: (step: 0 | 1 | 2) => void;
  setFilter: (filter: ManifestState["filter"]) => void;
  loadPriorModulesMtimes: () => Promise<void>;
  computeDisagreements: () => void;
  computeAgreement: () => void;
  computeStaleVerdicts: () => void;
  resetStep: () => void;
  resetManifest: () => void;
  loadQcData: (projectRoot: string) => Promise<void>;
  loadDataPar: (projectRoot: string) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManifestVerdict(value: unknown): value is ManifestVerdict {
  return ManifestVerdictSchema.safeParse(value).success;
}

function isFlatManifestVerdicts(value: unknown): value is FlatManifestVerdicts {
  return isRecord(value) && Object.values(value).every(isManifestVerdict);
}

function reviewerMode(manifest: ManifestUiState | undefined): ReviewerMode {
  return (manifest?.reviewers?.length ?? 0) >= 2 ? "multi" : "single";
}

function flatVerdicts(manifest: ManifestUiState | undefined): FlatManifestVerdicts {
  return isFlatManifestVerdicts(manifest?.verdicts) ? manifest.verdicts : {};
}

function nestedVerdicts(manifest: ManifestUiState | undefined): NestedManifestVerdicts {
  if (!isRecord(manifest?.verdicts)) return {};

  return Object.entries(manifest.verdicts).reduce<NestedManifestVerdicts>(
    (slices, [reviewerId, verdicts]) => {
      if (isFlatManifestVerdicts(verdicts)) slices[reviewerId] = verdicts;
      return slices;
    },
    {},
  );
}

function registeredReviewerVerdicts(manifest: ManifestUiState | undefined): NestedManifestVerdicts {
  const verdicts = nestedVerdicts(manifest);
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
      reviewerVerdicts.every((verdicts) => isManifestVerdict(verdicts[subjectSession])),
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
    if (!isManifestVerdict(verdict)) return null;
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

function verdictsForSubjects(
  verdictsByReviewer: NestedManifestVerdicts,
  subjectSessions: Iterable<string>,
): NestedManifestVerdicts {
  const selected = new Set(subjectSessions);
  return Object.fromEntries(
    Object.entries(verdictsByReviewer).map(([reviewerId, verdicts]) => [
      reviewerId,
      Object.fromEntries(
        Object.entries(verdicts)
          .filter(([subjectSession]) => selected.has(subjectSession))
          .map(([subjectSession, verdict]) => [subjectSession, verdict]),
      ),
    ]),
  );
}

function statusVerdicts(
  verdictsByReviewer: NestedManifestVerdicts,
): Record<string, Record<string, "pass" | "fail">> {
  return Object.fromEntries(
    Object.entries(verdictsByReviewer).map(([reviewerId, verdicts]) => [
      reviewerId,
      Object.fromEntries(
        Object.entries(verdicts).map(([subjectSession, verdict]) => [
          subjectSession,
          verdict.status,
        ]),
      ),
    ]),
  );
}

function computeKappa(verdictsByReviewer: NestedManifestVerdicts): KappaResult {
  const reviewerVerdicts = Object.values(statusVerdicts(verdictsByReviewer));
  if (reviewerVerdicts.length === 2) {
    return cohensKappa(reviewerVerdicts[0], reviewerVerdicts[1]);
  }
  return fleissKappa(statusVerdicts(verdictsByReviewer));
}

function emptyStaleVerdicts(manifest: ManifestUiState | undefined): StaleVerdicts {
  if (reviewerMode(manifest) === "single") return new Set();
  return Object.fromEntries((manifest?.reviewers ?? []).map(({ id }) => [id, new Set<string>()]));
}

function subjectSessionGroupIds(
  manifestProject: ReturnType<typeof useProjectStore.getState>["project"],
) {
  const groupIds = new Map<string, string>();
  for (const row of manifestProject?.mappingState?.subjectRows ?? []) {
    const subject = row.subject.replace(/^sub-/, "");
    groupIds.set(row.id, row.groupId);
    groupIds.set(`${row.subject}_${row.session}`, row.groupId);
    groupIds.set(`sub-${subject}_${row.session}`, row.groupId);
  }
  return groupIds;
}

export const useManifestStore = create<ManifestState>((set, get) => ({
  step: 0,
  filter: "all",
  reviewerMode: "single",
  disagreements: [],
  agreementResults: null,
  staleVerdicts: new Set(),
  priorModulesMtimes: {},
  qcData: null,
  qcLoaded: false,
  qcLoading: false,
  dataPar: null,

  setStep: (step) => set({ step }),

  setFilter: (filter) => set({ filter }),

  resetStep: () => set({ step: 0 }),

  resetManifest: () =>
    set({
      step: 0,
      filter: "all",
      reviewerMode: "single",
      disagreements: [],
      agreementResults: null,
      staleVerdicts: new Set(),
      priorModulesMtimes: {},
      qcData: null,
      qcLoaded: false,
      qcLoading: false,
      dataPar: null,
    }),

  loadPriorModulesMtimes: async () => {
    const project = useProjectStore.getState().project;
    const projectRoot = project?.projectMeta.rootPath;
    if (!projectRoot) return;
    const projectId = project?.projectMeta.id;
    const isCurrentProject = () => {
      const currentProject = useProjectStore.getState().project;
      return (
        currentProject?.projectMeta.rootPath === projectRoot &&
        currentProject?.projectMeta.id === projectId
      );
    };
    const currentManifest = () => useProjectStore.getState().project?.uiState?.manifest;

    const manifest = project?.uiState?.manifest;
    const verdicts =
      reviewerMode(manifest) === "multi"
        ? Object.values(registeredReviewerVerdicts(manifest)).flatMap(Object.keys)
        : Object.keys(flatVerdicts(manifest));

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
        reviewerMode: reviewerMode(activeManifest),
        staleVerdicts: emptyStaleVerdicts(activeManifest),
        priorModulesMtimes: {},
      });
      return;
    }

    try {
      const mtimes = await invoke<Record<string, number | null>>("read_prior_modules_mtimes", {
        projectRoot,
        subjectSessions,
      });
      if (!isCurrentProject()) return;
      set({ priorModulesMtimes: mtimes });
      get().computeStaleVerdicts();
    } catch (err) {
      console.warn("[manifestStore] failed to read prior modules mtimes for staleness", err);
      if (!isCurrentProject()) return;
      const activeManifest = currentManifest();
      set({
        reviewerMode: reviewerMode(activeManifest),
        staleVerdicts: emptyStaleVerdicts(activeManifest),
      });
    }
  },

  computeDisagreements: () => {
    const manifest = useProjectStore.getState().project?.uiState?.manifest;
    const mode = reviewerMode(manifest);
    set({ reviewerMode: mode, disagreements: deriveDisagreements(manifest) });
  },

  computeAgreement: () => {
    const project = useProjectStore.getState().project;
    const manifest = project?.uiState?.manifest;
    const mode = reviewerMode(manifest);
    if (mode === "single") {
      set({ reviewerMode: mode, agreementResults: null });
      return;
    }

    const verdictsByReviewer = registeredReviewerVerdicts(manifest);
    const completeSessions = completeSubjectSessions(verdictsByReviewer);
    const overall = computeKappa(verdictsForSubjects(verdictsByReviewer, completeSessions));
    const groups = project?.mappingState?.metadataGroups ?? [];
    const groupIdsBySubjectSession = subjectSessionGroupIds(project);
    const perGroup: Record<string, KappaResult> = {};

    for (const group of groups) {
      const groupSessions = completeSessions.filter(
        (subjectSession) => groupIdsBySubjectSession.get(subjectSession) === group.id,
      );
      perGroup[group.label] = computeKappa(verdictsForSubjects(verdictsByReviewer, groupSessions));
    }

    const groupedIds = new Set(groups.map(({ id }) => id));
    const ungroupedSessions = completeSessions.filter(
      (subjectSession) => !groupedIds.has(groupIdsBySubjectSession.get(subjectSession) ?? ""),
    );
    perGroup.Ungrouped = computeKappa(verdictsForSubjects(verdictsByReviewer, ungroupedSessions));

    set({ reviewerMode: mode, agreementResults: { overall, perGroup } });
  },

  computeStaleVerdicts: () => {
    const project = useProjectStore.getState().project;
    const manifest = project?.uiState?.manifest;
    const priorModulesMtimes = get().priorModulesMtimes;

    if (reviewerMode(manifest) === "multi") {
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
      set({ reviewerMode: "multi", staleVerdicts: staleByReviewer });
      return;
    }

    const stale = new Set<string>();
    for (const [ss, v] of Object.entries(flatVerdicts(manifest))) {
      // setAt: 0 means the mtime was unknown at capture time (race / missing
      // subject). Treat as unset rather than stale so the user's freshly-clicked
      // verdict isn't immediately flagged.
      if (v.setAt === 0) continue;
      const current = priorModulesMtimes[ss];
      if (current !== undefined && current !== null && v.setAt !== current) {
        stale.add(ss);
      }
    }
    set({ reviewerMode: "single", staleVerdicts: new Set(stale) });
  },

  loadQcData: async (projectRoot) => {
    if (get().qcLoading) return;
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

      const subjectSessions = subjects.map((s) => s.subjectSession);
      const data = await readAllSubjectQcOutputs(projectRoot, subjectSessions);
      set({ qcData: data, qcLoaded: true, qcLoading: false });
    } catch (err) {
      console.warn("[manifestStore] failed to load QC data", err);
      set({ qcData: null, qcLoaded: true, qcLoading: false });
    }
  },

  loadDataPar: async (projectRoot) => {
    const path = `${projectRoot}/derivatives/ExploreASL/dataPar.json`;
    try {
      if (await exists(path)) {
        const raw = await readTextFile(path);
        const parsed = JSON.parse(raw);
        set({ dataPar: parsed });
      } else {
        set({ dataPar: null });
      }
    } catch (err) {
      console.warn("[manifestStore] failed to load dataPar.json", err);
      set({ dataPar: null });
    }
  },
}));
