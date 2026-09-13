import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubjectModuleStatus } from "../../schemas/processingSchemas";
import { findCompletedSubjects } from "./ControlButton.helpers";

const mockKillProcessing = vi.fn();
const mockStartProcessing = vi.fn();
const mockConfirmProcessingStopped = vi.fn();
const mockClearBidsCompatibilityError = vi.fn();
const mockPreflightBidsSetupRepair = vi.fn();
const mockCommitBidsProjectMutations = vi.fn();
let mockBidsCompatibilityError: string | null = null;
let mockActiveRunId: string | null = "processing-run-1";
let mockTerminalRunId: string | null = null;
let mockAvailableAction = "stop";
let mockActionPending = false;

let mockPhase:
  | "idle"
  | "preparing"
  | "running"
  | "finalizing"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted" = "running";

let mockConfig: {
  subjects: string[];
  modules: string[];
  matlabPath: string;
  exploreAslPath: string;
  workers: number;
} | null = null;

let mockSubjectStatuses: SubjectModuleStatus[] = [];

vi.mock("../../stores/processingStore", () => ({
  useProcessingStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        processingPhase: mockPhase,
        startProcessing: mockStartProcessing,
        killProcessing: mockKillProcessing,
        confirmProcessingStopped: mockConfirmProcessingStopped,
        availableAction: mockAvailableAction,
        actionPending: mockActionPending,
        activeRunId: mockActiveRunId,
        terminalRunId: mockTerminalRunId,
        config: mockConfig,
        subjectStatuses: mockSubjectStatuses,
        bidsCompatibilityError: mockBidsCompatibilityError,
        clearBidsCompatibilityError: mockClearBidsCompatibilityError,
      }),
    {
      getState: () => ({
        processingPhase: mockPhase,
        startProcessing: mockStartProcessing,
        killProcessing: mockKillProcessing,
        confirmProcessingStopped: mockConfirmProcessingStopped,
        availableAction: mockAvailableAction,
        actionPending: mockActionPending,
        activeRunId: mockActiveRunId,
        terminalRunId: mockTerminalRunId,
        config: mockConfig,
        subjectStatuses: mockSubjectStatuses,
        bidsCompatibilityError: mockBidsCompatibilityError,
        clearBidsCompatibilityError: mockClearBidsCompatibilityError,
      }),
    },
  ),
}));

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (
    selector: (state: { project: { projectMeta: { rootPath: string } } }) => unknown,
  ) => selector({ project: { projectMeta: { rootPath: "/test/bids" } } }),
}));

vi.mock("../../lib/bids/setup", () => ({
  preflightBidsSetupRepair: mockPreflightBidsSetupRepair,
  commitBidsProjectMutations: mockCommitBidsProjectMutations,
}));

const { default: ControlButtons } = await import("./ControlButtons");

function renderButtons(props?: { startDisabled?: boolean }) {
  return render(
    <MantineProvider>
      <ControlButtons startDisabled={props?.startDisabled} />
    </MantineProvider>,
  );
}

afterEach(() => {
  mockTerminalRunId = null;
});

describe("ControlButtons kill confirmation", () => {
  afterEach(() => {
    cleanup();
    mockPhase = "running";
    mockActiveRunId = "processing-run-1";
    mockTerminalRunId = null;
    mockAvailableAction = "stop";
    mockActionPending = false;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhase = "running";
    mockActiveRunId = "processing-run-1";
    mockTerminalRunId = null;
    mockAvailableAction = "stop";
    mockActionPending = false;
  });

  it("does not call killProcessing immediately when kill button clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    await user.click(screen.getByTestId("stop-btn"));

    expect(mockKillProcessing).not.toHaveBeenCalled();
  });

  it("shows confirmation dialog when kill button clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    await user.click(screen.getByTestId("stop-btn"));

    expect(await screen.findByText("Stop Processing")).toBeInTheDocument();
    expect(await screen.findByText(/stop all running processing jobs/i)).toBeInTheDocument();
  });

  it("calls killProcessing when confirm button clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    await user.click(screen.getByTestId("stop-btn"));
    await user.click(await screen.findByTestId("stop-confirm-btn"));

    expect(mockKillProcessing).toHaveBeenCalled();
  });

  it("closes dialog and does not kill when cancel clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    await user.click(screen.getByTestId("stop-btn"));
    await user.click(await screen.findByTestId("stop-cancel-btn"));

    expect(mockKillProcessing).not.toHaveBeenCalled();
  });
});

