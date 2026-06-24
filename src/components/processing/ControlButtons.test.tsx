import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockKillProcessing = vi.fn();
const mockStartProcessing = vi.fn();

let mockPhase: "idle" | "preparing" | "running" | "completed" | "failed" | "cancelled" = "running";

vi.mock("../../stores/processingStore", () => ({
  useProcessingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      processingPhase: mockPhase,
      startProcessing: mockStartProcessing,
      killProcessing: mockKillProcessing,
    }),
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
