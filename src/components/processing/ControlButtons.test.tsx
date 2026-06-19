import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockKillProcessing = vi.fn();
const mockStartProcessing = vi.fn();

vi.mock("../../stores/processingStore", () => ({
  useProcessingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      processingPhase: "running",
      startProcessing: mockStartProcessing,
      killProcessing: mockKillProcessing,
    }),
}));

const { default: ControlButtons } = await import("./ControlButtons");

function renderButtons() {
  return render(
    <MantineProvider>
      <ControlButtons />
    </MantineProvider>,
  );
}

describe("ControlButtons kill confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not call killProcessing immediately when kill button clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    const stopBtns = screen.getAllByTestId("stop-btn");
    await user.click(stopBtns[0]);

    expect(mockKillProcessing).not.toHaveBeenCalled();
  });

  it("shows confirmation dialog when kill button clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    const stopBtns = screen.getAllByTestId("stop-btn");
    await user.click(stopBtns[0]);

    expect(screen.getByText("Stop Processing")).toBeInTheDocument();
    expect(screen.getByText(/stop all running processing jobs/i)).toBeInTheDocument();
  });

  it("calls killProcessing when confirm button clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    const stopBtns = screen.getAllByTestId("stop-btn");
    await user.click(stopBtns[0]);
    await user.click(screen.getByTestId("stop-confirm-btn"));

    expect(mockKillProcessing).toHaveBeenCalled();
  });

  it("closes dialog and does not kill when cancel clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    const stopBtns = screen.getAllByTestId("stop-btn");
    await user.click(stopBtns[0]);
    await user.click(screen.getByTestId("stop-cancel-btn"));

    expect(mockKillProcessing).not.toHaveBeenCalled();
  });
});
