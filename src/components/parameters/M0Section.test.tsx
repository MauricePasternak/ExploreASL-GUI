import { useState } from "react";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../test/render";

import { M0Section } from "./M0Section";
import type { DataParState } from "../../schemas/dataParSchema";

afterEach(() => cleanup());

const emptyState: DataParState = {};

function M0SectionWrapper({
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
    <M0Section
      dataPar={dataPar}
      onFieldChange={onFieldChange}
      showAdvanced={showAdvanced}
      onToggleAdvanced={onToggleAdvanced ?? (() => setShowAdvanced(!showAdvanced))}
    />
  );
}

describe("M0Section", () => {
  it("shows BackgroundSuppressionPulseTime when condition met", () => {
    renderWithMantine(
      <M0SectionWrapper
        dataPar={{ M0: "UseControlAsM0", BackgroundSuppressionNumberPulses: 2 }}
        onFieldChange={() => {}}
      />,
    );
    expect(screen.getAllByText(/background suppression pulse time/i).length).toBeGreaterThan(0);
  });

  it("hides BackgroundSuppressionPulseTime when M0 is not UseControlAsM0", () => {
    const { container } = renderWithMantine(
      <M0SectionWrapper
        dataPar={{ M0: "Absent", BackgroundSuppressionNumberPulses: 2 }}
        onFieldChange={() => {}}
      />,
    );
    const labels = container.querySelectorAll("label");
    const found = Array.from(labels).some((l) =>
      l.textContent?.toLowerCase().includes("pulse time"),
    );
    expect(found).toBe(false);
  });

  it("hides BackgroundSuppressionPulseTime when pulses is 0", () => {
    const { container } = renderWithMantine(
      <M0SectionWrapper
        dataPar={{ M0: "UseControlAsM0", BackgroundSuppressionNumberPulses: 0 }}
        onFieldChange={() => {}}
      />,
    );
    const labels = container.querySelectorAll("label");
    const found = Array.from(labels).some((l) =>
      l.textContent?.toLowerCase().includes("pulse time"),
    );
    expect(found).toBe(false);
  });

  it("renders basic fields and shows advanced fields when toggled on", () => {
    renderWithMantine(<M0SectionWrapper dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.getAllByText(/m0 source/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/background suppression pulses/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/grey-matter scale factor/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/register m0 to asl/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("switch", { name: /show advanced/i }));
    expect(screen.getAllByText(/conventional m0/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/m0 repetition time/i).length).toBeGreaterThan(0);
  });

  it("calls onFieldChange when bRegisterM02ASL is toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(<M0SectionWrapper dataPar={emptyState} onFieldChange={onFieldChange} />);
    fireEvent.click(screen.getByRole("switch", { name: /register m0 to asl/i }));
    expect(onFieldChange).toHaveBeenCalledWith("bRegisterM02ASL", expect.any(Number));
  });

  it("calls onToggleAdvanced when Show advanced is toggled", () => {
    const onToggle = vi.fn();
    renderWithMantine(
      <M0Section
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
