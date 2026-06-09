import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { M0Section } from "./M0Section";
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

describe("M0Section", () => {
  it("renders M0 source label", () => {
    renderWithMantine(
      <M0Section dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/m0 source/i).length).toBeGreaterThan(0);
  });

  it("renders BackgroundSuppressionNumberPulses field", () => {
    renderWithMantine(
      <M0Section dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/background suppression pulses/i).length).toBeGreaterThan(0);
  });

  it("renders M0_GMScaleFactor field", () => {
    renderWithMantine(
      <M0Section dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/grey-matter scale factor/i).length).toBeGreaterThan(0);
  });

  it("renders bRegisterM02ASL toggle", () => {
    renderWithMantine(
      <M0Section dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/register m0 to asl/i).length).toBeGreaterThan(0);
  });

  it("shows BackgroundSuppressionPulseTime when condition met", () => {
    renderWithMantine(
      <M0Section
        dataPar={{ M0: "UseControlAsM0", BackgroundSuppressionNumberPulses: 2 }}
        onFieldChange={() => {}}
      />,
    );
    expect(screen.getAllByText(/background suppression pulse time/i).length).toBeGreaterThan(0);
  });

  it("hides BackgroundSuppressionPulseTime when M0 is not UseControlAsM0", () => {
    const { container } = renderWithMantine(
      <M0Section
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
      <M0Section
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

  it("renders Show advanced toggle", () => {
    renderWithMantine(
      <M0Section dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
  });

  it("shows advanced fields when advanced is toggled on", () => {
    renderWithMantine(
      <M0Section dataPar={emptyState} onFieldChange={() => {}} />,
    );
    clickSwitch(/show advanced/i);
    expect(screen.getAllByText(/conventional m0 processing/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/tr of m0 preparation/i).length).toBeGreaterThan(0);
  });

  it("calls onFieldChange when bRegisterM02ASL is toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(
      <M0Section dataPar={emptyState} onFieldChange={onFieldChange} />,
    );
    clickSwitch(/register m0 to asl/i);
    expect(onFieldChange).toHaveBeenCalledWith("bRegisterM02ASL", expect.any(Boolean));
  });
});
