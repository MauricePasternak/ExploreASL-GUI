import { useState } from "react";
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

function AtlasesSectionWrapper({
  dataPar = emptyState,
  initialShow = false,
  onFieldChange = () => {},
  onToggleAdvanced,
}: {
  dataPar?: DataParState;
  initialShow?: boolean;
  onFieldChange?: (field: string, value: unknown) => void;
  onToggleAdvanced?: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(initialShow);
  return (
    <AtlasesSection
      dataPar={dataPar}
      onFieldChange={onFieldChange}
      showAdvanced={showAdvanced}
      onToggleAdvanced={onToggleAdvanced ?? (() => setShowAdvanced(!showAdvanced))}
    />
  );
}

describe("AtlasesSection", () => {
  it("renders AtlasSelect component with atlas multiselect", () => {
    renderWithMantine(<AtlasesSectionWrapper dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
  });

  it("renders Show advanced toggle", () => {
    renderWithMantine(<AtlasesSectionWrapper dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
  });

  it("shows advanced fields when toggled on", () => {
    renderWithMantine(<AtlasesSectionWrapper dataPar={emptyState} onFieldChange={() => {}} />);
    clickSwitch(/show advanced/i);
    expect(screen.getAllByText(/minimal roi volume/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/wmh lesion detection/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/data types/i).length).toBeGreaterThan(0);
  });

  it("renders bMasking checkboxes when advanced is on", () => {
    renderWithMantine(<AtlasesSectionWrapper dataPar={emptyState} onFieldChange={() => {}} />);
    clickSwitch(/show advanced/i);
    expect(screen.getAllByText(/roi exclusion masks/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/susceptibility mask/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/vascular mask/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/wholebrain/i).length).toBeGreaterThan(0);
  });

  it("renders existing atlas entries", () => {
    renderWithMantine(
      <AtlasesSectionWrapper
        dataPar={{ Atlases: ["Total"], TissueMasking: ["GM"], TissueThreshold: [0.7] }}
        onFieldChange={() => {}}
      />,
    );
    expect(screen.getAllByText(/whole brain grey and white/i).length).toBeGreaterThan(0);
  });

  it("calls onFieldChange when bWMH toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(<AtlasesSectionWrapper dataPar={emptyState} onFieldChange={onFieldChange} />);
    clickSwitch(/show advanced/i);
    clickSwitch(/wmh lesion detection/i);
    expect(onFieldChange).toHaveBeenCalledWith("bWMH", expect.any(Boolean));
  });

  it("calls onToggleAdvanced when Show advanced is toggled", () => {
    const onToggle = vi.fn();
    renderWithMantine(
      <AtlasesSection
        dataPar={emptyState}
        onFieldChange={() => {}}
        showAdvanced={false}
        onToggleAdvanced={onToggle}
      />,
    );
    clickSwitch(/show advanced/i);
    expect(onToggle).toHaveBeenCalled();
  });
});
