import { browser } from "@wdio/globals";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectFixture } from "../../../src/test/projectFixtures";

let scenarioRoot: string | undefined;

export const MANIFEST_DISAGREEMENTS_SCENARIO = "manifest-disagreements";
export const MANIFEST_DISAGREEMENTS_ROUTE =
  "/project/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest";

type BridgeDiagnostics = {
  available: boolean;
  currentRoute: string | null;
  currentScenario: string | null;
};

type BridgeCallResult = BridgeDiagnostics & {
  error?: string;
};

function bridgeAbsentError(): Error {
  return new Error(
    "E2E bridge is unavailable. Rebuild the Tauri app with VITE_E2E=1; E2E_APP_PATH must point to that build.",
  );
}

async function bridgeDiagnostics(): Promise<BridgeDiagnostics> {
  return browser.execute(() => {
    const bridge = (
      window as Window & {
        __E2E__?: { currentRoute: string | null; currentScenario: string | null };
      }
    ).__E2E__;

    return {
      available: Boolean(bridge),
      currentRoute: bridge?.currentRoute ?? null,
      currentScenario: bridge?.currentScenario ?? null,
    };
  });
}

async function callBridge(
  method: "ready" | "reset" | "seed" | "navigate",
  value?: string,
  easlPath?: string,
): Promise<BridgeCallResult> {
  return browser.execute(
    async ({ method, value, easlPath }) => {
      const bridge = (
        window as Window & {
          __E2E__?: {
            currentRoute: string | null;
            currentScenario: string | null;
            navigate(path: string): Promise<void>;
            ready(): Promise<void>;
            reset(): Promise<void>;
            seed(scenario: "manifest-disagreements", easlPath: string): Promise<void>;
          };
        }
      ).__E2E__;

      if (!bridge) {
        return {
          available: false,
          currentRoute: null,
          currentScenario: null,
          error: "bridge absent",
        };
      }

      try {
        if (method === "ready") await bridge.ready();
        if (method === "seed") await bridge.seed(value as "manifest-disagreements", easlPath!);
        if (method === "navigate") await bridge.navigate(value ?? "");
        if (method === "reset") await bridge.reset();
        return {
          available: true,
          currentRoute: bridge.currentRoute,
          currentScenario: bridge.currentScenario,
        };
      } catch (error) {
        return {
          available: true,
          currentRoute: bridge.currentRoute,
          currentScenario: bridge.currentScenario,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    { method, value, easlPath },
  );
}

async function assertBridgeCall(
  method: "ready" | "reset" | "seed" | "navigate",
  value?: string,
  easlPath?: string,
): Promise<void> {
  const result = await callBridge(method, value, easlPath);
  if (!result.available) throw bridgeAbsentError();
  if (result.error) {
    throw new Error(`E2E bridge ${method} failed: ${result.error}`);
  }
}

async function waitForRoute(route: string): Promise<void> {
  await browser.$('[data-testid="app-ready"]').waitForExist({ timeout: 15_000 });
  await browser.waitUntil(
    async () => {
      const diagnostics = await bridgeDiagnostics();
      return diagnostics.available && diagnostics.currentRoute === route;
    },
    {
      timeout: 15_000,
      interval: 100,
      timeoutMsg: `App did not report E2E route ${route} after bridge navigation.`,
    },
  );
}

async function waitForBridge(): Promise<void> {
  await browser.waitUntil(async () => (await bridgeDiagnostics()).available, {
    timeout: 15_000,
    interval: 100,
    timeoutMsg:
      "E2E bridge is unavailable. Rebuild the Tauri app with VITE_E2E=1; E2E_APP_PATH must point to that build.",
  });
}

export async function resetAndLoadScenario(
  scenario: "manifest-disagreements",
  route: string,
): Promise<void> {
  await resetToLanding();
  scenarioRoot = await mkdtemp(join(tmpdir(), "easl-e2e-"));
  const document = projectFixture(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "Manifest disagreements",
    scenarioRoot,
  ).document;
  document.projectMeta.currentPhase = "manifest";
  document.projectMeta.dataSource = "bids";
  document.mappingState = {
    sourceDataPath: ".",
    ingestionComplete: true,
    metadataGroups: [],
    subjectRows: [
      { id: "sub-01_01", subject: "sub-01", session: "01", groupId: "ungrouped" },
      { id: "sub-02_01", subject: "sub-02", session: "01", groupId: "ungrouped" },
      { id: "sub-03_01", subject: "sub-03", session: "01", groupId: "ungrouped" },
    ],
  };
  document.uiState.processing = {
    population: {
      completed: true,
      lastRun: { profileId: "33333333-3333-4333-8333-333333333333", Mtime: null },
    },
  };
  const manifest = document.uiState.manifest;
  const a = manifest.activeReviewerId;
  const b = "22222222-2222-4222-8222-222222222222";
  manifest.reviewers[0].label = "Reviewer A";
  manifest.reviewers.push({
    id: b,
    label: "Reviewer B",
    createdAt: document.projectMeta.createdAt,
  });
  manifest.verdicts = {
    [a]: {
      "sub-01_01": { status: "pass", setAt: 0 },
      "sub-02_01": { status: "fail", reason: "motion", setAt: 0 },
      "sub-03_01": { status: "pass", setAt: 0 },
    },
    [b]: {
      "sub-01_01": { status: "fail", reason: "motion", setAt: 0 },
      "sub-02_01": { status: "pass", setAt: 0 },
      "sub-03_01": { status: "pass", setAt: 0 },
    },
  };
  manifest.resolvedVerdicts = { "sub-01_01": { status: "pass", setAt: 0 } };
  const easlPath = join(scenarioRoot, "project.easl");
  await writeFile(easlPath, JSON.stringify(document));
  await assertBridgeCall("seed", scenario, easlPath);
  await assertBridgeCall("navigate", route);
  await assertBridgeCall("ready");
  await waitForRoute(route);
}

export async function resetToLanding(): Promise<void> {
  await waitForBridge();
  await assertBridgeCall("reset");
  await assertBridgeCall("ready");
  await waitForRoute("/");
  if (scenarioRoot) {
    await rm(scenarioRoot, { recursive: true, force: true });
    scenarioRoot = undefined;
  }
}