describe("ControlButtons native lifecycle controls", () => {
  afterEach(() => {
    cleanup();
    mockActiveRunId = "processing-run-1";
    mockAvailableAction = "stop";
  });
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["preparing", null],
    ["finalizing", null],
    ["cancelling", null],
    ["cancelling", "processing-run-old"],
  ] as const)(
    "locks control while native run is %s without a retry for its active run",
    (phase, _retryRunId) => {
      mockPhase = phase;
      mockAvailableAction = "none";
      renderButtons();
      const control = screen.getByRole("button");
      expect(control).toBeDisabled();
      if (phase === "cancelling") expect(control).toHaveTextContent("Cancelling");
    },
  );

  it.each(["completed", "failed", "cancelled"] as const)("allows terminal %s restart", (phase) => {
    mockPhase = phase;
    renderButtons();
    expect(screen.getByTestId("start-btn")).toBeEnabled();
    mockTerminalRunId = "processing-run-1";
    cleanup();
    renderButtons();
    expect(screen.getByTestId("start-btn")).toBeDisabled();
  });

  it("locks an interrupted run until external stop confirmation", () => {
    mockPhase = "interrupted";
    mockAvailableAction = "confirmStopped";
    renderButtons();
    expect(screen.getByTestId("stop-btn")).toBeDisabled();
  });

  it("sends external-stop confirmation once and disables it while pending", async () => {
    const user = userEvent.setup();
    mockPhase = "interrupted";
    mockAvailableAction = "confirmStopped";
    renderButtons();

    const confirm = screen.getByTestId("confirm-processing-stopped-btn");
    await user.click(confirm);

    expect(mockConfirmProcessingStopped).toHaveBeenCalledOnce();
    mockActionPending = true;
    cleanup();
    renderButtons();
    expect(screen.getByTestId("confirm-processing-stopped-btn")).toBeDisabled();
  });

  it.each(["cancelling", "finalizing"] as const)(
    "enables exact-run cleanup retry while %s",
    async (phase) => {
      mockPhase = phase;
      mockAvailableAction = "retryCleanup";
      const user = userEvent.setup();
      renderButtons();

      const retry = screen.getByTestId("stop-btn");
      expect(retry).toBeEnabled();
      expect(retry).toHaveTextContent("Retry cleanup");
      await user.click(retry);
      await user.click(await screen.findByTestId("stop-confirm-btn"));

      expect(mockKillProcessing).toHaveBeenCalledTimes(1);
    },
  );
});

