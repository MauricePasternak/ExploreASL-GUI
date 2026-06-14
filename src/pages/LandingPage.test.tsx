import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { notifications } from "@mantine/notifications";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { PROJECT_FILE_NAME } from "../schemas/project";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import LandingPage from "./LandingPage";

describe("LandingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGlobalStore.setState({
      loaded: true,
      settings: DEFAULT_SETTINGS,
    });
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
    });
    vi.mocked(open).mockResolvedValue(null);
    vi.mocked(exists).mockResolvedValue(false);
    vi.mocked(invoke).mockResolvedValue(true);
  });

  it("renders the primary landing actions", async () => {
    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { name: /welcome to exploreasl/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open project/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/no recent projects/i)).toBeInTheDocument();
    });
  });

  it("rejects project creation when the selected directory is not writable", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/no-write");
    vi.mocked(invoke).mockResolvedValue(false);

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("is_writable", { path: "/tmp/no-write" });
      expect(createProject).not.toHaveBeenCalled();
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
        }),
      );
    });
  });

  it("rejects project creation when an easl file already exists", async () => {
    const createProject = vi.fn();
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/existing-project");
    vi.mocked(invoke).mockResolvedValue(true);
    vi.mocked(exists).mockImplementation(async (path) => {
      return path === `/tmp/existing-project/${PROJECT_FILE_NAME}`;
    });

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(createProject).not.toHaveBeenCalled();
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: expect.stringMatching(/project exists/i),
        }),
      );
    });
  });

  it("shows an error when project creation fails unexpectedly", async () => {
    const createProject = vi.fn().mockRejectedValue(new Error("write failed"));
    useProjectStore.setState({ createProject });
    vi.mocked(open).mockResolvedValue("/tmp/new-project");
    vi.mocked(invoke).mockResolvedValue(true);

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /new project/i })[0]);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("/tmp/new-project", "new-project");
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: expect.stringMatching(/failed to create project/i),
        }),
      );
    });
  });

  it("rejects opening easl files that are not named project.easl", async () => {
    const loadProject = vi.fn().mockRejectedValue(new Error("Expected project.easl"));
    useProjectStore.setState({ loadProject });
    vi.mocked(open).mockResolvedValue("/tmp/custom-name.easl");

    render(
      <MantineProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /open project/i })[0]);

    await waitFor(() => {
      expect(loadProject).toHaveBeenCalledWith("/tmp/custom-name.easl");
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: expect.stringMatching(/invalid project file/i),
        }),
      );
    });
  });
});
