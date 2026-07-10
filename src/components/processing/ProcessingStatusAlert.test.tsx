import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreflightResult } from "./ProcessingStatusAlert";
import { makeMatlabProfile } from "../../test/profileFixtures";

let mockConfig: Record<string, unknown> | null = null;
let mockAvailableSubjects: { subjectSession: string; module: string }[] = [];
let mockSubjectStatuses: { subjectSession: string; module: string }[] = [];
const validProfile = makeMatlabProfile({ id: "profile-1", label: "R2024a" });
let mockExecutionProfiles = [validProfile];
let mockProfileValidationState: Record<string, { valid: boolean; errors: string[] }> = {
  [validProfile.id]: { valid: true, errors: [] },
};

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
        executionProfiles: mockExecutionProfiles,
      },
      profileValidationState: mockProfileValidationState,
      hasValidProfile: () =>
        mockExecutionProfiles.some(
          (profile) => mockProfileValidationState[profile.id]?.valid === true,
        ),
      getProfileById: (id: string) => mockExecutionProfiles.find((profile) => profile.id === id),
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
    mockExecutionProfiles = [validProfile];
    mockProfileValidationState = { [validProfile.id]: { valid: true, errors: [] } };
  });

  describe("idle state", () => {
    it("shows grey idle state when no modules and no subjects selected", () => {
      mockConfig = {
        subjects: [],
        modules: [],
        selectedProfileId: validProfile.id,
        workers: 1,
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
        selectedProfileId: validProfile.id,
        workers: 1,
      };
      const { exists } = await import("@tauri-apps/plugin-fs");
      vi.mocked(exists).mockImplementationOnce(() => new Promise<boolean>(() => undefined));
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
        selectedProfileId: validProfile.id,
        workers: 1,
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
        selectedProfileId: validProfile.id,
        workers: 1,
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
        selectedProfileId: validProfile.id,
        workers: 1,
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "ready",
        );
      });
      expect(screen.queryByText(/No subjects selected/i)).not.toBeInTheDocument();
    });

    it("shows red error when no valid execution profile exists", async () => {
      mockExecutionProfiles = [];
      mockProfileValidationState = {};
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        selectedProfileId: "",
        workers: 1,
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/No valid execution profile configured/i)).toBeInTheDocument();
    });

    it("shows red error when selected profile is invalid", async () => {
      mockProfileValidationState = {
        [validProfile.id]: { valid: false, errors: ["MATLAB executable not found"] },
      };
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        selectedProfileId: validProfile.id,
        workers: 1,
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/Execution profile "R2024a" is invalid/i)).toBeInTheDocument();
    });

    it("shows red error when selected profile is missing", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        selectedProfileId: "missing-profile",
        workers: 1,
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/Selected execution profile not found/i)).toBeInTheDocument();
    });

    it("shows red error when worker count exceeds cores", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        selectedProfileId: validProfile.id,
        workers: 16,
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
        selectedProfileId: validProfile.id,
        workers: 2,
      };
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(screen.getByText(/Population module requires exactly 1 worker/i)).toBeInTheDocument();
    });

    it("shows red error when ASL module is selected and some selected subjects lack ASL data", async () => {
      mockConfig = {
        subjects: ["sub-001_01", "sub-002_01"],
        modules: ["asl"],
        selectedProfileId: validProfile.id,
        workers: 1,
      };
      mockAvailableSubjects = [
        { subjectSession: "sub-001_01", hasStructural: true, hasASL: true } as any,
        { subjectSession: "sub-002_01", hasStructural: true, hasASL: false } as any,
      ];
      renderAlert();
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
      });
      expect(
        screen.getByText(
          /Cannot run ASL module because some selected subjects lack ASL data: sub-002_01/i,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("warning state", () => {
    it("shows yellow warning when dataPar.json dir missing", async () => {
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        selectedProfileId: validProfile.id,
        workers: 1,
      };
      mockExistsResult = false;
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
        selectedProfileId: validProfile.id,
        workers: 4,
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
        selectedProfileId: validProfile.id,
        workers: 1,
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
        selectedProfileId: validProfile.id,
        workers: 1,
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
        selectedProfileId: validProfile.id,
        workers: 4,
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
        selectedProfileId: validProfile.id,
        workers: 1,
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
        selectedProfileId: validProfile.id,
        workers: 1,
      };
      const onResult = vi.fn();
      renderAlert(onResult);
      await waitFor(() => {
        expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ready: false }));
      });
    });
  });

  describe("global store profiles empty edge case", () => {
    it("shows error when no profiles exist even if config.selectedProfileId is set", async () => {
      mockExecutionProfiles = [];
      mockProfileValidationState = {};
      mockConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        selectedProfileId: "stale-profile",
        workers: 1,
      };
      const onResult = vi.fn();
      renderAlert(onResult);
      await waitFor(() => {
        expect(screen.getByTestId("processing-status-alert").getAttribute("data-state")).toBe(
          "error",
        );
        expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ready: false }));
      });
      expect(screen.getByText(/No valid execution profile configured/i)).toBeInTheDocument();
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