describe("ControlButtons Start button disabled state", () => {
  afterEach(() => {
    cleanup();
    mockPhase = "running";
    mockBidsCompatibilityError = null;
    mockPreflightBidsSetupRepair.mockResolvedValue({
      planId: "repair-plan",
      rootPath: "/test/bids",
      mode: "repair",
      operations: [
        {
          path: "rawdata/.easl-gui-managed",
          operation: "create",
          textPreview: '{"kind":"bids-direct-rawdata","version":1}\n',
        },
      ],
      warnings: [],
      conflicts: [],
      projectSummary: null,
      preservesReadme: true,
      temporaryArtifacts: [],
    });
    mockCommitBidsProjectMutations.mockResolvedValue({
      outcome: "committed",
      projectPath: null,
      canonicalProjectBytes: null,
      directorySyncSupported: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhase = "idle";
  });

  it("enables Start button when startDisabled is false", () => {
    renderButtons({ startDisabled: false });
    expect(screen.getByTestId("start-btn")).toBeEnabled();
  });

  it("disables Start button when startDisabled is true", () => {
    renderButtons({ startDisabled: true });
    expect(screen.getByTestId("start-btn")).toBeDisabled();
  });

  it("enables Start button by default when startDisabled is not provided", () => {
    renderButtons();
    expect(screen.getByTestId("start-btn")).toBeEnabled();
  });

  it("does not call startProcessing when Start clicked while disabled", async () => {
    const user = userEvent.setup();
    renderButtons({ startDisabled: true });

    await user.click(screen.getByTestId("start-btn"));

    expect(mockStartProcessing).not.toHaveBeenCalled();
  });

  it("calls startProcessing when Start clicked while enabled", async () => {
    const user = userEvent.setup();
    mockConfig = {
      subjects: ["sub-001_01"],
      modules: ["structural"],
      matlabPath: "/usr/bin/matlab",
      exploreAslPath: "/opt/easl",
      workers: 1,
    };
    mockSubjectStatuses = [];
    renderButtons({ startDisabled: false });

    await user.click(screen.getByTestId("start-btn"));

    expect(mockStartProcessing).toHaveBeenCalled();
  });

  it("keeps Stop button enabled regardless of startDisabled", () => {
    mockPhase = "running";
    renderButtons({ startDisabled: true });
    expect(screen.getByTestId("stop-btn")).toBeEnabled();
  });

  it("disables Stop button when phase is preparing", () => {
    mockPhase = "preparing";
    renderButtons({ startDisabled: true });
    expect(screen.getByTestId("stop-btn")).toBeDisabled();
  });
});

describe("ControlButtons re-process confirmation", () => {
  afterEach(() => {
    cleanup();
    mockPhase = "idle";
    mockConfig = null;
    mockSubjectStatuses = [];
    mockBidsCompatibilityError = null;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhase = "idle";
    mockConfig = {
      subjects: ["sub-001_01", "sub-002_01"],
      modules: ["structural", "asl"],
      matlabPath: "/usr/bin/matlab",
      exploreAslPath: "/opt/easl",
      workers: 1,
    };
    mockSubjectStatuses = [];
  });

  it("shows confirmation dialog when completed subjects are selected for re-processing", async () => {
    const user = userEvent.setup();
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["999_ready"],
        locked: false,
      },
    ];
    renderButtons();

    await user.click(screen.getByTestId("start-btn"));

    expect(
      await screen.findByText(/re-processing will overwrite their existing output/i),
    ).toBeInTheDocument();
    expect(screen.getByText("sub-001_01")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-reprocess-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-reprocess-confirm")).toBeInTheDocument();
  });

  it("does not show confirmation when only pending subjects are selected", async () => {
    const user = userEvent.setup();
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "pending",
        completedSteps: [],
        locked: false,
      },
    ];
    renderButtons();

    await user.click(screen.getByTestId("start-btn"));

    expect(
      screen.queryByText(/re-processing will overwrite their existing output/i),
    ).not.toBeInTheDocument();
    expect(mockStartProcessing).toHaveBeenCalled();
  });

  it("does not show confirmation when subjects have outdated status", async () => {
    const user = userEvent.setup();
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "asl",
        status: "outdated",
        completedSteps: ["999_ready"],
        locked: false,
      },
    ];
    renderButtons();

    await user.click(screen.getByTestId("start-btn"));

    expect(
      screen.queryByText(/re-processing will overwrite their existing output/i),
    ).not.toBeInTheDocument();
    expect(mockStartProcessing).toHaveBeenCalled();
  });

  it("cancel prevents processing start when confirmation dialog is dismissed", async () => {
    const user = userEvent.setup();
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["999_ready"],
        locked: false,
      },
    ];
    renderButtons();

    await user.click(screen.getByTestId("start-btn"));
    await user.click(await screen.findByTestId("confirm-reprocess-cancel"));

    expect(mockStartProcessing).not.toHaveBeenCalled();
  });

  it("confirm proceeds with processing", async () => {
    const user = userEvent.setup();
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["999_ready"],
        locked: false,
      },
    ];
    renderButtons();

    await user.click(screen.getByTestId("start-btn"));
    await user.click(await screen.findByTestId("confirm-reprocess-confirm"));

    expect(mockStartProcessing).toHaveBeenCalled();
  });

  it("shows correct module names in dialog for both modules", async () => {
    const user = userEvent.setup();
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["999_ready"],
        locked: false,
      },
      {
        subjectSession: "sub-001_01",
        module: "asl",
        status: "complete",
        completedSteps: ["999_ready"],
        locked: false,
      },
    ];
    renderButtons();

    await user.click(screen.getByTestId("start-btn"));

    expect(await screen.findByText(/Structural, ASL/)).toBeInTheDocument();
  });

  it("does not show confirmation for population-only module selection", async () => {
    const user = userEvent.setup();
    mockConfig = {
      subjects: ["sub-001_01"],
      modules: ["population"],
      matlabPath: "/usr/bin/matlab",
      exploreAslPath: "/opt/easl",
      workers: 1,
    };
    mockSubjectStatuses = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["999_ready"],
        locked: false,
      },
    ];
    renderButtons();

    await user.click(screen.getByTestId("start-btn"));

    expect(
      screen.queryByText(/re-processing will overwrite their existing output/i),
    ).not.toBeInTheDocument();
    expect(mockStartProcessing).toHaveBeenCalled();
  });
});

