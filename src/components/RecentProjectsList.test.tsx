import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { exists } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useGlobalStore } from "../stores/globalStore";
import RecentProjectsList from "./RecentProjectsList";

describe("RecentProjectsList", () => {
  beforeEach(() => {
    useGlobalStore.setState({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        recentProjects: ["/tmp/available/project.easl", "/tmp/missing/project.easl"],
      },
    });

    vi.mocked(exists).mockImplementation(async (path) => path === "/tmp/available/project.easl");
  });

  it("renders availability state for recent projects", async () => {
    render(
      <MantineProvider>
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
      <MantineProvider>
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
      <MantineProvider>
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
        "/tmp/available/project.easl",
      ]);
    });

    confirmSpy.mockRestore();
  });
});
