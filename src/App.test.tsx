import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "./schemas/globalSettings";
import { useGlobalStore } from "./stores/globalStore";
import { useProjectStore } from "./stores/projectStore";
import App from "./App";

vi.mock("./components/SettingsModal", () => ({
  default: () => <div data-testid="mock-settings-modal" />,
}));

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

  afterEach(() => {
    cleanup();
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

  it("renders the loading gate when loaded is false", () => {
    useGlobalStore.setState({
      loaded: false,
    });

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByTestId("app-loading-gate")).toBeInTheDocument();
    expect(screen.getByText("ExploreASL GUI")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /welcome to exploreasl/i }),
    ).not.toBeInTheDocument();
  });
});
