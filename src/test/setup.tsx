import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom has no layout or ResizeObserver. TestMantineProvider also respects reduced motion.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(window as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverMock;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn((query: string) => ({
    // ponytail: only unrestricted columns and reduced motion match; browser tests cover layout.
    matches: query.trim() === "" || query === "(prefers-reduced-motion: reduce)",
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
      case "which_matlab":
        return Promise.resolve([]);
      case "which_apptainer":
        return Promise.resolve([]);
      case "is_writable":
        return Promise.resolve(true);
      case "get_active_import_run":
        return Promise.resolve(null);
      case "reserve_import_run":
      case "attach_import_run":
      case "launch_import_run":
      case "cancel_import_run": {
        const args = _args ?? {};
        const lifecycle =
          cmd === "reserve_import_run"
            ? "preparing"
            : cmd === "cancel_import_run"
              ? "cancelled"
              : "running";
        return Promise.resolve({
          runId: (args.runId as string | undefined) ?? "test-import-run",
          lifecycle,
          ownershipGeneration: 1,
          profileId: "test-profile",
          selectedSubjects: (args.subjectList as string[] | undefined) ?? [],
          createdAtMs: 1,
          updatedAtMs: 1,
          subjectOutcomes: [],
          confirmationRequired: false,
          ...(lifecycle === "cancelled" ? { terminalResult: "cancelled" } : {}),
        });
      }
      case "get_active_run":
        return Promise.resolve(null);
      case "reserve_processing_run":
      case "run_pipeline":
      case "attach_run":
      case "kill_pipeline": {
        const args = _args ?? {};
        const lifecycle =
          cmd === "reserve_processing_run"
            ? "preparing"
            : cmd === "kill_pipeline"
              ? "cancelled"
              : "running";
        return Promise.resolve({
          runId: (args.runId as string | undefined) ?? "test-processing-run",
          lifecycle,
          projectRoot: "/test/project",
          selectedModules: (args.selectedModules as string[] | undefined) ?? [],
          selectedSubjectSessions: (args.selectedSubjectSessions as string[] | undefined) ?? [],
          startTime: 1,
          revision: 1,
          requestId: "12345678-1234-4234-8234-123456789002",
          expectedTargets: [],
          logicalExits: [],
          workerCount: 1,
          error: null,
          availableAction: lifecycle === "cancelled" ? "acknowledge" : "stop",
          terminalSummary:
            lifecycle === "cancelled"
              ? {
                  result: "cancelled",
                  executionCommitted: true,
                  populationCompleted: false,
                  profileId: "test-profile",
                  exploreAslVersion: null,
                }
              : null,
          terminalRevision: lifecycle === "cancelled" ? 1 : null,
          executionCommitted: true,
          populationExecutionCommitted: false,
          versions: null,
          populationReadyMtimeMs: null,
          ...(lifecycle === "cancelled" ? { terminalResult: lifecycle } : {}),
        });
      }
      case "preflight_staging_plan":
        return Promise.resolve({ valid: true, issues: [] });
      case "plan_import_relocation":
        return Promise.resolve({
          planId: "test-relocation-plan",
          subjects: [],
          fingerprint: "test",
        });
      case "validate_execution_profile":
        return Promise.resolve({
          id: (_args as { executionProfile: { id: string } }).executionProfile.id,
          valid: false,
          errors: [],
        });
      case "validate_all_execution_profiles":
      case "read_import_status":
      case "list_subject_reports":
      case "list_module_logs":
      case "get_subject_session_qc":
      case "read_report_image":
      case "read_lock_status":
      case "list_subjects":
      case "list_stats_files":
        return Promise.resolve([]);
      case "read_module_logs":
        return Promise.resolve({});
      case "scan_bids_sidecars":
        return Promise.resolve({ groups: [], skipped: [] });
      case "check_bids_dataset":
        return Promise.resolve({ isBids: true });
      case "preflight_bids_project_mutations":
        return Promise.resolve({
          planId: "test-setup-plan",
          rootPath: (_args?.rootPath as string | undefined) ?? "/test/project",
          mode: (_args?.mode as string | undefined) ?? "bids",
          operations: [],
          warnings: [],
          conflicts: [],
          projectSummary: null,
          preservesReadme: true,
          temporaryArtifacts: [],
        });
      case "commit_bids_project_mutations":
        return Promise.resolve({ directorySyncSupported: true });
      case "preflight_bids_setup_repair":
        return Promise.resolve({
          planId: "test-repair-plan",
          rootPath: "/test/project",
          mode: "repair",
          operations: [],
          warnings: [],
          conflicts: [],
          projectSummary: null,
          preservesReadme: true,
          temporaryArtifacts: [],
        });
      case "shutdown_project_runtime":
        return Promise.resolve({
          success: true,
          importProcess: { success: true },
          processingWorkers: { success: true },
          lockWatcher: { success: true },
        });
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
