import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { exists } from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestMantineProvider as MantineProvider } from "../../test/render";

import { DEFAULT_SETTINGS } from "../../schemas/globalSettings";
import { useGlobalStore } from "../../stores/globalStore";
import RecentProjectsList from "./RecentProjectsList";

describe("RecentProjectsList", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useGlobalStore.setState({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        recentProjects: [
          { path: "/tmp/available/project.easl", projectId: "available" },
          { path: "/tmp/missing/project.easl", projectId: "missing" },
        ],
      },
    });

    vi.mocked(exists).mockImplementation(async (path) => path === "/tmp/available/project.easl");
  });

  it("renders availability state for recent projects", async () => {
    render(
      <MantineProvider env="test">
        <RecentProjectsList onOpen={() => undefined} />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Available")).toBeInTheDocument();
      expect(screen.getByText("Moved or deleted")).toBeInTheDocument();
      expect(screen.getByText("available")).toBeInTheDocument();
    });
  });

  it("shows an empty message when there are no recent projects", async () => {
    useGlobalStore.setState({
      loaded: true,
      settings: DEFAULT_SETTINGS,
    });

    render(
      <MantineProvider env="test">
        <RecentProjectsList onOpen={() => undefined} />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/no recent projects/i)).toBeInTheDocument();
    });
  });

  it("prompts to remove stale projects when opened", async () => {
    const onOpen = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MantineProvider env="test">
        <RecentProjectsList onOpen={onOpen} />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Moved or deleted").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /open/i })[1]);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
      expect(useGlobalStore.getState().settings.recentProjects).toEqual([
        { path: "/tmp/available/project.easl", projectId: "available" },
      ]);
    });

    confirmSpy.mockRestore();
  });
});
