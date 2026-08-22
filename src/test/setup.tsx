import { afterEach, vi } from "vitest";

// Wrap global/window timers to track and clean them up after each test.
// This prevents React 19 scheduler and Mantine transitions from triggering
// asynchronous callbacks after the JSDOM window object has been torn down.
const activeTimeouts = new Set<any>();
const activeIntervals = new Set<any>();
const activeRays = new Set<any>();

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

globalThis.setTimeout = function (cb: (...args: any[]) => void, delay?: number, ...args: any[]) {
  let timerId: any = null;
  const wrappedCb = (...callbackArgs: any[]) => {
    activeTimeouts.delete(timerId);
    cb(...callbackArgs);
  };
  timerId = originalSetTimeout(wrappedCb, delay, ...args);
  activeTimeouts.add(timerId);
  return timerId;
} as any;

globalThis.clearTimeout = function (timerId: any) {
  activeTimeouts.delete(timerId);
  return originalClearTimeout(timerId);
} as any;

globalThis.setInterval = function (cb: (...args: any[]) => void, delay?: number, ...args: any[]) {
  const timerId = originalSetInterval(cb, delay, ...args);
  activeIntervals.add(timerId);
  return timerId;
} as any;

globalThis.clearInterval = function (timerId: any) {
  activeIntervals.delete(timerId);
  return originalClearInterval(timerId);
} as any;

const originalRaf = typeof window !== "undefined" ? window.requestAnimationFrame : undefined;
const originalCaf = typeof window !== "undefined" ? window.cancelAnimationFrame : undefined;

if (originalRaf && originalCaf) {
  const wrapRaf = (raf: typeof originalRaf) => {
    return function (cb: FrameRequestCallback) {
      let rayId: any = null;
      const wrappedCb = (time: number) => {
        activeRays.delete(rayId);
        cb(time);
      };
      rayId = raf(wrappedCb);
      activeRays.add(rayId);
      return rayId;
    };
  };

  const wrapCaf = (caf: typeof originalCaf) => {
    return function (rayId: any) {
      activeRays.delete(rayId);
      return caf(rayId);
    };
  };

  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame = wrapRaf(globalThis.requestAnimationFrame);
  }
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame = wrapCaf(globalThis.cancelAnimationFrame);
  }
  if (typeof window !== "undefined") {
    window.requestAnimationFrame = wrapRaf(originalRaf);
    window.cancelAnimationFrame = wrapCaf(originalCaf);
  }
}

if (typeof window !== "undefined") {
  window.setTimeout = globalThis.setTimeout;
  window.clearTimeout = globalThis.clearTimeout;
  window.setInterval = globalThis.setInterval;
  window.clearInterval = globalThis.clearInterval;
}

afterEach(() => {
  activeTimeouts.forEach((timerId) => originalClearTimeout(timerId));
  activeTimeouts.clear();
  activeIntervals.forEach((timerId) => originalClearInterval(timerId));
  activeIntervals.clear();
  if (originalCaf) {
    activeRays.forEach((rayId) => originalCaf(rayId));
    activeRays.clear();
  }
});

import "@testing-library/jest-dom/vitest";
import "mantine-datatable/styles.css";

