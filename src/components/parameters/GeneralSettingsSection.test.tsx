import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GeneralSettingsSection } from "./GeneralSettingsSection";
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

describe("GeneralSettingsSection", () => {
  it("renders Quality field", () => {
    renderWithMantine(
      <GeneralSettingsSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/processing quality/i).length).toBeGreaterThan(0);
  });

  it("renders Show advanced toggle", () => {
    renderWithMantine(
      <GeneralSettingsSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
  });

  it("shows advanced fields when toggled on", () => {
    renderWithMantine(
      <GeneralSettingsSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    clickSwitch(/show advanced/i);
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
      <GeneralSettingsSection dataPar={emptyState} onFieldChange={onFieldChange} />,
    );
    clickSwitch(/show advanced/i);
    clickSwitch(/delete temporary/i);
    expect(onFieldChange).toHaveBeenCalledWith("DELETETEMP", expect.any(Boolean));
  });
});
