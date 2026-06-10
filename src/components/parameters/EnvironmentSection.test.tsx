import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EnvironmentSection } from "./EnvironmentSection";
import type { DataParState } from "../../schemas/dataParSchema";

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

function clickSwitch(text: RegExp) {
  const textEl = screen.getAllByText(text)[0];
  const switchRoot = textEl.closest("[data-label-position]");
  if (switchRoot) {
    const labelBody = switchRoot.querySelector(".mantine-Switch-body");
    if (labelBody) {
      fireEvent.click(labelBody);
      return;
    }
  }
  const group = textEl.closest(".mantine-Group-root");
  if (group) {
    const input = group.querySelector("input[type='checkbox']");
    if (input) {
      fireEvent.click(input);
      return;
    }
  }
  fireEvent.click(textEl);
}

afterEach(() => cleanup());

const emptyState: DataParState = {};

describe("EnvironmentSection", () => {
  it("renders bAutomaticallyDetectFSL toggle", () => {
    renderWithMantine(
      <EnvironmentSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/auto-detect fsl/i).length).toBeGreaterThan(0);
  });

  it("renders bAutomaticallyDetectVABY toggle", () => {
    renderWithMantine(
      <EnvironmentSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/auto-detect vaby/i).length).toBeGreaterThan(0);
  });

  it("does not render AdvancedDivider", () => {
    renderWithMantine(
      <EnvironmentSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.queryByText(/show advanced/i)).toBeNull();
  });

  it("treats undefined bAutomaticallyDetectFSL as true", () => {
    renderWithMantine(
      <EnvironmentSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    const fslInput = document.querySelector(
      'input[role="switch"]',
    );
    expect(fslInput?.getAttribute("data-checked")).toBe("true");
  });

  it("calls onFieldChange when bAutomaticallyDetectFSL toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(
      <EnvironmentSection dataPar={emptyState} onFieldChange={onFieldChange} />,
    );
    clickSwitch(/auto-detect fsl/i);
    expect(onFieldChange).toHaveBeenCalledWith("bAutomaticallyDetectFSL", expect.any(Boolean));
  });
});
