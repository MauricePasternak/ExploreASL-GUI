import { describe, expect, it, vi } from "vitest";

import {
  clearActionLog,
  getActionLog,
  logAction,
  type StoreSnapshot,
  captureSnapshot,
  copySnapshotToClipboard,
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
    const importStore = { activeStep: 2 };

    const snapshot = await captureSnapshot(
      () => globalStore,
      () => projectStore,
      () => importStore,
    );

    expect(snapshot.globalStore).toEqual(globalStore);
    expect(snapshot.projectStore).toEqual(projectStore);
    expect(snapshot.importStore).toEqual(importStore);
    expect(snapshot.route).toBeDefined();
    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.userAgent).toBeDefined();
  });
});

describe("copySnapshotToClipboard", () => {
  it("writes JSON snapshot to clipboard", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    const snapshot: StoreSnapshot = {
      timestamp: "2024-01-01T00:00:00.000Z",
      route: "#/project/123/import",
      globalStore: {},
      projectStore: {},
      importStore: {},
      actionLog: [],
      userAgent: "test",
    };

    await copySnapshotToClipboard(snapshot);

    expect(writeText).toHaveBeenCalledOnce();
    const written = writeText.mock.calls[0][0] as string;
    expect(JSON.parse(written)).toEqual(snapshot);
  });
});