// ResizeObserver polyfill for mantine-datatable — must invoke the callback so rows render in jsdom
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
class ResizeObserverMock {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: {
            width: 800,
            height: 600,
            top: 0,
            left: 0,
            bottom: 600,
            right: 800,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
          borderBoxSize: [{ inlineSize: 800, blockSize: 600 }],
          contentBoxSize: [{ inlineSize: 800, blockSize: 600 }],
          devicePixelContentBoxSize: [],
        } as ResizeObserverEntry,
      ],
      this,
    );
  }

  unobserve() {}
  disconnect() {}
}
(window as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverMock;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock Tauri APIs that are unavailable in jsdom test environment
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, _args?: Record<string, unknown>) => {
    switch (cmd) {
      case "walk_directory":
        return Promise.resolve([]);
      case "create_symlink_tree":
        return Promise.resolve(null);
      case "which_matlab":
        return Promise.resolve([]);
      case "which_apptainer":
        return Promise.resolve([]);
      case "is_writable":
        return Promise.resolve(true);
      case "run_import_pipeline":
        return Promise.resolve(12345);
      case "stop_import":
      case "stop_active_import":
      case "clean_import_status":
      case "move_import_output":
      case "copy_lock_files":
      case "validate_all_execution_profiles":
      case "read_import_status":
      case "list_subject_reports":
      case "read_report_image":
      case "read_lock_status":
      case "list_subjects":
      case "list_stats_files":
        return Promise.resolve([]);
      case "scan_bids_sidecars":
        return Promise.resolve({ groups: [], skipped: [] });
      case "check_bids_dataset":
        return Promise.resolve({ isBids: true });
      default:
        return Promise.resolve(null);
    }
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockDestroy = vi.fn(() => Promise.resolve());
const mockOnCloseRequested = vi.fn((cb) => {
  (window as any).__mockCloseRequestedListener = cb;
  return Promise.resolve(() => {
    if ((window as any).__mockCloseRequestedListener === cb) {
      (window as any).__mockCloseRequestedListener = null;
    }
  });
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    destroy: mockDestroy,
    onCloseRequested: mockOnCloseRequested,
  })),
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(() => "/home/testuser"),
  join: vi.fn((...parts: string[]) => parts.join("/")),
  tempDir: vi.fn(() => Promise.resolve("/tmp")),
  appDataDir: vi.fn(() => Promise.resolve("/home/testuser/.local/share/exploreasl_gui")),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(() => Promise.resolve(false)),
  mkdir: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => {
  const store = new Map<string, unknown>();
  return {
    Store: {
      load: vi.fn(() =>
        Promise.resolve({
          get: vi.fn((key: string) => Promise.resolve(store.get(key))),
          set: vi.fn((key: string, value: unknown) => {
            store.set(key, value);
            return Promise.resolve();
          }),
          save: vi.fn(() => Promise.resolve()),
        }),
      ),
    },
  };
});

vi.mock("@tauri-apps/plugin-os", () => ({
  cpu: vi.fn(() => Promise.resolve(8)),
  memory: vi.fn(() => Promise.resolve({ total: 16000, available: 8000, free: 4000 })),
  platform: vi.fn(() => Promise.resolve("linux")),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@mantine/notifications", () => ({
  Notifications: () => null,
  notifications: {
    show: vi.fn(),
    update: vi.fn(),
    hide: vi.fn(),
  },
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  trace: vi.fn(() => Promise.resolve()),
  debug: vi.fn(() => Promise.resolve()),
  info: vi.fn(() => Promise.resolve()),
  warn: vi.fn(() => Promise.resolve()),
  error: vi.fn(() => Promise.resolve()),
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: string[];
    itemContent: (index: number, line: string) => React.ReactNode;
  }) => (
    <div data-testid="virtuoso">
      {data?.map((item: string, index: number) => itemContent(index, item))}
    </div>
  ),
  TableVirtuoso: ({
    data,
    itemContent,
    fixedHeaderContent,
    components,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
    fixedHeaderContent?: () => React.ReactNode;
    components?: Record<string, React.ComponentType<Record<string, unknown>>>;
  }) => {
    const TableComp = components?.Table ?? "table";
    const HeadComp = components?.TableHead ?? "thead";
    const BodyComp = components?.TableBody ?? "tbody";
    const RowComp = components?.TableRow ?? "tr";
    return (
      <TableComp data-testid="table-virtuoso">
        <HeadComp>{fixedHeaderContent?.()}</HeadComp>
        <BodyComp>
          {data?.map((item: unknown, index: number) => (
            <RowComp key={index} index={index}>
              {itemContent(index, item)}
            </RowComp>
          ))}
        </BodyComp>
      </TableComp>
    );
  },
}));
