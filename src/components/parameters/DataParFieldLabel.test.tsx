import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it } from "vitest";

import { DataParFieldLabel } from "./DataParFieldLabel";

describe("DataParFieldLabel", () => {
  it("renders the label text from FIELD_METADATA", () => {
    render(
      <MantineProvider>
        <DataParFieldLabel fieldKey="M0" />
      </MantineProvider>,
    );

    expect(screen.getByText("M0 source")).toBeInTheDocument();
  });

  it("shows tooltip with description on hover", async () => {
    render(
      <MantineProvider>
        <DataParFieldLabel fieldKey="M0" />
      </MantineProvider>,
    );

    const icons = screen.getAllByRole("img", { name: /info for M0 source/i });
    await userEvent.hover(icons[0]);

    expect(
      screen.getByText(/M0 handling strategy/i),
    ).toBeInTheDocument();
  });

  it("renders label for a different field key", () => {
    render(
      <MantineProvider>
        <DataParFieldLabel fieldKey="Lambda" />
      </MantineProvider>,
    );

    expect(screen.getByText("Blood-brain partition coefficient")).toBeInTheDocument();
  });
});
