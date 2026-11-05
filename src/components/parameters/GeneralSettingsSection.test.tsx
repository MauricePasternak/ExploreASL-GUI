import { useState } from "react";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../test/render";

import { GeneralSettingsSection } from "./GeneralSettingsSection";
import type { DataParState } from "../../schemas/dataParSchema";

afterEach(() => cleanup());

const emptyState: DataParState = {};

function GeneralSettingsSectionWrapper({
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
    <GeneralSettingsSection
      dataPar={dataPar}
      onFieldChange={onFieldChange}
      showAdvanced={showAdvanced}
      onToggleAdvanced={onToggleAdvanced ?? (() => setShowAdvanced(!showAdvanced))}
    />
  );
}

describe("GeneralSettingsSection", () => {
  it("renders basic fields and shows advanced fields when toggled on", () => {
    renderWithMantine(
      <GeneralSettingsSectionWrapper dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/processing quality/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("switch", { name: /show advanced/i }));
    expect(screen.getAllByText(/delete temporary/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/skip if no flair/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/skip if no asl/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/skip if no m0/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/lesion filling/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/auto ac-pc/i).length).toBeGreaterThan(0);
  });

  it("calls onFieldChange when DELETETEMP toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(
      <GeneralSettingsSectionWrapper dataPar={emptyState} onFieldChange={onFieldChange} />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /show advanced/i }));
    fireEvent.click(screen.getByRole("switch", { name: /delete temporary/i }));
    expect(onFieldChange).toHaveBeenCalledWith("DELETETEMP", expect.any(Number));
  });

  it("calls onToggleAdvanced when Show advanced is toggled", () => {
    const onToggle = vi.fn();
    renderWithMantine(
      <GeneralSettingsSection
        dataPar={emptyState}
        onFieldChange={() => {}}
        showAdvanced={false}
        onToggleAdvanced={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /show advanced/i }));
    expect(onToggle).toHaveBeenCalled();
  });

  describe("enableMetadataGroupingCorrection switch option", () => {
    it("renders switch and does not render warning when disabled", () => {
      renderWithMantine(
        <GeneralSettingsSectionWrapper
          dataPar={{ enableMetadataGroupingCorrection: false }}
          onFieldChange={() => {}}
        />,
      );
      expect(screen.getByTestId("field-enableMetadataGroupingCorrection")).toBeInTheDocument();
      expect(screen.getByTestId("field-enableMetadataGroupingCorrection")).not.toBeChecked();
      expect(screen.queryByTestId("participants-warning-callout")).not.toBeInTheDocument();
    });

    it("calls onFieldChange when switch is toggled", () => {
      const onFieldChange = vi.fn();
      renderWithMantine(
        <GeneralSettingsSectionWrapper
          dataPar={{ enableMetadataGroupingCorrection: false }}
          onFieldChange={onFieldChange}
        />,
      );
      const input = screen.getByTestId("field-enableMetadataGroupingCorrection");
      fireEvent.click(input);
      expect(onFieldChange).toHaveBeenCalledWith("enableMetadataGroupingCorrection", true);
    });

    it("renders warning callout when enabled", () => {
      renderWithMantine(
        <GeneralSettingsSectionWrapper
          dataPar={{ enableMetadataGroupingCorrection: true }}
          onFieldChange={() => {}}
        />,
      );
      expect(screen.getByTestId("field-enableMetadataGroupingCorrection")).toBeChecked();
      expect(screen.getByTestId("participants-warning-callout")).toBeInTheDocument();
      expect(
        screen.getByText(/will enact site-scanner correction on that basis/i),
      ).toBeInTheDocument();
    });
  });
});
