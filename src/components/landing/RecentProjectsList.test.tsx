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

  it("renders clear actions and removes projects from the recent list", async () => {
    const onOpen = vi.fn();
    render(
      <MantineProvider env="test">
        <RecentProjectsList onOpen={onOpen} />
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Available")).toBeInTheDocument();
      expect(screen.getByText("Moved or deleted")).toBeInTheDocument();
      expect(screen.getByText("available")).toBeInTheDocument();
    });

    const open = screen.getByRole("button", { name: "Open available" });
    const remove = screen.getByRole("button", { name: "Remove available from recent projects" });
    const availableIcon = screen.getByTestId(
      "recent-project-status-icon--tmp-available-project-easl",
    );
    const missingIcon = screen.getByTestId("recent-project-status-icon--tmp-missing-project-easl");
    expect(availableIcon).toHaveClass("tabler-icon-check");
    expect(availableIcon).toHaveAttribute(
      "stroke",
      "light-dark(var(--mantine-color-green-8), var(--mantine-color-green-4))",
    );
    expect(missingIcon).toHaveClass("tabler-icon-x");
    expect(missingIcon).toHaveAttribute(
      "stroke",
      "light-dark(var(--mantine-color-red-8), var(--mantine-color-red-4))",
    );
    expect(open).toHaveTextContent("Open");
    expect(remove).toHaveTextContent("Remove from list");
    expect(open).toHaveStyle("--button-bg: var(--mantine-color-blue-8)");
    expect(remove).toHaveStyle("--button-bg: var(--mantine-color-red-8)");
    expect(screen.getByTestId("recent-open-icon--tmp-available-project-easl")).toHaveClass(
      "tabler-icon-folder-open",
    );
    expect(screen.getByTestId("recent-remove-icon--tmp-available-project-easl")).toHaveClass(
      "tabler-icon-trash",
    );
    expect(remove).toHaveAttribute(
      "title",
      "Remove from this list only. Project files stay unchanged.",
    );
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("/tmp/available/project.easl");
    fireEvent.click(remove);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Open available" })).not.toBeInTheDocument();
      expect(useGlobalStore.getState().settings.recentProjects).toEqual([
        { path: "/tmp/missing/project.easl", projectId: "missing" },
      ]);
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
