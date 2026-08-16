import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { seedValidProfileGate } from "./test/landingProfileGate";
import { useGlobalStore } from "./stores/globalStore";
import { useProjectStore } from "./stores/projectStore";
import App from "./App";

vi.mock("./components/settings/SettingsModal", () => ({
  default: () => <div data-testid="mock-settings-modal" />,
}));

describe("App", () => {
  beforeEach(() => {
    seedValidProfileGate();
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

  it("loads settings without E2E options", async () => {
    const loadSettings = vi.fn(() => Promise.resolve());
    useGlobalStore.setState({ loadSettings });

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => expect(loadSettings).toHaveBeenCalledOnce());
  });

  it("skips settings loading and reports ready location with E2E options", async () => {
    const loadSettings = vi.fn(() => Promise.resolve());
    const onReady = vi.fn();
    useGlobalStore.setState({ loadSettings });

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/"]}>
          <App e2e={{ enabled: true, onReady }} />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(loadSettings).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/" })),
    );
  });
});
