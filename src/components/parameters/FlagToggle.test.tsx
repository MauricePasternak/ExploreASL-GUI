import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FlagToggle } from "./FlagToggle";

afterEach(cleanup);

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("FlagToggle", () => {
  it("renders a switch with label", () => {
    renderWithMantine(
      <FlagToggle
        fieldKey="bRegisterM02ASL"
        value={1}
        onChange={() => {}}
        testId="field-bRegisterM02ASL"
      />,
    );

    expect(screen.getByTestId("field-bRegisterM02ASL")).toBeInTheDocument();
    expect(screen.getAllByText(/register m0 to asl/i).length).toBeGreaterThan(0);
  });

  it("is checked when value is 1", () => {
    renderWithMantine(
      <FlagToggle
        fieldKey="bRegisterM02ASL"
        value={1}
        onChange={() => {}}
        testId="field-bRegisterM02ASL"
      />,
    );

    expect(screen.getByTestId("field-bRegisterM02ASL")).toBeChecked();
  });

  it("is unchecked when value is 0", () => {
    renderWithMantine(
      <FlagToggle
        fieldKey="bRegisterM02ASL"
        value={0}
        onChange={() => {}}
        testId="field-bRegisterM02ASL"
      />,
    );

    expect(screen.getByTestId("field-bRegisterM02ASL")).not.toBeChecked();
  });

  it("is unchecked when value is undefined (no default)", () => {
    renderWithMantine(
      <FlagToggle
        fieldKey="bRegisterM02ASL"
        value={undefined}
        onChange={() => {}}
        testId="field-bRegisterM02ASL"
      />,
    );

    expect(screen.getByTestId("field-bRegisterM02ASL")).not.toBeChecked();
  });

  it("is checked when value is undefined with default=true", () => {
    renderWithMantine(
      <FlagToggle
        fieldKey="motionCorrection"
        value={undefined}
        defaultValue={true}
        onChange={() => {}}
        testId="field-motionCorrection"
      />,
    );

    expect(screen.getByTestId("field-motionCorrection")).toBeChecked();
  });

  it("is checked when value is true", () => {
    renderWithMantine(
      <FlagToggle
        fieldKey="bRegisterM02ASL"
        value={true as unknown as 0 | 1}
        onChange={() => {}}
        testId="field-bRegisterM02ASL"
      />,
    );

    expect(screen.getByTestId("field-bRegisterM02ASL")).toBeChecked();
  });

  it("calls onChange with 1 when toggled on", () => {
    const onChange = vi.fn();
    renderWithMantine(
      <FlagToggle
        fieldKey="bRegisterM02ASL"
        value={0}
        onChange={onChange}
        testId="field-bRegisterM02ASL"
      />,
    );

    fireEvent.click(screen.getByTestId("field-bRegisterM02ASL"));

    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("calls onChange with 0 when toggled off", () => {
    const onChange = vi.fn();
    renderWithMantine(
      <FlagToggle
        fieldKey="bRegisterM02ASL"
        value={1}
        onChange={onChange}
        testId="field-bRegisterM02ASL"
      />,
    );

    fireEvent.click(screen.getByTestId("field-bRegisterM02ASL"));

    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});
