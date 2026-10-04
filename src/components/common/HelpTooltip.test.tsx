import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, describe, expect, it } from "vitest";

import HelpTooltip from "./HelpTooltip";

afterEach(cleanup);

describe("HelpTooltip", () => {
  it("reveals explanatory text on hover", async () => {
    render(
      <MantineProvider env="test">
        <HelpTooltip
          label="What does this mean?"
          tooltip="This is the longer explanation shown on demand."
        />
      </MantineProvider>,
    );

    await userEvent.hover(screen.getByRole("button", { name: /what does this mean/i }));

    expect(screen.getByText("This is the longer explanation shown on demand.")).toBeInTheDocument();
  });

  it("renders a wider tooltip panel for longer guidance", async () => {
    render(
      <MantineProvider env="test">
        <HelpTooltip
          label="Tooltip width"
          tooltip="This tooltip should have enough width to wrap useful help text comfortably."
        />
      </MantineProvider>,
    );

    await userEvent.hover(screen.getByRole("button", { name: /tooltip width/i }));

    const tooltips = screen.getAllByRole("tooltip");
    expect(tooltips[tooltips.length - 1]).toHaveStyle({ width: "352px" });
  });
});
