import { useState } from "react";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../test/render";

import { QuantificationSection } from "./QuantificationSection";
import type { DataParState } from "../../schemas/dataParSchema";

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
  it("renders basic fields and shows advanced fields when toggled on", () => {
    renderWithMantine(
      <QuantificationSectionWrapper dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/tissue compartment/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("switch", { name: /show advanced/i }));
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
    fireEvent.click(screen.getByRole("switch", { name: /show advanced/i }));
    expect(screen.getAllByText(/external quantification type/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/spatial regularization/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/basil exchange/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/bolus dispersion/i).length).toBeGreaterThan(0);
  });

  it("hides external quantification subtree when bUseExternalQuantification is false", () => {
    const { container } = renderWithMantine(
      <QuantificationSectionWrapper
        dataPar={{ bUseExternalQuantification: false }}
        onFieldChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /show advanced/i }));
    const allText = container.textContent?.toLowerCase() ?? "";
    expect(allText).not.toContain("external quantification type");
  });

  it("calls onFieldChange when bUseExternalQuantification toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(
      <QuantificationSectionWrapper dataPar={emptyState} onFieldChange={onFieldChange} />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /show advanced/i }));
    fireEvent.click(screen.getByRole("switch", { name: /use external quantification/i }));
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
    fireEvent.click(screen.getByRole("switch", { name: /show advanced/i }));
    expect(onToggle).toHaveBeenCalled();
  });
});
