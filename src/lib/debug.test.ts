import { describe, expect, it, vi } from "vitest";

import {
  clearActionLog,
  getActionLog,
  logAction,
  type StoreSnapshot,
  captureSnapshot,
  copySnapshotToClipboard,
  initDebugKeyboardShortcuts,
} from "./debug";

vi.mock("@tauri-apps/plugin-log", () => ({
  trace: vi.fn(() => Promise.resolve()),
  debug: vi.fn(() => Promise.resolve()),
  info: vi.fn(() => Promise.resolve()),
  warn: vi.fn(() => Promise.resolve()),
  error: vi.fn(() => Promise.resolve()),
}));

describe("logAction", () => {
  it("records an action with timestamp and type", () => {
    clearActionLog();
    logAction("test_action", { key: "value" });

    const log = getActionLog();
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe("test_action");
    expect(log[0].payload).toEqual({ key: "value" });
    expect(typeof log[0].timestamp).toBe("string");
  });

  it("defaults payload to null when omitted", () => {
    clearActionLog();
    logAction("simple_action");

    const log = getActionLog();
    expect(log[0].payload).toBeNull();
  });

  it("trims the log when it exceeds 500 entries", () => {
    clearActionLog();
    for (let i = 0; i < 510; i++) {
      logAction(`action_${i}`);
    }

    const log = getActionLog();
    expect(log).toHaveLength(500);
    expect(log[0].type).toBe("action_10");
    expect(log[499].type).toBe("action_509");
  });
});

describe("captureSnapshot", () => {
  it("returns a snapshot with all stores and metadata", async () => {
    const globalStore = { theme: "dark" };
    const projectStore = { project: null };

    const snapshot = await captureSnapshot(
      () => globalStore,
      () => projectStore,
    );

    expect(snapshot.globalStore).toEqual(globalStore);
    expect(snapshot.projectStore).toEqual(projectStore);
    expect(snapshot.route).toBeDefined();
    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.userAgent).toBeDefined();
  });
});

describe("copySnapshotToClipboard", () => {
  it("writes JSON snapshot to clipboard", async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    const snapshot: StoreSnapshot = {
      timestamp: "2024-01-01T00:00:00.000Z",
      route: "#/project/123/import",
      globalStore: {},
      projectStore: {},
      actionLog: [],
      userAgent: "test",
    };

    await copySnapshotToClipboard(snapshot);

    expect(writeText).toHaveBeenCalledOnce();
    const written = writeText.mock.calls[0]![0] as string;
    expect(JSON.parse(written)).toEqual(snapshot);
  });
});

describe("initDebugKeyboardShortcuts", () => {
  it("listens to Ctrl+Shift+D, copies snapshot, and shows a notification", async () => {
    const { notifications } = await import("@mantine/notifications");
    const globalStore = { theme: "dark" };
    const projectStore = { project: null };
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    initDebugKeyboardShortcuts(
      () => globalStore,
      () => projectStore,
    );

    const event = new KeyboardEvent("keydown", {
      key: "D",
      ctrlKey: true,
      shiftKey: true,
    });
    window.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(writeText).toHaveBeenCalledOnce();
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Snapshot Copied",
        color: "teal",
      }),
    );
  });
});
