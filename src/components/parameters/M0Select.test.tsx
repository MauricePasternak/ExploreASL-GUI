import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";

import { M0Select } from "./M0Select";

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("M0Select", () => {
  it("renders with M0 options", () => {
    renderWithMantine(<M0Select value={undefined} onChange={() => {}} />);

    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
  });

  it("selects a named option", () => {
    renderWithMantine(<M0Select value="Absent" onChange={() => {}} />);

    const inputs = screen.getAllByRole("combobox");
    const selectInput = inputs.find((el) => (el as HTMLInputElement).value.includes("Absent"));
    expect(selectInput).toBeDefined();
  });

  it("shows custom NumberInput when __custom__ is selected", () => {
    const { container } = renderWithMantine(<M0Select value="__custom__" onChange={() => {}} />);

    const numberInput = container.querySelector(".mantine-NumberInput-input");
    expect(numberInput).toBeInTheDocument();
  });

  it("shows custom NumberInput when value is a number", () => {
    const { container } = renderWithMantine(<M0Select value={42} onChange={() => {}} />);

    const numberInput = container.querySelector(".mantine-NumberInput-input");
    expect(numberInput).toBeInTheDocument();
  });

  it("calls onChange when custom number is entered", () => {
    const onChange = vi.fn();
    const { container } = renderWithMantine(<M0Select value="__custom__" onChange={onChange} />);

    const numberInput = container.querySelector(".mantine-NumberInput-input") as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: "50" } });
    expect(onChange).toHaveBeenCalled();
  });
});
