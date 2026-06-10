import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommaNumberInput, CommaArrayInput } from "./CommaNumberInput";

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

afterEach(() => cleanup());

describe("CommaNumberInput", () => {
  it("renders with correct label and initial value", () => {
    renderWithMantine(
      <CommaNumberInput
        label="Test Label"
        value={1.5}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText("Test Label")).toBeDefined();
    expect(screen.getByDisplayValue("1.5")).toBeDefined();
  });

  it("calls onChange with parsed number on numeric input change", () => {
    const handleChange = vi.fn();
    renderWithMantine(
      <CommaNumberInput
        label="Test Label"
        value={1.5}
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(handleChange).toHaveBeenCalledWith(2.5);
  });

  it("calls onChange with array on comma separated numbers", () => {
    const handleChange = vi.fn();
    renderWithMantine(
      <CommaNumberInput
        label="Test Label"
        value={1.5}
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "1.5, 2.0, 3" } });
    expect(handleChange).toHaveBeenCalledWith([1.5, 2, 3]);
  });

  it("calls onChange with undefined on empty input", () => {
    const handleChange = vi.fn();
    renderWithMantine(
      <CommaNumberInput
        label="Test Label"
        value={1.5}
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "" } });
    expect(handleChange).toHaveBeenCalledWith(undefined);
  });
});

describe("CommaArrayInput", () => {
  it("renders with correct array value formatted as comma-separated list", () => {
    renderWithMantine(
      <CommaArrayInput
        label="Test Label"
        value={[1, 2, 3]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByDisplayValue("1, 2, 3")).toBeDefined();
  });

  it("calls onChange with parsed array on input change", () => {
    const handleChange = vi.fn();
    renderWithMantine(
      <CommaArrayInput
        label="Test Label"
        value={[1, 2]}
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "1, 2, 3" } });
    expect(handleChange).toHaveBeenCalledWith([1, 2, 3]);
  });
});
