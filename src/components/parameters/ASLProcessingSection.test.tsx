import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ASLProcessingSection } from "./ASLProcessingSection";
import type { DataParState } from "../../schemas/dataParSchema";

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

function clickSwitch(text: RegExp) {
  const textEl = screen.getAllByText(text)[0];
  const switchRoot = textEl.closest("[data-label-position]");
  const labelBody = switchRoot?.querySelector(".mantine-Switch-body");
  fireEvent.click(labelBody!);
}

afterEach(() => cleanup());

const emptyState: DataParState = {};

describe("ASLProcessingSection", () => {
  it("renders motionCorrection toggle", () => {
    renderWithMantine(
      <ASLProcessingSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/motion correction/i).length).toBeGreaterThan(0);
  });

  it("renders bTopUp toggle", () => {
    renderWithMantine(
      <ASLProcessingSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/fsl topup/i).length).toBeGreaterThan(0);
  });

  it("renders bPVCNativeSpace toggle", () => {
    renderWithMantine(
      <ASLProcessingSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/partial volume correction/i).length).toBeGreaterThan(0);
  });

  it("renders SaveCBF4D toggle", () => {
    renderWithMantine(
      <ASLProcessingSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/save 4d cbf/i).length).toBeGreaterThan(0);
  });

  it("renders Show advanced toggle", () => {
    renderWithMantine(
      <ASLProcessingSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
  });

  it("shows advanced fields when toggled on", () => {
    renderWithMantine(
      <ASLProcessingSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    clickSwitch(/show advanced/i);
    expect(screen.getAllByText(/spike removal threshold/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/registration contrast/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/affine registration/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/dct registration/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/use mni as dummy/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/apply quantification/i).length).toBeGreaterThan(0);
  });

  it("calls onFieldChange when motionCorrection toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(
      <ASLProcessingSection dataPar={emptyState} onFieldChange={onFieldChange} />,
    );
    clickSwitch(/motion correction/i);
    expect(onFieldChange).toHaveBeenCalledWith("motionCorrection", expect.any(Boolean));
  });
});
