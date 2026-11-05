import { useState } from "react";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../test/render";

import { ASLProcessingSection } from "./ASLProcessingSection";
import type { DataParState } from "../../schemas/dataParSchema";

afterEach(() => cleanup());

const emptyState: DataParState = {};

function ASLProcessingSectionWrapper({
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
    <ASLProcessingSection
      dataPar={dataPar}
      onFieldChange={onFieldChange}
      showAdvanced={showAdvanced}
      onToggleAdvanced={onToggleAdvanced ?? (() => setShowAdvanced(!showAdvanced))}
    />
  );
}

describe("ASLProcessingSection", () => {
  it("renders basic fields and shows advanced fields when toggled on", () => {
    renderWithMantine(
      <ASLProcessingSectionWrapper dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/motion correction/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/fsl topup/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/partial volume correction/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/save 4d cbf/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("switch", { name: /show advanced/i }));
    expect(screen.getAllByText(/spike removal threshold/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/registration contrast/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/registration method/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/dct registration/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/use mni as dummy/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/apply quantification/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("field-SpikeRemovalAbsoluteThreshold")).toHaveAttribute(
      "placeholder",
      "Unset: use relative threshold",
    );
    fireEvent.click(screen.getByTestId("field-bRegistrationContrast"));
    expect(
      screen.getByText("Combined control and CBF registration (automatic)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Combined registration with forced CBF attempt")).toBeInTheDocument();
  });

  it("calls onFieldChange when motionCorrection toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(
      <ASLProcessingSectionWrapper dataPar={emptyState} onFieldChange={onFieldChange} />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /motion correction/i }));
    expect(onFieldChange).toHaveBeenCalledWith("motionCorrection", expect.any(Number));
  });

  it("calls onToggleAdvanced when Show advanced is toggled", () => {
    const onToggle = vi.fn();
    renderWithMantine(
      <ASLProcessingSection
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
