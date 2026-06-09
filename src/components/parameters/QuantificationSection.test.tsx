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
  const labelBody = switchRoot?.querySelector(".mantine-Switch-body");
  fireEvent.click(labelBody!);
}

afterEach(() => cleanup());

const emptyState: DataParState = {};

describe("QuantificationSection", () => {
  it("renders nCompartments field", () => {
    renderWithMantine(
      <QuantificationSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/number of compartments/i).length).toBeGreaterThan(0);
  });

  it("renders Show advanced toggle", () => {
    renderWithMantine(
      <QuantificationSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    expect(screen.getAllByText(/show advanced/i).length).toBeGreaterThan(0);
  });

  it("shows advanced fields when toggled on", () => {
    renderWithMantine(
      <QuantificationSection dataPar={emptyState} onFieldChange={() => {}} />,
    );
    clickSwitch(/show advanced/i);
    expect(screen.getAllByText(/blood-brain partition/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/t1 of arterial blood/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/use external quantification/i).length).toBeGreaterThan(0);
  });

  it("shows external quantification subtree when bUseExternalQuantification is true", () => {
    renderWithMantine(
      <QuantificationSection
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
      <QuantificationSection
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
      <QuantificationSection dataPar={emptyState} onFieldChange={onFieldChange} />,
    );
    clickSwitch(/show advanced/i);
    clickSwitch(/use external quantification/i);
    expect(onFieldChange).toHaveBeenCalledWith("bUseExternalQuantification", expect.any(Boolean));
  });
});
