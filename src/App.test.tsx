import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "./schemas/globalSettings";
import { useGlobalStore } from "./stores/globalStore";
import { useProjectStore } from "./stores/projectStore";
import App from "./App";

describe("App", () => {
  beforeEach(() => {
    useGlobalStore.setState({
      loaded: true,
      settings: DEFAULT_SETTINGS,
    });
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
    });
  });

  it("renders the landing page at the root route", () => {
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { name: /welcome to exploreasl/i })).toBeInTheDocument();
  });
});
