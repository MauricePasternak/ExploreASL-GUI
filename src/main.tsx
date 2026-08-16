import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { RouterProvider } from "react-router";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "mantine-datatable/styles.css";
import "./App.css";

import { createAppRouter } from "./app/router";
import { renderBootstrapError } from "./app/bootstrapError";
import type { E2EBridgeControl } from "./e2e/bridge";
import {
  captureSnapshot,
  copySnapshotToClipboard,
  getActionLog,
  initConsoleBridge,
  initDebugKeyboardShortcuts,
} from "./lib/debug";
import { compressSnapshot, decompressSnapshot } from "./lib/snapshotCompression";
import { useGlobalStore } from "./stores/globalStore";
import { useImportStore } from "./stores/importStore";
import { useDataParStore } from "./stores/dataParStore";
import { useProjectStore } from "./stores/projectStore";

const theme = createTheme({
  primaryColor: "teal",
  breakpoints: {
    xs: "30em",
    sm: "48em",
    md: "62em",
    lg: "75em",
    xl: "88em",
  },
  colors: {
    teal: [
      "#e3fafc",
      "#c5f6fa",
      "#99e9f2",
      "#66d9e8",
      "#3bc9db",
      "#15aabf",
      "#0c8599",
      "#0b7285",
      "#09677a",
      "#084e5b",
    ],
    red: [
      "#fff5f5",
      "#ffe3e3",
      "#ffc9c9",
      "#ffa8a8",
      "#ff8787",
      "#ff6b6b",
      "#fa5252",
      "#f03e3e",
      "#e03131",
      "#c92a2a",
    ],
    blue: [
      "#eef3ff",
      "#dbe4ff",
      "#bac8ff",
      "#91a7ff",
      "#748ffc",
      "#5c7cfa",
      "#4c6ef5",
      "#4263eb",
      "#3b5bdb",
      "#364fc7",
    ],
  },
});

// Initialize debug tooling before React mounts
initConsoleBridge();
initDebugKeyboardShortcuts(
  () => useGlobalStore.getState(),
  () => useProjectStore.getState(),
  () => useDataParStore.getState().dataPar,
);

// Expose debug utilities to window for devtools console access
// Usage: window.__DEBUG__.snapshot() → copies full state to clipboard
// Usage: window.__DEBUG__.stores.globalStore → current global store state
// Usage: window.__DEBUG__.log → recent action log
// Usage: window.__DEBUG__.route → current hash route
// Usage: window.__DEBUG__.compressSnapshot(obj) → gzip+base64 string for .easl
// Usage: window.__DEBUG__.decompressSnapshot(str) → full ImportSnapshot object
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
      () => useDataParStore.getState().dataPar,
    );
    await copySnapshotToClipboard(snapshot);

    console.log("[DEBUG] Snapshot copied to clipboard");
    return snapshot;
  },
  compressSnapshot,
  decompressSnapshot,
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
        <RouterProvider router={router} />
      </MantineProvider>
    </React.StrictMode>,
  );
}

async function bootstrap() {
  if (import.meta.env.VITE_E2E === "1") {
    const { installE2EBridge, isE2EScenario } = await import("./e2e/bridge");
    const e2eControl = installE2EBridge({ enabled: true, router });
    if (!e2eControl) {
      throw new Error("E2E bridge installation failed");
    }
    e2eControlRef.current = e2eControl;
    const scenario = new URLSearchParams(window.location.search).get("e2eScenario");
    if (scenario) {
      if (isE2EScenario(scenario)) {
        await e2eControl.bridge.seed(scenario);
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
