import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubjectModuleStatus } from "../../schemas/processingSchemas";
import { findCompletedSubjects } from "./ControlButton.helpers";

const mockKillProcessing = vi.fn();
const mockStartProcessing = vi.fn();
const mockClearPendingRawdataWarning = vi.fn();
let mockPendingRawdataWarning: string | null = null;

let mockPhase: "idle" | "preparing" | "running" | "completed" | "failed" | "cancelled" = "running";

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
        config: mockConfig,
        subjectStatuses: mockSubjectStatuses,
        pendingRawdataWarning: mockPendingRawdataWarning,
        clearPendingRawdataWarning: mockClearPendingRawdataWarning,
      }),
    {
      getState: () => ({
        processingPhase: mockPhase,
        startProcessing: mockStartProcessing,
        killProcessing: mockKillProcessing,
        config: mockConfig,
        subjectStatuses: mockSubjectStatuses,
        pendingRawdataWarning: mockPendingRawdataWarning,
        clearPendingRawdataWarning: mockClearPendingRawdataWarning,
      }),
    },
  ),
}));

const { default: ControlButtons } = await import("./ControlButtons");

function renderButtons(props?: { startDisabled?: boolean }) {
  return render(
    <MantineProvider>
      <ControlButtons startDisabled={props?.startDisabled} />
    </MantineProvider>,
  );
}

describe("ControlButtons kill confirmation", () => {
  afterEach(() => {
    cleanup();
    mockPhase = "running";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhase = "running";
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

describe("ControlButtons Start button disabled state", () => {
  afterEach(() => {
    cleanup();
    mockPhase = "running";
    mockPendingRawdataWarning = null;
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
    mockPendingRawdataWarning = null;
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

describe("ControlButtons rawdata warning modal (Phase 8.2)", () => {
  afterEach(() => {
    cleanup();
    mockPhase = "idle";
    mockPendingRawdataWarning = null;
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhase = "idle";
    mockPendingRawdataWarning = null;
  });

  it("does not render the rawdata warning modal when no warning is pending", () => {
    renderButtons();
    // Mantine 9 always renders the Modal root container in the DOM; the modal
    // is treated as closed when its inner content is absent.
    expect(screen.queryByTestId("bids-rawdata-warning-text")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bids-rawdata-warning-confirm-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bids-rawdata-warning-cancel-btn")).not.toBeInTheDocument();
  });

  it("renders the rawdata warning modal with text and Proceed/Cancel buttons when warning set", () => {
    mockPendingRawdataWarning = "rawdata/ already contains 5 sub-directories";
    renderButtons();
    expect(screen.getByTestId("bids-rawdata-warning-modal")).toBeInTheDocument();
    expect(screen.getByTestId("bids-rawdata-warning-text")).toHaveTextContent(
      "rawdata/ already contains 5 sub-directories",
    );
    expect(screen.getByTestId("bids-rawdata-warning-confirm-btn")).toBeInTheDocument();
    expect(screen.getByTestId("bids-rawdata-warning-cancel-btn")).toBeInTheDocument();
  });

  it("calls clearPendingRawdataWarning when Cancel is clicked (does NOT call startProcessing)", async () => {
    const user = userEvent.setup();
    mockPendingRawdataWarning = "rawdata/ already contains 5 sub-directories";
    renderButtons();

    await user.click(screen.getByTestId("bids-rawdata-warning-cancel-btn"));

    expect(mockClearPendingRawdataWarning).toHaveBeenCalledTimes(1);
    expect(mockStartProcessing).not.toHaveBeenCalled();
  });

  it("calls startProcessing(true) when Proceed is clicked (explicit confirmation)", async () => {
    const user = userEvent.setup();
    mockPendingRawdataWarning = "rawdata/ already contains 5 sub-directories";
    renderButtons();

    await user.click(screen.getByTestId("bids-rawdata-warning-confirm-btn"));

    expect(mockStartProcessing).toHaveBeenCalledWith(true);
    // Should NOT clear warning locally — the store clears it once the
    // explicit-confirm proceed invocation completes successfully.
    expect(mockClearPendingRawdataWarning).not.toHaveBeenCalled();
  });
});
