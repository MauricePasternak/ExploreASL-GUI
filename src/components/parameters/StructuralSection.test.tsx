import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StructuralSection } from "./StructuralSection";
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

describe("StructuralSection", () => {
  it("renders bRunLongReg toggle", () => {
    renderWithMantine(<StructuralSection dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.getAllByText(/longitudinal registration/i).length).toBeGreaterThan(0);
  });

  it("renders bRunDARTEL toggle", () => {
    renderWithMantine(<StructuralSection dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.getAllByText(/dartel registration/i).length).toBeGreaterThan(0);
  });

  it("renders WMHsegmAlg select", () => {
    renderWithMantine(<StructuralSection dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.getAllByText(/wmh segmentation/i).length).toBeGreaterThan(0);
  });

  it("renders bSegmentSPM12 toggle", () => {
    renderWithMantine(<StructuralSection dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.getAllByText(/spm12 segmentation/i).length).toBeGreaterThan(0);
  });

  it("renders bHammersCAT12 toggle", () => {
    renderWithMantine(<StructuralSection dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.getAllByText(/hammers atlas/i).length).toBeGreaterThan(0);
  });

  it("renders bFixResolution toggle", () => {
    renderWithMantine(<StructuralSection dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.getAllByText(/fix resolution/i).length).toBeGreaterThan(0);
  });

  it("does not render AdvancedDivider", () => {
    renderWithMantine(<StructuralSection dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.queryByText(/show advanced/i)).toBeNull();
  });

  it("calls onFieldChange when bRunLongReg toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(<StructuralSection dataPar={emptyState} onFieldChange={onFieldChange} />);
    clickSwitch(/longitudinal registration/i);
    expect(onFieldChange).toHaveBeenCalledWith("bRunLongReg", expect.any(Number));
  });
});
