/**
 * Debug utilities for the ExploreASL GUI frontend.
 *
 * - Console bridge: forwards console.* to Tauri log plugin
 * - Action replay log: time-stamped log of user actions
 * - Store snapshot: Ctrl+Shift+D copies full app state to clipboard
 */

import { debug, info, warn, error } from "@tauri-apps/plugin-log";
import { notifications } from "@mantine/notifications";

import { assembleDataPar, type DataParJson } from "./assembleDataPar";
import type { DataParState } from "../schemas/dataParSchema";

// =============================================================================
// Console Bridge
// =============================================================================

let bridgeInitialized = false;

export function initConsoleBridge() {
  if (bridgeInitialized) return;
  bridgeInitialized = true;

  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  console.log = (...args: unknown[]) => {
    original.log(...args);
    void info(formatArgs(args)).catch(() => undefined);
  };

  console.info = (...args: unknown[]) => {
    original.info(...args);
    void info(formatArgs(args)).catch(() => undefined);
  };

  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    void warn(formatArgs(args)).catch(() => undefined);
  };

  console.error = (...args: unknown[]) => {
    original.error(...args);
    void error(formatArgs(args)).catch(() => undefined);
  };

  console.debug = (...args: unknown[]) => {
    original.debug(...args);
    void debug(formatArgs(args)).catch(() => undefined);
  };

  // Also capture unhandled errors and promise rejections
  window.addEventListener("error", (event) => {
    void error(`[window.onerror] ${event.message} at ${event.filename}:${event.lineno}`).catch(
      () => undefined,
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    void error(`[unhandledrejection] ${String(event.reason)}`).catch(() => undefined);
  });
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

// =============================================================================
// Action Replay Log
// =============================================================================

export interface ActionEntry {
  timestamp: string;
  type: string;
  payload: unknown;
}

const actionLog: ActionEntry[] = [];
const MAX_ACTION_LOG_SIZE = 500;

export function logAction(type: string, payload?: unknown) {
  const entry: ActionEntry = {
    timestamp: new Date().toISOString(),
    type,
    payload: payload ?? null,
  };
  actionLog.push(entry);
  if (actionLog.length > MAX_ACTION_LOG_SIZE) {
    actionLog.shift();
  }
  void debug(`[ACTION] ${type}`).catch(() => undefined);
}

export function getActionLog(): ActionEntry[] {
  return [...actionLog];
}

export function clearActionLog() {
  actionLog.length = 0;
}

// =============================================================================
// Store Snapshot
// =============================================================================

export interface StoreSnapshot {
  timestamp: string;
  route: string;
  globalStore: unknown;
  projectStore: unknown;
  dataParJson: DataParJson;
  actionLog: ActionEntry[];
  userAgent: string;
}

export async function captureSnapshot(
  getGlobalStore: () => unknown,
  getProjectStore: () => unknown,
  getDataParState: () => DataParState,
): Promise<StoreSnapshot> {
  return {
    timestamp: new Date().toISOString(),
    route: window.location.hash,
    globalStore: getGlobalStore(),
    projectStore: getProjectStore(),
    dataParJson: assembleDataPar(getDataParState()),
    actionLog: getActionLog(),
    userAgent: navigator.userAgent,
  };
}

export async function copySnapshotToClipboard(snapshot: StoreSnapshot): Promise<void> {
  const text = JSON.stringify(snapshot, null, 2);
  await navigator.clipboard.writeText(text);
}

export function initDebugKeyboardShortcuts(
  getGlobalStore: () => unknown,
  getProjectStore: () => unknown,
  getDataParState: () => DataParState,
) {
  window.addEventListener("keydown", async (event) => {
    if (event.ctrlKey && event.shiftKey && event.key === "D") {
      event.preventDefault();
      const snapshot = await captureSnapshot(getGlobalStore, getProjectStore, getDataParState);
      await copySnapshotToClipboard(snapshot);
      void info("[DEBUG] Store snapshot copied to clipboard (Ctrl+Shift+D)").catch(() => undefined);

      console.log("[DEBUG] Store snapshot copied to clipboard");
      notifications.show({
        color: "teal",
        title: "Snapshot Copied",
        message: "Application state snapshot has been copied to your clipboard (Ctrl+Shift+D).",
      });
    }
  });
}
