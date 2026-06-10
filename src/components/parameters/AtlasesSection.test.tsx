import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AtlasesSection } from "./AtlasesSection";
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

describe("AtlasesSection", () => {
  it("renders AtlasSelect component with atlas multiselect", () => {
    renderWithMantine(
      <AtlasesSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
  });

  it("renders Show advanced toggle", () => {
    renderWithMantine(
      <AtlasesSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
  });

  it("shows advanced fields when toggled on", () => {
    renderWithMantine(
      <AtlasesSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    clickSwitch(/show advanced/i);
    expect(screen.getAllByText(/minimal roi volume/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/white-matter hyperintensity/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/data types/i).length).toBeGreaterThan(0);
  });

  it("renders bMasking checkboxes when advanced is on", () => {
    renderWithMantine(
      <AtlasesSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    clickSwitch(/show advanced/i);
    expect(screen.getAllByText(/enable masking/i).length).toBeGreaterThan(0);
  });

  it("renders existing atlas entries", () => {
    renderWithMantine(
      <AtlasesSection
        dataPar={{ Atlases: ["Total"], TissueMasking: ["GM+WM"], TissueThreshold: [0.7] }}
        onFieldChange={() => {}}
      />,
    );
    expect(screen.getAllByText("Total").length).toBeGreaterThan(0);
  });

  it("calls onFieldChange when bWMH toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(
      <AtlasesSection dataPar={emptyState} onFieldChange={onFieldChange} />,
    );
    clickSwitch(/show advanced/i);
    clickSwitch(/white-matter hyperintensity/i);
    expect(onFieldChange).toHaveBeenCalledWith("bWMH", expect.any(Boolean));
  });
});
