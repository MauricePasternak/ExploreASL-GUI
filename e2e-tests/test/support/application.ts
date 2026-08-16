import { browser } from "@wdio/globals";

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
): Promise<BridgeCallResult> {
  return browser.execute(
    async ({ method, value }) => {
      const bridge = (
        window as Window & {
          __E2E__?: {
            currentRoute: string | null;
            currentScenario: string | null;
            navigate(path: string): Promise<void>;
            ready(): Promise<void>;
            reset(): Promise<void>;
            seed(scenario: "manifest-disagreements"): Promise<void>;
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
        if (method === "seed") await bridge.seed(value as "manifest-disagreements");
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
    { method, value },
  );
}

async function assertBridgeCall(
  method: "ready" | "reset" | "seed" | "navigate",
  value?: string,
): Promise<void> {
  const result = await callBridge(method, value);
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
  await waitForBridge();

  await assertBridgeCall("reset");
  await assertBridgeCall("ready");
  await waitForRoute("/");
  await assertBridgeCall("seed", scenario);
  await assertBridgeCall("navigate", route);
  await assertBridgeCall("ready");
  await waitForRoute(route);
}

export async function resetToLanding(): Promise<void> {
  await waitForBridge();
  await assertBridgeCall("reset");
  await assertBridgeCall("ready");
  await waitForRoute("/");
}
