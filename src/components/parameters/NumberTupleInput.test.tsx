import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NumberTupleInput } from "./NumberTupleInput";

afterEach(cleanup);

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

/** Get the visible (not aria-hidden) input by testid. */
function getVisibleInput(testId: string): HTMLInputElement {
  const candidates = screen.getAllByTestId(testId);
  for (const el of candidates) {
    const input = el as HTMLInputElement;
    if (input.getAttribute("aria-hidden") !== "true" && input.type !== "hidden") {
      return input;
    }
  }
  return candidates[0] as HTMLInputElement;
}

describe("NumberTupleInput", () => {
  it("renders three labeled NumberInputs with default X/Y/Z labels", () => {
    renderWithMantine(<NumberTupleInput value={[5, 10, 15]} onChange={() => {}} testId="kernel" />);

    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText("Y")).toBeInTheDocument();
    expect(screen.getByText("Z")).toBeInTheDocument();
  });

  it("renders custom labels when provided", () => {
    renderWithMantine(
      <NumberTupleInput
        value={[5, 5, 1]}
        onChange={() => {}}
        labels={["LR", "AP", "IS"]}
        testId="smooth"
      />,
    );

    expect(screen.getByText("LR")).toBeInTheDocument();
    expect(screen.getByText("AP")).toBeInTheDocument();
    expect(screen.getByText("IS")).toBeInTheDocument();
  });

  it("displays existing values", () => {
    renderWithMantine(<NumberTupleInput value={[5, 10, 15]} onChange={() => {}} testId="kernel" />);

    expect(getVisibleInput("kernel-X").value).toBe("5");
    expect(getVisibleInput("kernel-Y").value).toBe("10");
    expect(getVisibleInput("kernel-Z").value).toBe("15");
  });

  it("falls back to placeholder when value is undefined", () => {
    renderWithMantine(
      <NumberTupleInput
        value={undefined}
        onChange={() => {}}
        placeholder={[1, 2, 3]}
        testId="kernel"
      />,
    );

    const inputX = getVisibleInput("kernel-X");
    expect(inputX.value).toBe("");
    expect(inputX.placeholder).toBe("1");
    expect(getVisibleInput("kernel-Y").placeholder).toBe("2");
    expect(getVisibleInput("kernel-Z").placeholder).toBe("3");
  });

  it("calls onChange with updated tuple when first input changes", () => {
    const onChange = vi.fn();
    renderWithMantine(<NumberTupleInput value={[5, 10, 15]} onChange={onChange} testId="kernel" />);

    const input = getVisibleInput("kernel-X");
    fireEvent.change(input, { target: { value: "7" } });

    expect(onChange).toHaveBeenLastCalledWith([7, 10, 15]);
  });

  it("calls onChange with updated tuple when second input changes", () => {
    const onChange = vi.fn();
    renderWithMantine(<NumberTupleInput value={[5, 10, 15]} onChange={onChange} testId="kernel" />);

    const input = getVisibleInput("kernel-Y");
    fireEvent.change(input, { target: { value: "20" } });

    expect(onChange).toHaveBeenLastCalledWith([5, 20, 15]);
  });

  it("calls onChange with updated tuple when third input changes", () => {
    const onChange = vi.fn();
    renderWithMantine(<NumberTupleInput value={[5, 10, 15]} onChange={onChange} testId="kernel" />);

    const input = getVisibleInput("kernel-Z");
    fireEvent.change(input, { target: { value: "30" } });

    expect(onChange).toHaveBeenLastCalledWith([5, 10, 30]);
  });

  it("applies integer-only mode — strips decimals", () => {
    const onChange = vi.fn();
    renderWithMantine(
      <NumberTupleInput value={[5, 5, 5]} onChange={onChange} integerOnly testId="kernel" />,
    );

    const input = getVisibleInput("kernel-X");
    fireEvent.change(input, { target: { value: "3.7" } });

    expect(onChange).toHaveBeenLastCalledWith([3, 5, 5]);
  });

  it("sets data-testid on each input with axis suffix", () => {
    renderWithMantine(
      <NumberTupleInput
        value={[5, 10, 15]}
        onChange={() => {}}
        testId="field-PVCNativeSpaceKernel"
      />,
    );

    expect(screen.getAllByTestId("field-PVCNativeSpaceKernel-X").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("field-PVCNativeSpaceKernel-Y").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("field-PVCNativeSpaceKernel-Z").length).toBeGreaterThan(0);
  });

  it("uses axis index suffix when custom labels are provided", () => {
    renderWithMantine(
      <NumberTupleInput
        value={[5, 5, 1]}
        onChange={() => {}}
        labels={["LR", "AP", "IS"]}
        testId="field-ExternalQuantificationSmoothGaussianMM"
      />,
    );

    expect(
      screen.getAllByTestId("field-ExternalQuantificationSmoothGaussianMM-0").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByTestId("field-ExternalQuantificationSmoothGaussianMM-1").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByTestId("field-ExternalQuantificationSmoothGaussianMM-2").length,
    ).toBeGreaterThan(0);
  });
});
