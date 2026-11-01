import { screen, fireEvent, cleanup } from "@testing-library/react";
import { TestMantineProvider as MantineProvider, renderWithMantine } from "../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommaNumberInput, CommaArrayInput } from "./CommaNumberInput";

afterEach(() => cleanup());

describe("CommaNumberInput", () => {
  it("renders and parses numbers, arrays, and empty input", () => {
    const handleChange = vi.fn();
    renderWithMantine(<CommaNumberInput label="Test Label" value={1.5} onChange={handleChange} />);

    expect(screen.getByText("Test Label")).toBeDefined();
    expect(screen.getByDisplayValue("1.5")).toBeDefined();

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(handleChange).toHaveBeenLastCalledWith(2.5);

    fireEvent.change(input, { target: { value: "1.5, 2.0, 3" } });
    expect(handleChange).toHaveBeenLastCalledWith([1.5, 2, 3]);

    fireEvent.change(input, { target: { value: "" } });
    expect(handleChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe("CommaArrayInput", () => {
  it("renders comma-separated values and calls onChange with parsed array", () => {
    const handleChange = vi.fn();
    renderWithMantine(
      <CommaArrayInput label="Test Label" value={[1, 2]} onChange={handleChange} />,
    );

    expect(screen.getByDisplayValue("1, 2")).toBeDefined();

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "1, 2, 3" } });
    expect(handleChange).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("does not revert local text while input is focused during editing", () => {
    const handleChange = vi.fn();
    const { rerender } = renderWithMantine(
      <CommaArrayInput label="Test Label" value={[2, 4]} onChange={handleChange} />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "4" } });
    expect(handleChange).toHaveBeenCalledWith([4]);

    // Rerender with initial prop value while focused (simulating form validation state fallback)
    rerender(
      <MantineProvider env="test">
        <CommaArrayInput label="Test Label" value={[2, 4]} onChange={handleChange} />
      </MantineProvider>,
    );
    expect((input as HTMLInputElement).value).toBe("4");
  });

  it("does not revert local text on blur after clearing input", () => {
    const handleChange = vi.fn();
    renderWithMantine(
      <CommaArrayInput label="Test Label" value={[2, 4]} onChange={handleChange} />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(handleChange).toHaveBeenCalledWith(undefined);

    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("");
  });
});
