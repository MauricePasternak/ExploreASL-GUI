import React from "react";
import ReactDOM from "react-dom/client";
import { installE2EBridge, isE2EScenario } from "./e2e/bridge";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { RouterProvider } from "react-router";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "mantine-datatable/styles.css";
import "./App.css";

import { createAppRouter } from "./app/router";
import { renderBootstrapError } from "./app/bootstrapError";
import { theme } from "./app/theme";
import ErrorDetailsModal from "./components/common/ErrorDetailsModal";
import type { E2EBridgeControl } from "./e2e/bridge";
import {
  captureSnapshot,
  copySnapshotToClipboard,
  getActionLog,
  initConsoleBridge,
  initDebugKeyboardShortcuts,
} from "./lib/debug";
import { useGlobalStore } from "./stores/globalStore";
import { useImportStore } from "./stores/importStore";
import { acceptedDataPar, useDataParStore } from "./stores/dataParStore";
import { useProjectStore } from "./stores/projectStore";
import { useProcessingStore } from "./stores/processingStore";

// Select runtime diagnostics explicitly: never copy study data, config, or raw worker output.
function getRuntimeDiagnostics() {
  const importing = useImportStore.getState();
  const processing = useProcessingStore.getState();
  const snapshot = processing.snapshot;
  return {
    import: {
      activeRunId: importing.activeRunId,
      terminalRunId: importing.terminalRunId,
      lifecycle: importing.importPhase,
      ownershipGeneration: importing.ownershipGeneration,
      nativeSnapshotUpdatedAtMs: importing.nativeSnapshotUpdatedAtMs,
      running: importing.importRunning,
      completed: importing.importCompleted,
      confirmationRequired: importing.confirmationRequired,
      confirmingStoppedRunId: importing.confirmingStoppedRunId,
      confirmingStoppedGeneration: importing.confirmingStoppedGeneration,
      error: importing.importRunError,
      profileError: importing.profileError,
    },
    processing: {
      activeRunId: processing.activeRunId,
      terminalRunId: processing.terminalRunId,
      lifecycle: processing.processingPhase,
      attachmentGeneration: processing.attachmentGeneration,
      revision: snapshot?.revision ?? null,
      terminalRevision: snapshot?.terminalRevision ?? null,
      availableAction: processing.availableAction,
      actionPending: processing.actionPending,
      error: processing.processingError,
      profileError: processing.profileError,
      bidsCompatibilityError: processing.bidsCompatibilityError,
      nativeError: snapshot?.error ?? null,
      workerCount: snapshot?.workerCount ?? null,
      logicalExits:
        snapshot?.logicalExits.map(({ workerId, exitCode }) => ({ workerId, exitCode })) ?? [],
      executionCommitted: snapshot?.executionCommitted ?? false,
    },
  };
}

// Initialize debug tooling before React mounts
initConsoleBridge();
initDebugKeyboardShortcuts(
  () => useGlobalStore.getState(),
  () => useProjectStore.getState(),
  acceptedDataPar,
  getRuntimeDiagnostics,
);

// Expose debug utilities to window for devtools console access
// Usage: window.__DEBUG__.snapshot() → copies full state to clipboard
// Usage: window.__DEBUG__.stores.globalStore → current global store state
// Usage: window.__DEBUG__.log → recent action log
// Usage: window.__DEBUG__.route → current hash route
// @ts-expect-error -- intentional global for debugging
window.__DEBUG__ = {
  get stores() {
    return {
      globalStore: useGlobalStore.getState(),
      projectStore: useProjectStore.getState(),
      importStore: useImportStore.getState(),
      dataParStore: useDataParStore.getState(),
    };
  },
  get log() {
    return getActionLog();
  },
  get route() {
    return window.location.hash;
  },
  async snapshot() {
    const snapshot = await captureSnapshot(
      () => useGlobalStore.getState(),
      () => useProjectStore.getState(),
      acceptedDataPar,
      getRuntimeDiagnostics,
    );
    await copySnapshotToClipboard(snapshot);

    console.log("[DEBUG] Snapshot copied to clipboard");
    return snapshot;
  },
};

const e2eControlRef: { current: E2EBridgeControl | undefined } = { current: undefined };
const router = createAppRouter(
  import.meta.env.VITE_E2E === "1"
    ? {
        e2e: {
          enabled: true,
          onReady: (location) => e2eControlRef.current?.onAppReady(location),
        },
      }
    : undefined,
);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing root element");
const root: HTMLElement = rootElement;

function renderApp() {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications />
        <ErrorDetailsModal />
        <RouterProvider router={router} />
      </MantineProvider>
    </React.StrictMode>,
  );
}

async function bootstrap() {
  if (import.meta.env.VITE_E2E === "1") {
    const e2eControl = installE2EBridge({ enabled: true, router });
    if (!e2eControl) {
      throw new Error("E2E bridge installation failed");
    }
    e2eControlRef.current = e2eControl;
    const scenario = new URLSearchParams(window.location.search).get("e2eScenario");
    if (scenario) {
      if (isE2EScenario(scenario)) {
        const easlPath = new URLSearchParams(window.location.search).get("easlPath");
        if (!easlPath) throw new Error("E2E scenario requires easlPath for native activation.");
        await e2eControl.bridge.seed(scenario, easlPath);
      } else {
        console.error(`[E2E] Unsupported e2eScenario: ${scenario}`);
      }
    }
  }
  renderApp();
}

void bootstrap().catch((error: unknown) => {
  renderBootstrapError(root, error);
});
