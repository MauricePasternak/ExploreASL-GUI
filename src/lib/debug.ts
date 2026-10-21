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
    writeLog(info, args);
  };

  console.info = (...args: unknown[]) => {
    original.info(...args);
    writeLog(info, args);
  };

  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    writeLog(warn, args);
  };

  console.error = (...args: unknown[]) => {
    original.error(...args);
    writeLog(error, args);
  };

  console.debug = (...args: unknown[]) => {
    original.debug(...args);
    writeLog(debug, args);
  };

  // Also capture unhandled errors and promise rejections
  window.addEventListener("error", (event) => {
    writeLog(error, [
      `[window.onerror] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
      event.error,
    ]);
  });

  window.addEventListener("unhandledrejection", (event) => {
    writeLog(error, ["[unhandledrejection]", event.reason]);
  });
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  try {
    const seen = new WeakSet<object>();
    return (
      JSON.stringify(arg, (_key, value: unknown) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
              ...("cause" in value ? { cause: value.cause } : {}),
            };
          }
          if (value instanceof Map) return { type: "Map", entries: [...value] };
          if (value instanceof Set) return { type: "Set", values: [...value] };
        }
        if (
          value === undefined ||
          typeof value === "bigint" ||
          typeof value === "symbol" ||
          typeof value === "function" ||
          (typeof value === "number" && !Number.isFinite(value))
        ) {
          return String(value);
        }
        return value;
      }) ?? "undefined"
    );
  } catch {
    try {
      return String(arg);
    } catch {
      return "[Unserializable]";
    }
  }
}

function writeLog(logger: (message: string) => Promise<void>, args: unknown[]) {
  try {
    void logger(args.map(formatArg).join(" ")).catch(() => undefined);
  } catch {
    // Console output remains available if serialization or the native logger fails.
  }
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
const ACTION_SUMMARY_KEYS = [
  "pathCount",
  "patternCount",
  "groupCount",
  "subjectCount",
  "aslSubjectCount",
  "aslSessionCount",
  "totalSubjectCount",
  "retryCount",
  "step",
  "bMatchDirectories",
] as const;

function summarizeAction(payload: unknown) {
  const summary: Record<string, number | boolean> = {};
  if (typeof payload !== "object" || payload === null) return summary;
  try {
    for (const key of ACTION_SUMMARY_KEYS) {
      // Read data properties only; diagnostics must not invoke payload getters.
      const value: unknown = Object.getOwnPropertyDescriptor(payload, key)?.value;
      if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
        summary[key] = value;
      }
    }
  } catch {
    // Revoked/hostile proxies need not prevent recording the action type.
  }
  return summary;
}

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
  const summary = summarizeAction(payload);
  writeLog(info, [`[ACTION] ${type}`, ...(Object.keys(summary).length ? [summary] : [])]);
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
  runtime?: unknown;
}

export async function captureSnapshot(
  getGlobalStore: () => unknown,
  getProjectStore: () => unknown,
  getDataParState: () => DataParState,
  getRuntimeDiagnostics?: () => unknown,
): Promise<StoreSnapshot> {
  return {
    timestamp: new Date().toISOString(),
    route: window.location.hash,
    globalStore: getGlobalStore(),
    projectStore: getProjectStore(),
    dataParJson: assembleDataPar(getDataParState()),
    actionLog: getActionLog(),
    userAgent: navigator.userAgent,
    ...(getRuntimeDiagnostics ? { runtime: getRuntimeDiagnostics() } : {}),
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
  getRuntimeDiagnostics?: () => unknown,
) {
  window.addEventListener("keydown", async (event) => {
    if (event.ctrlKey && event.shiftKey && event.key === "D") {
      event.preventDefault();
      const snapshot = await captureSnapshot(
        getGlobalStore,
        getProjectStore,
        getDataParState,
        getRuntimeDiagnostics,
      );
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
