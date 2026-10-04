import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, describe, expect, it } from "vitest";

import { DataParFieldLabel } from "./DataParFieldLabel";

afterEach(cleanup);

describe("DataParFieldLabel", () => {
  it("renders the label text from FIELD_METADATA", () => {
    render(
      <MantineProvider env="test">
        <DataParFieldLabel fieldKey="M0" />
      </MantineProvider>,
    );

    expect(screen.getByText("M0 source")).toBeInTheDocument();
  });

  it("shows tooltip with description on hover", async () => {
    render(
      <MantineProvider env="test">
        <DataParFieldLabel fieldKey="M0" />
      </MantineProvider>,
    );

    const icons = screen.getAllByRole("img", { name: /info for M0 source/i });
    await userEvent.hover(icons[0]);

    expect(screen.getByText(/equilibrium magnetization/i)).toBeInTheDocument();
  });

  it("renders label for a different field key", () => {
    render(
      <MantineProvider env="test">
        <DataParFieldLabel fieldKey="Lambda" />
      </MantineProvider>,
    );

    expect(screen.getByText("Blood-brain partition coefficient (λ)")).toBeInTheDocument();
  });
});
