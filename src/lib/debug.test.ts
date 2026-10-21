import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { error, info } from "@tauri-apps/plugin-log";

import {
  clearActionLog,
  getActionLog,
  logAction,
  type StoreSnapshot,
  captureSnapshot,
  copySnapshotToClipboard,
  initDebugKeyboardShortcuts,
  initConsoleBridge,
} from "./debug";

vi.mock("@tauri-apps/plugin-log", () => ({
  trace: vi.fn(() => Promise.resolve()),
  debug: vi.fn(() => Promise.resolve()),
  info: vi.fn(() => Promise.resolve()),
  warn: vi.fn(() => Promise.resolve()),
  error: vi.fn(() => Promise.resolve()),
}));

describe("initConsoleBridge", () => {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const fallback = vi.fn();
  const handlers: Record<string, EventListener> = {};

  beforeAll(() => {
    Object.assign(console, {
      log: fallback,
      info: fallback,
      warn: fallback,
      error: fallback,
      debug: fallback,
    });
    // Invoke handlers directly so Vitest does not treat intentional errors as unhandled.
    const listen = vi.spyOn(window, "addEventListener").mockImplementation((type, listener) => {
      handlers[type] = listener as EventListener;
    });
    initConsoleBridge();
    initConsoleBridge();
    expect(listen).toHaveBeenCalledTimes(2);
    listen.mockRestore();
  });

  afterAll(() => {
    Object.assign(console, original);
  });

  it("preserves error name, message, stack and nested cause across all error sources", () => {
    const cause = new Error("worker failed");
    const failure = Object.assign(new TypeError("launch failed"), { cause });
    console.error(failure);
    expect(JSON.parse(vi.mocked(error).mock.lastCall![0])).toEqual({
      name: failure.name,
      message: failure.message,
      stack: failure.stack,
      cause: { name: cause.name, message: cause.message, stack: cause.stack },
    });
    expect(fallback).toHaveBeenCalledWith(failure);

    handlers.error!(new ErrorEvent("error", { error: failure, message: failure.message }));
    expect(vi.mocked(error).mock.lastCall![0]).toContain("[window.onerror]");
    expect(vi.mocked(error).mock.lastCall![0]).toContain(JSON.stringify(failure.stack));
    expect(vi.mocked(error).mock.lastCall![0]).toContain(JSON.stringify(cause.stack));

    handlers.unhandledrejection!(
      Object.assign(new Event("unhandledrejection"), { reason: failure }),
    );
    expect(vi.mocked(error).mock.lastCall![0]).toContain("[unhandledrejection]");
    expect(vi.mocked(error).mock.lastCall![0]).toContain(JSON.stringify(failure.stack));
    expect(vi.mocked(error).mock.lastCall![0]).toContain(JSON.stringify(cause.stack));
  });

  it("handles circular and non-JSON values, including objects that cannot stringify", () => {
    const value: Record<string, unknown> = {
      bigint: 1n,
      symbol: Symbol("flag"),
      missing: undefined,
      callback: () => {},
      nonfinite: Infinity,
      map: new Map([["flag", true]]),
      set: new Set([1]),
    };
    value.self = value;
    value.failure = Object.assign(new Error("cycle"), { cause: value });
    expect(() => console.log(value)).not.toThrow();
    expect(JSON.parse(vi.mocked(info).mock.lastCall![0])).toMatchObject({
      bigint: "1",
      symbol: "Symbol(flag)",
      missing: "undefined",
      callback: expect.any(String),
      nonfinite: "Infinity",
      map: { type: "Map", entries: [["flag", true]] },
      set: { type: "Set", values: [1] },
      self: "[Circular]",
      failure: { name: "Error", message: "cycle", cause: "[Circular]" },
    });

    const hostile = {
      toJSON() {
        throw new Error("cannot serialize");
      },
      toString() {
        throw new Error("cannot coerce");
      },
    };
    expect(() => console.log(hostile)).not.toThrow();
    expect(info).toHaveBeenLastCalledWith("[Unserializable]");
  });

  it("keeps original console output when native logging throws or rejects", async () => {
    vi.mocked(info).mockImplementationOnce(() => {
      throw new Error("native unavailable");
    });
    expect(() => console.info("sync fallback")).not.toThrow();
    vi.mocked(info).mockRejectedValueOnce(new Error("native rejected"));
    expect(() => console.log("async fallback")).not.toThrow();
    await Promise.resolve();
    expect(fallback).toHaveBeenCalledWith("sync fallback");
    expect(fallback).toHaveBeenCalledWith("async fallback");
  });
});

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

  it("logs only allowlisted counts and flags at info without reading getters or study metadata", () => {
    const getter = vi.fn(() => {
      throw new Error("must not read");
    });
    const payload = {
      pathCount: 4,
      step: 2,
      bMatchDirectories: false,
      path: "/private/study",
      name: "private name",
      error: "private text",
      age: 42,
      fieldStrength: 3,
      subjectCount: "private subject",
      retryCount: Infinity,
    };
    Object.defineProperty(payload, "groupCount", { get: getter });
    logAction("dicom_scan", payload);
    expect(info).toHaveBeenLastCalledWith(
      '[ACTION] dicom_scan {"pathCount":4,"step":2,"bMatchDirectories":false}',
    );
    expect(getter).not.toHaveBeenCalled();
    expect(getActionLog().slice(-1)[0]?.payload).toBe(payload);
    clearActionLog();
  });
});

describe("captureSnapshot", () => {
  it("returns a snapshot with all stores and metadata", async () => {
    const globalStore = { theme: "dark" };
    const projectStore = { project: null };
    const dataParState = { Atlases: ["Total"], TissueMasking: ["GM"], TissueThreshold: [0.7] };

    const snapshot = await captureSnapshot(
      () => globalStore,
      () => projectStore,
      () => dataParState,
    );

    expect(snapshot.globalStore).toEqual(globalStore);
    expect(snapshot.projectStore).toEqual(projectStore);
    expect(snapshot.dataParJson).toEqual({
      x: { S: { Atlases: ["Total"], TissueMasking: ["GM"], TissueThreshold: [0.7] } },
    });
    expect(snapshot.route).toBeDefined();
    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.userAgent).toBeDefined();
    expect(snapshot.runtime).toBeUndefined();
  });

  it("includes optional selected runtime diagnostics", async () => {
    const runtime = {
      import: { activeRunId: "import-1", ownershipGeneration: 2, lifecycle: "running" },
      processing: { revision: 3, availableAction: "confirmStopped", error: "worker failed" },
    };
    const snapshot = await captureSnapshot(
      () => ({}),
      () => ({}),
      () => ({}),
      () => runtime,
    );
    expect(snapshot.runtime).toEqual(runtime);
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
      dataParJson: { x: {} },
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
    const dataParState = {};
    const runtime = { processing: { activeRunId: "run-1", lifecycle: "running", revision: 2 } };
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    initDebugKeyboardShortcuts(
      () => globalStore,
      () => projectStore,
      () => dataParState,
      () => runtime,
    );

    const event = new KeyboardEvent("keydown", {
      key: "D",
      ctrlKey: true,
      shiftKey: true,
    });
    window.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(writeText).toHaveBeenCalledOnce();
    expect(JSON.parse(writeText.mock.calls[0]![0]).runtime).toEqual(runtime);
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Snapshot Copied",
        color: "teal",
      }),
    );
  });
});
