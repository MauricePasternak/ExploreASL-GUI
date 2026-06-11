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

    const killBtns = screen.getAllByTestId("kill-btn");
    await user.click(killBtns[0]);

    expect(mockKillProcessing).not.toHaveBeenCalled();
  });

  it("shows confirmation dialog when kill button clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    const killBtns = screen.getAllByTestId("kill-btn");
    await user.click(killBtns[0]);

    expect(screen.getByText("Kill Processing")).toBeInTheDocument();
    expect(screen.getByText(/stop all running processing jobs/i)).toBeInTheDocument();
  });

  it("calls killProcessing when confirm button clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    const killBtns = screen.getAllByTestId("kill-btn");
    await user.click(killBtns[0]);
    await user.click(screen.getByTestId("kill-confirm-btn"));

    expect(mockKillProcessing).toHaveBeenCalled();
  });

  it("closes dialog and does not kill when cancel clicked", async () => {
    const user = userEvent.setup();
    renderButtons();

    const killBtns = screen.getAllByTestId("kill-btn");
    await user.click(killBtns[0]);
    await user.click(screen.getByTestId("kill-cancel-btn"));

    expect(mockKillProcessing).not.toHaveBeenCalled();
  });
});
