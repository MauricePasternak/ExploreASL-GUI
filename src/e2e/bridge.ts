import type { Location } from "react-router";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { ProjectFileSchema, type ProjectFile } from "../schemas/project";
import { useDataParStore } from "../stores/dataParStore";
import { useGlobalStore } from "../stores/globalStore";
import { useImportStore } from "../stores/importStore";
import { deriveDisagreements, useManifestStore } from "../stores/manifestStore";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import { useVisualizationStore } from "../stores/visualizationStore";

const REVIEWER_A_ID = "11111111-1111-4111-8111-111111111111";
const REVIEWER_B_ID = "22222222-2222-4222-8222-222222222222";
const E2E_TIMESTAMP = "2026-01-01T00:00:00.000Z";

export const E2E_SCENARIOS = ["manifest-disagreements"] as const;
export type E2EScenario = (typeof E2E_SCENARIOS)[number];

type RouterController = {
  navigate: (path: string) => Promise<unknown> | void;
};

export interface E2EBridge {
  ready(): Promise<void>;
  navigate(path: string): Promise<void>;
  seed(scenario: E2EScenario): Promise<void>;
  reset(): Promise<void>;
  readonly currentRoute: string | null;
  readonly currentScenario: E2EScenario | null;
}

export interface E2EBridgeControl {
  bridge: E2EBridge;
  onAppReady(location: Location): void;
}

export interface E2EBridgeOptions {
  enabled: boolean;
  router: RouterController;
}

export function isE2EEnabled(env: Pick<ImportMetaEnv, "VITE_E2E"> = import.meta.env): boolean {
  return env.VITE_E2E === "1";
}

export function isE2EScenario(value: string): value is E2EScenario {
  return E2E_SCENARIOS.some((scenario) => scenario === value);
}

function manifestDisagreementsProject(): ProjectFile {
  return ProjectFileSchema.parse({
    version: "0.1.0",
    projectMeta: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Manifest disagreements",
      rootPath: "",
      createdAt: E2E_TIMESTAMP,
      lastOpened: E2E_TIMESTAMP,
      currentPhase: "manifest",
      dataSource: "bids",
    },
    uiState: {
      processing: {
        population: {
          completed: true,
          lastRun: {
            profileId: "33333333-3333-4333-8333-333333333333",
            Mtime: null,
          },
        },
      },
      manifest: {
        reviewers: [
          { id: REVIEWER_A_ID, label: "Reviewer A", createdAt: E2E_TIMESTAMP },
          { id: REVIEWER_B_ID, label: "Reviewer B", createdAt: E2E_TIMESTAMP },
        ],
        activeReviewerId: REVIEWER_A_ID,
        verdicts: {
          [REVIEWER_A_ID]: {
            "sub-01_01": { status: "pass", setAt: 0 },
            "sub-02_01": { status: "fail", reason: "motion", setAt: 0 },
            "sub-03_01": { status: "pass", setAt: 0 },
          },
          [REVIEWER_B_ID]: {
            "sub-01_01": { status: "fail", reason: "motion", setAt: 0 },
            "sub-02_01": { status: "pass", setAt: 0 },
            "sub-03_01": { status: "pass", setAt: 0 },
          },
        },
        resolvedVerdicts: {
          "sub-01_01": { status: "pass", setAt: 0 },
        },
      },
    },
    mappingState: {
      sourceDataPath: "",
      ingestionComplete: true,
      metadataGroups: [],
      subjectRows: [
        { id: "sub-01_01", subject: "sub-01", session: "01", groupId: "ungrouped" },
        { id: "sub-02_01", subject: "sub-02", session: "01", groupId: "ungrouped" },
        { id: "sub-03_01", subject: "sub-03", session: "01", groupId: "ungrouped" },
      ],
    },
    dataPar: {},
  });
}

