import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";

import { ApplyQuantificationGroup } from "./ApplyQuantificationGroup";

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("ApplyQuantificationGroup", () => {
  it("renders all 6 checkboxes", () => {
    renderWithMantine(<ApplyQuantificationGroup value={undefined} onChange={() => {}} />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(6);
  });

  it("defaults all checkboxes to checked when value is undefined", () => {
    renderWithMantine(<ApplyQuantificationGroup value={undefined} onChange={() => {}} />);

    const checkboxes = screen.getAllByRole("checkbox");
    const checked = checkboxes.filter((cb) => (cb as HTMLInputElement).checked);
    expect(checked.length).toBeGreaterThanOrEqual(6);
  });

  it("toggles all off via deselect checkbox", () => {
    const onChange = vi.fn();
    const { container } = renderWithMantine(
      <ApplyQuantificationGroup value={[1, 1, 1, 1, 1, 1]} onChange={onChange} />,
    );

    const labels = container.querySelectorAll(".mantine-Checkbox-label");
    // First label is the "Deselect all" checkbox
    fireEvent.click(labels[0]);
    expect(onChange).toHaveBeenCalledWith([0, 0, 0, 0, 0, 0]);
  });

  it("toggles all on via select checkbox", () => {
    const onChange = vi.fn();
    const { container } = renderWithMantine(
      <ApplyQuantificationGroup value={[0, 0, 0, 0, 0, 0]} onChange={onChange} />,
    );

    const labels = container.querySelectorAll(".mantine-Checkbox-label");
    fireEvent.click(labels[0]);
    expect(onChange).toHaveBeenCalledWith([1, 1, 1, 1, 1, 1]);
  });

  it("toggles individual checkbox", () => {
    const onChange = vi.fn();
    const { container } = renderWithMantine(
      <ApplyQuantificationGroup value={[1, 1, 1, 1, 1, 1]} onChange={onChange} />,
    );

    const labels = container.querySelectorAll(".mantine-Checkbox-label");
    fireEvent.click(labels[0]);
    expect(onChange).toHaveBeenCalled();
  });

  it("renders correct labels", () => {
    renderWithMantine(<ApplyQuantificationGroup value={[1, 1, 1, 1, 1, 1]} onChange={() => {}} />);

    expect(
      screen.getAllByText("Apply pixel intensity scaling to ASL timeseries").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Divide perfusion signal by M0").length).toBeGreaterThan(0);
  });
});