describe("findCompletedSubjects", () => {
  it("returns empty when no modules match structural or asl", () => {
    const result = findCompletedSubjects(["sub-001_01"], ["population"], []);
    expect(result).toEqual([]);
  });

  it("returns empty when no subjects are selected", () => {
    const result = findCompletedSubjects(
      [],
      ["structural"],
      [
        {
          subjectSession: "sub-001_01",
          module: "structural",
          status: "complete",
          completedSteps: ["999_ready"],
          locked: false,
        },
      ],
    );
    expect(result).toEqual([]);
  });

  it("finds subjects complete for structural module", () => {
    const statuses: SubjectModuleStatus[] = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["999_ready"],
        locked: false,
      },
    ];
    const result = findCompletedSubjects(["sub-001_01"], ["structural"], statuses);
    expect(result).toEqual([{ subjectSession: "sub-001_01", modules: ["structural"] }]);
  });

  it("finds subjects complete for both modules", () => {
    const statuses: SubjectModuleStatus[] = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["999_ready"],
        locked: false,
      },
      {
        subjectSession: "sub-001_01",
        module: "asl",
        status: "complete",
        completedSteps: ["999_ready"],
        locked: false,
      },
    ];
    const result = findCompletedSubjects(["sub-001_01"], ["structural", "asl"], statuses);
    expect(result).toEqual([{ subjectSession: "sub-001_01", modules: ["structural", "asl"] }]);
  });

  it("excludes subjects with outdated status", () => {
    const statuses: SubjectModuleStatus[] = [
      {
        subjectSession: "sub-001_01",
        module: "asl",
        status: "outdated",
        completedSteps: ["999_ready"],
        locked: false,
      },
    ];
    const result = findCompletedSubjects(["sub-001_01"], ["asl"], statuses);
    expect(result).toEqual([]);
  });

  it("excludes subjects with incomplete status", () => {
    const statuses: SubjectModuleStatus[] = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "incomplete",
        completedSteps: ["060_Segment_T1w"],
        locked: false,
      },
    ];
    const result = findCompletedSubjects(["sub-001_01"], ["structural"], statuses);
    expect(result).toEqual([]);
  });

  it("returns only subjects that have at least one completed module", () => {
    const statuses: SubjectModuleStatus[] = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: ["999_ready"],
        locked: false,
      },
      {
        subjectSession: "sub-002_01",
        module: "structural",
        status: "pending",
        completedSteps: [],
        locked: false,
      },
    ];
    const result = findCompletedSubjects(["sub-001_01", "sub-002_01"], ["structural"], statuses);
    expect(result).toEqual([{ subjectSession: "sub-001_01", modules: ["structural"] }]);
  });
});

describe("ControlButtons BIDS compatibility repair", () => {
  afterEach(() => {
    cleanup();
    mockPhase = "idle";
    mockBidsCompatibilityError = null;
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhase = "idle";
    mockBidsCompatibilityError = null;
  });

  it("does not render setup repair error when no verification error is pending", () => {
    renderButtons();
    // Mantine 9 always renders the Modal root container in the DOM; the modal
    // is treated as closed when its inner content is absent.
    expect(screen.queryByTestId("bids-compatibility-error-text")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bids-repair-preflight-btn")).not.toBeInTheDocument();
  });

  it("renders a repair action for a verification failure", () => {
    mockBidsCompatibilityError = "BIDS marker is missing";
    renderButtons();
    expect(screen.getByTestId("bids-compatibility-error-modal")).toBeInTheDocument();
    expect(screen.getByTestId("bids-compatibility-error-text")).toHaveTextContent(
      "BIDS marker is missing",
    );
    expect(screen.getByTestId("bids-repair-preflight-btn")).toBeInTheDocument();
  });

  it("clears verification error when Close is clicked", async () => {
    const user = userEvent.setup();
    mockBidsCompatibilityError = "BIDS marker is missing";
    renderButtons();

    await user.click(screen.getByTestId("bids-compatibility-error-close-btn"));

    expect(mockClearBidsCompatibilityError).toHaveBeenCalledTimes(1);
    expect(mockStartProcessing).not.toHaveBeenCalled();
  });

  it("opens a read-only repair review and commits only its opaque plan after confirmation", async () => {
    const user = userEvent.setup();
    mockBidsCompatibilityError = "BIDS marker is missing";
    renderButtons();

    await user.click(screen.getByTestId("bids-repair-preflight-btn"));
    expect(mockPreflightBidsSetupRepair).toHaveBeenCalledWith("/test/bids");
    expect(
      await screen.findByTestId("bids-repair-operation-rawdata--easl-gui-managed"),
    ).toHaveTextContent("rawdata/.easl-gui-managed");
    expect(mockCommitBidsProjectMutations).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("bids-repair-confirm-btn"));
    expect(mockCommitBidsProjectMutations).toHaveBeenCalledWith("repair-plan");
    expect(mockClearBidsCompatibilityError).toHaveBeenCalled();
  });
});