async function seedManifestDisagreements() {
  const project = manifestDisagreementsProject();
  const manifest = project.uiState.manifest;
  const disagreements = deriveDisagreements(manifest);

  // `loaded` is the render gate. Set it last so App never observes partial fixture state.
  useGlobalStore.setState({
    settings: DEFAULT_SETTINGS,
    loaded: false,
    profileValidationState: {},
  });
  useImportStore.getState().resetImport();
  useDataParStore.getState().resetDataPar();
  await useProcessingStore.getState().resetProcessing();
  useVisualizationStore.getState().reset();
  useManifestStore.getState().resetManifest();
  useProjectStore.setState({ project, isDirty: false, loaded: true });
  useProcessingStore.setState({
    processingPhase: "completed",
    config: null,
    availableSubjects: [
      {
        subjectSession: "sub-01_01",
        subject: "sub-01",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: ["1"],
      },
      {
        subjectSession: "sub-02_01",
        subject: "sub-02",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: ["1"],
      },
      {
        subjectSession: "sub-03_01",
        subject: "sub-03",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: ["1"],
      },
    ],
    subjectStatuses: [],
    workerPids: [],
    pendingRawdataWarning: null,
    profileError: null,
    preparingMessage: null,
  });
  useManifestStore.setState({
    step: 1,
    filter: "all",
    reviewerMode: "multi",
    disagreements,
    agreementResults: null,
    staleVerdicts: {
      [REVIEWER_A_ID]: new Set(),
      [REVIEWER_B_ID]: new Set(),
    },
    priorModulesMtimes: {
      "sub-01_01": null,
      "sub-02_01": null,
      "sub-03_01": null,
    },
    qcData: {
      "sub-01_01": { coverage: 0.99, spatialCov: 0.95, motion: [0.1], motionExclusionPct: 0 },
      "sub-02_01": { coverage: 0.9, spatialCov: 0.82, motion: [1.2], motionExclusionPct: 10 },
      "sub-03_01": { coverage: 0.98, spatialCov: 0.96, motion: [0.08], motionExclusionPct: 0 },
    },
    qcLoaded: true,
    qcLoading: false,
    dataPar: {},
  });
  useGlobalStore.setState({ loaded: true });
}

async function resetStores() {
  useGlobalStore.setState({ loaded: false });
  useImportStore.getState().resetImport();
  useDataParStore.getState().resetDataPar();
  await useProcessingStore.getState().resetProcessing();
  useVisualizationStore.getState().reset();
  useManifestStore.getState().resetManifest();
  useProjectStore.getState().closeProject();
  useGlobalStore.setState({
    settings: DEFAULT_SETTINGS,
    loaded: true,
    profileValidationState: {},
  });
}

export function installE2EBridge(options: E2EBridgeOptions): E2EBridgeControl | undefined {
  if (!options.enabled) return undefined;

  useGlobalStore.setState({
    settings: DEFAULT_SETTINGS,
    loaded: true,
    profileValidationState: {},
  });

  let currentRoute: string | null = null;
  let currentScenario: E2EScenario | null = null;
  let readyResolver: (() => void) | null = null;
  let expectedRoute: string | null = null;
  let resetting = false;
  let readyPromise = new Promise<void>((resolve) => {
    readyResolver = resolve;
  });

  const beginReadinessCycle = (route: string) => {
    expectedRoute = route;
    readyPromise = new Promise<void>((resolve) => {
      readyResolver = resolve;
    });
  };

  const resolveReady = () => {
    readyResolver?.();
    readyResolver = null;
    expectedRoute = null;
  };

  const bridge: E2EBridge = {
    ready: () => readyPromise,
    navigate: async (path) => {
      beginReadinessCycle(path);
      await options.router.navigate(path);
      // React does not re-run location effects for a same-route navigation.
      // The existing render already proves this route is ready in that case.
      if (currentRoute === path) resolveReady();
    },
    seed: async (scenario) => {
      if (scenario !== "manifest-disagreements") {
        throw new Error(`Unknown E2E scenario: ${scenario}`);
      }
      await seedManifestDisagreements();
      currentScenario = scenario;
    },
    reset: async () => {
      beginReadinessCycle("/");
      currentScenario = null;
      resetting = true;
      try {
        await resetStores();
        await options.router.navigate("/");
        // Preserve the known route until a changed route reports via App. This
        // also completes reset when the router is already at the landing route.
        if (currentRoute === "/") resolveReady();
      } finally {
        resetting = false;
      }
    },
    get currentRoute() {
      return currentRoute;
    },
    get currentScenario() {
      return currentScenario;
    },
  };

  const control: E2EBridgeControl = {
    bridge,
    onAppReady: (location) => {
      currentRoute = `${location.pathname}${location.search}${location.hash}`;
      if (!resetting && (expectedRoute === null || currentRoute === expectedRoute)) {
        resolveReady();
      }
    },
  };
  window.__E2E__ = bridge;
  return control;
}
