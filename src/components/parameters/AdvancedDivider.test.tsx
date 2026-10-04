import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdvancedDivider } from "./AdvancedDivider";

afterEach(cleanup);

describe("AdvancedDivider", () => {
  it("renders with 'Show advanced' label", () => {
    render(
      <MantineProvider env="test">
        <AdvancedDivider showAdvanced={false} onToggle={() => {}} />
      </MantineProvider>,
    );

    expect(screen.getAllByText("Show advanced").length).toBeGreaterThan(0);
  });

  it("calls onToggle when switch input is clicked", () => {
    const onToggle = vi.fn();
    render(
      <MantineProvider env="test">
        <AdvancedDivider showAdvanced={false} onToggle={onToggle} />
      </MantineProvider>,
    );

    const inputs = document.querySelectorAll('input[role="switch"]');
    for (const input of inputs) {
      fireEvent.click(input as HTMLInputElement);
    }
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders switch as checked when showAdvanced is true", () => {
    render(
      <MantineProvider env="test">
        <AdvancedDivider showAdvanced={true} onToggle={() => {}} />
      </MantineProvider>,
    );

    const inputs = document.querySelectorAll('input[role="switch"]');
    const checkedInput = Array.from(inputs).find(
      (el) => el.getAttribute("data-checked") === "true",
    );
    expect(checkedInput).toBeDefined();
  });
});
