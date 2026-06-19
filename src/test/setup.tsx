import "@testing-library/jest-dom/vitest";
import "mantine-datatable/styles.css";

// ResizeObserver polyfill for mantine-datatable — must invoke the callback so rows render in jsdom
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
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as ResizeObserverEntry,
      ],
      this,
    );
  }

  unobserve() {}
  disconnect() {}
}
if (typeof window.ResizeObserver === "undefined") {
  (window as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverMock;
}

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
      case "is_writable":
        return Promise.resolve(true);
      case "run_import_pipeline":
        return Promise.resolve(12345);
      case "stop_import":
      case "clean_import_status":
      case "move_import_output":
      case "copy_lock_files":
      case "detect_exploreasl_version":
      case "read_import_status":
      case "list_subject_reports":
      case "read_report_image":
        return Promise.resolve([]);
      default:
        return Promise.resolve(null);
    }
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(() => "/home/testuser"),
  join: vi.fn((...parts: string[]) => parts.join("/")),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
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

vi.mock("@mantine/notifications", () => ({
  Notifications: () => null,
  notifications: {
    show: vi.fn(),
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
}));
