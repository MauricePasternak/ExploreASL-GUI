import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createHashRouter, RouterProvider } from "react-router";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "mantine-datatable/styles.css";

import App from "./App";
import {
  captureSnapshot,
  copySnapshotToClipboard,
  getActionLog,
  initConsoleBridge,
  initDebugKeyboardShortcuts,
} from "./lib/debug";
import { useGlobalStore } from "./stores/globalStore";
import { useImportStore } from "./stores/importStore";
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
  () => useImportStore.getState(),
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
      () => useImportStore.getState(),
    );
    await copySnapshotToClipboard(snapshot);

    console.log("[DEBUG] Snapshot copied to clipboard");
    return snapshot;
  },
};

const router = createHashRouter([{ path: "*", element: <App /> }]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications />
      <RouterProvider router={router} />
    </MantineProvider>
  </React.StrictMode>,
);
