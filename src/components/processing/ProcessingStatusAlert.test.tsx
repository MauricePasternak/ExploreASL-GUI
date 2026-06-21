import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreflightResult } from "./ProcessingStatusAlert";

let mockConfig: Record<string, unknown> | null = null;
let mockAvailableSubjects: { subjectSession: string; module: string }[] = [];
let mockSubjectStatuses: { subjectSession: string; module: string }[] = [];
let mockMatlabInstallations: { label: string; path: string; version: string }[] = [
  { label: "R2024a", path: "/usr/bin/matlab", version: "R2024a" },
];
let mockExploreAslPath = "/opt/ExploreASL";

vi.mock("../../stores/processingStore", () => ({
  useProcessingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      config: mockConfig,
      availableSubjects: mockAvailableSubjects,
      subjectStatuses: mockSubjectStatuses,
    }),
}));

vi.mock("../../stores/globalStore", () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settings: {
        matlabInstallations: mockMatlabInstallations,
        exploreAslPath: mockExploreAslPath,
      },
    }),
}));

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      project: { projectMeta: { rootPath: "/test/project" } },
    }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_cpu_cores") return Promise.resolve(8);
    return Promise.resolve(null);
  }),
}));

let mockExistsResult: boolean = true;
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn().mockImplementation(() => Promise.resolve(mockExistsResult)),
}));

const ProcessingStatusAlertModule = await import("./ProcessingStatusAlert");
const ProcessingStatusAlert = ProcessingStatusAlertModule.default;

function renderAlert(onResult?: (r: PreflightResult) => void) {
  return render(
    <MantineProvider>
      <ProcessingStatusAlert onResult={onResult} />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  mockExistsResult = true;
});

describe("ProcessingStatusAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = null;
    mockAvailableSubjects = [];
    mockSubjectStatuses = [];
    mockMatlabInstallations = [{ label: "R2024a", path: "/usr/bin/matlab", version: "R2024a" }];
    mockExploreAslPath = "/opt/ExploreASL";
  });

  describe("idle state", () => {
    it("shows grey idle state when no modules and no subjects selected", () => {
      mockConfig = {
        subjects: [],
        modules: [],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      renderAlert();
      const alert = screen.getByTestId("processing-status-alert");
      expect(alert.getAttribute("data-state")).toBe("idle");
      expect(alert).toHaveTextContent(/Select the Modules and Subject\/Sessions to run/i);
    });
  });

  describe("checking state", () => {
    it("shows grey checking state while async fs checks pending", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      // Delay exists() resolution by returning a pending promise
      const { exists } = await import("@tauri-apps/plugin-fs");
      vi.mocked(exists).mockImplementationOnce(
        () => new Promise<boolean>(() => undefined), // never resolves
      );
      renderAlert();
      const alert = screen.getByTestId("processing-status-alert");
      expect(alert.getAttribute("data-state")).toBe("checking");
      expect(alert).toHaveTextContent(/Checking environment/i);
    });
  });

  describe("error state", () => {
    it("shows red error state when no modules selected", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: [],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/No processing modules selected/i)).toBeInTheDocument();
    });

    it("shows red error state when structural selected without subjects", async () => {
      mockConfig = {
        subjects: [],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/No subjects selected/i)).toBeInTheDocument();
    });

    it("does NOT show subjects error when only population module selected", async () => {
      mockConfig = {
        subjects: [],
        modules: ["population"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "ready",
        );
      });
      expect(screen.queryByText(/No subjects selected/i)).not.toBeInTheDocument();
    });

    it("shows red error when MATLAB path missing", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/No MATLAB installation configured/i)).toBeInTheDocument();
    });

    it("shows red error when MATLAB executable not found", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      mockExistsResult = false;
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/MATLAB executable not found/i)).toBeInTheDocument();
    });

    it("shows red error when ExploreASL.m missing", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      const { exists } = await import("@tauri-apps/plugin-fs");
      // First call: MATLAB exists. Second call: ExploreASL dir. Third call: ExploreASL.m missing.
      vi.mocked(exists)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true); // dataPar dir
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/ExploreASL\.m not found/i)).toBeInTheDocument();
    });

    it("shows red error when worker count exceeds cores", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 16,
        subjectRegexp: "",
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/exceeds available CPU cores/i)).toBeInTheDocument();
    });

    it("shows red error when population module selected with workers > 1", async () => {
      mockConfig = {
        subjects: [],
        modules: ["population"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 2,
        subjectRegexp: "",
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/Population module requires exactly 1 worker/i)).toBeInTheDocument();
    });
  });

  describe("warning state", () => {
    it("shows yellow warning when dataPar.json dir missing", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      const { exists } = await import("@tauri-apps/plugin-fs");
      // MATLAB exists, ExploreASL dir exists, ExploreASL.m exists, dataPar dir missing
      vi.mocked(exists)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "warning",
        );
      });
      expect(
        screen.getByText(/derivatives\/ExploreASL\/ directory does not exist/i),
      ).toBeInTheDocument();
    });

    it("shows yellow warning when workers > subjects", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 4,
        subjectRegexp: "",
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "warning",
        );
      });
      expect(screen.getByText(/Spawning fewer workers/i)).toBeInTheDocument();
    });

    it("shows yellow warning for orphaned subjects in subjectStatuses", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      mockAvailableSubjects = [{ subjectSession: "sub-001_01", module: "structural" }];
      mockSubjectStatuses = [{ subjectSession: "sub-999_01", module: "structural" }];
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "warning",
        );
      });
      expect(screen.getByText(/orphaned lock file entr/i)).toBeInTheDocument();
    });
  });

  describe("ready state", () => {
    it("shows green ready state when all checks pass", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "ready",
        );
      });
      expect(screen.getByText(/All checks passed/i)).toBeInTheDocument();
    });

    it("does not show ready when warnings present", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 4, // workers > subjects triggers warning
        subjectRegexp: "",
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "warning",
        );
      });
      expect(screen.queryByText(/All checks passed/i)).not.toBeInTheDocument();
    });
  });

  describe("onResult callback", () => {
    it("calls onResult with ready=true when all checks pass", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      const onResult = vi.fn();
      renderAlert(onResult);
      await waitFor(() => {
        expect(onResult).toHaveBeenCalledWith(
          expect.objectContaining({ ready: true, errors: [], warnings: [] }),
        );
      });
    });

    it("calls onResult with ready=false when errors present", async () => {
      mockConfig = {
        subjects: [],
        modules: [],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      const onResult = vi.fn();
      renderAlert(onResult);
      await waitFor(() => {
        expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ready: false }));
      });
    });
  });

  describe("global store matlabInstallations empty edge case", () => {
    it("shows error when global store has no installations but config.matlabPath is set and exists on disk", async () => {
      mockMatlabInstallations = [];
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        matlabPath: "/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
      // exists() returns true for all paths (matlab exists on disk)
      const onResult = vi.fn();
      renderAlert(onResult);
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/No MATLAB installation configured/i)).toBeInTheDocument();
      expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ready: false }));
    });
  });

  describe("config null", () => {
    it("renders nothing when config is null", () => {
      mockConfig = null;
      renderAlert();
      expect(screen.queryByTestId("processing-status-alert")).not.toBeInTheDocument();
    });
  });
});
