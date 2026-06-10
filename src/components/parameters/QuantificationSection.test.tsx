import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuantificationSection } from "./QuantificationSection";
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

function QuantificationSectionWrapper({
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
    <QuantificationSection
      dataPar={dataPar}
      onFieldChange={onFieldChange}
      showAdvanced={showAdvanced}
      onToggleAdvanced={onToggleAdvanced ?? (() => setShowAdvanced(!showAdvanced))}
    />
  );
}

describe("QuantificationSection", () => {
  it("renders nCompartments field", () => {
    renderWithMantine(
      <QuantificationSectionWrapper dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/number of compartments/i).length).toBeGreaterThan(0);
  });

  it("renders Show advanced toggle", () => {
    renderWithMantine(
      <QuantificationSectionWrapper dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
  });

  it("shows advanced fields when toggled on", () => {
    renderWithMantine(
      <QuantificationSectionWrapper dataPar={emptyState} onFieldChange={() => {}} />,
    );
    clickSwitch(/show advanced/i);
    expect(screen.getAllByText(/blood-brain partition/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/t1 of arterial blood/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/use external quantification/i).length).toBeGreaterThan(0);
  });

  it("shows external quantification subtree when bUseExternalQuantification is true", () => {
    renderWithMantine(
      <QuantificationSectionWrapper
        dataPar={{ bUseExternalQuantification: true }}
        onFieldChange={() => {}}
      />,
    );
    clickSwitch(/show advanced/i);
    expect(screen.getAllByText(/external quantification type/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/spatial basil/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/basil exchange/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/basil dispersion/i).length).toBeGreaterThan(0);
  });

  it("hides external quantification subtree when bUseExternalQuantification is false", () => {
    const { container } = renderWithMantine(
      <QuantificationSectionWrapper
        dataPar={{ bUseExternalQuantification: false }}
        onFieldChange={() => {}}
      />,
    );
    clickSwitch(/show advanced/i);
    const allText = container.textContent?.toLowerCase() ?? "";
    expect(allText).not.toContain("external quantification type");
  });

  it("calls onFieldChange when bUseExternalQuantification toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(
      <QuantificationSectionWrapper dataPar={emptyState} onFieldChange={onFieldChange} />,
    );
    clickSwitch(/show advanced/i);
    clickSwitch(/use external quantification/i);
    expect(onFieldChange).toHaveBeenCalledWith("bUseExternalQuantification", expect.any(Boolean));
  });

  it("calls onToggleAdvanced when Show advanced is toggled", () => {
    const onToggle = vi.fn();
    renderWithMantine(
      <QuantificationSection
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
