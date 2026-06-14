import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { exists } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useGlobalStore } from "../stores/globalStore";
import SettingsModal from "./SettingsModal";

describe("SettingsModal", () => {
  beforeEach(() => {
    useGlobalStore.setState({
      loaded: true,
      settings: DEFAULT_SETTINGS,
    });
    vi.mocked(invoke).mockResolvedValue([]);
    vi.mocked(exists).mockResolvedValue(true);
  });

  it("adds detected MATLAB installations to the global store", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, _args?: unknown) => {
      if (cmd === "which_matlab") {
        return [
          { id: "matlab-1", label: "MATLAB (/usr/local/bin/matlab)", path: "/usr/local/bin/matlab", version: "R2022b" },
        ];
      }
      return null;
    });

    render(
      <MantineProvider>
        <SettingsModal opened onClose={() => undefined} />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /auto-detect/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("which_matlab");
      const installs = useGlobalStore.getState().settings.matlabInstallations;
      expect(installs).toEqual([
        {
          id: "matlab-1",
          label: "MATLAB (/usr/local/bin/matlab)",
          path: "/usr/local/bin/matlab",
          version: "R2022b",
        },
      ]);
    });
  });

  it("saves settings before closing the modal", async () => {
    const onClose = vi.fn();

    render(
      <MantineProvider>
        <SettingsModal opened onClose={onClose} />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: /settings/i });
    const dialog = dialogs[dialogs.length - 1];
    const saveButtons = within(dialog).getAllByRole("button", { name: /save & close/i });
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("blocks closing when the ExploreASL path is invalid", async () => {
    const onClose = vi.fn();
    useGlobalStore.setState({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        exploreAslPath: "/bad/exploreasl",
      },
    });
    vi.mocked(exists).mockImplementation(async (path) => path === "/bad/exploreasl");

    render(
      <MantineProvider>
        <SettingsModal opened onClose={onClose} />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: /settings/i });
    const dialog = dialogs[dialogs.length - 1];
    const saveButtons = within(dialog).getAllByRole("button", { name: /save & close/i });
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => {
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "yellow",
        }),
      );
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it("adds a custom tokenizer delimiter", async () => {
    render(
      <MantineProvider>
        <SettingsModal opened onClose={() => undefined} />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: /settings/i });
    const dialog = dialogs[dialogs.length - 1];

    fireEvent.change(within(dialog).getByLabelText(/add delimiter/i), {
      target: { value: "-" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /add delimiter/i }));

    await waitFor(() => {
      expect(useGlobalStore.getState().settings.tokenSubDelimiters).toEqual(["_", "-"]);
    });
  });

  it("toggles preserve staging directory for import debug mode", async () => {
    render(
      <MantineProvider>
        <SettingsModal opened onClose={() => undefined} />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: /settings/i });
    const dialog = dialogs[dialogs.length - 1];
    const toggle = within(dialog).getByTestId("settings-preserve-staging-dir");
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(useGlobalStore.getState().settings.import.preserveStagingDir).toBe(true);
    });
  });

  it("ignores duplicate tokenizer delimiters", async () => {
    render(
      <MantineProvider>
        <SettingsModal opened onClose={() => undefined} />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: /settings/i });
    const dialog = dialogs[dialogs.length - 1];

    fireEvent.change(within(dialog).getByLabelText(/add delimiter/i), {
      target: { value: " _ " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /add delimiter/i }));

    await waitFor(() => {
      expect(useGlobalStore.getState().settings.tokenSubDelimiters).toEqual(["_", "-"]);
    });
  });

  it("automatically detects version for custom MATLAB installations when the modal is opened", async () => {
    useGlobalStore.setState({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        matlabInstallations: [
          { id: "manual-1", label: "My MATLAB", path: "/usr/bin/matlab", version: "" },
        ],
      },
    });

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "which_matlab" && args?.customPaths?.includes("/usr/bin/matlab")) {
        return [
          { id: "matlab-0", label: "MATLAB", path: "/usr/bin/matlab", version: "R2023a" },
        ];
      }
      return [];
    });

    render(
      <MantineProvider>
        <SettingsModal opened onClose={() => undefined} />
      </MantineProvider>,
    );

    await waitFor(() => {
      const installs = useGlobalStore.getState().settings.matlabInstallations;
      const customInstall = installs.find((inst) => inst.path === "/usr/bin/matlab");
      expect(customInstall?.version).toBe("R2023a");
    });
  });

  it("clears version and detects new version on path change and blur", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "which_matlab" && args?.customPaths?.includes("/usr/bin/new-matlab")) {
        return [
          { id: "matlab-0", label: "MATLAB", path: "/usr/bin/new-matlab", version: "R2024b" },
        ];
      }
      return [];
    });

    render(
      <MantineProvider>
        <SettingsModal opened onClose={() => undefined} />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: /settings/i });
    const dialog = dialogs[dialogs.length - 1];

    fireEvent.click(within(dialog).getByRole("button", { name: /add manually/i }));

    const inputs = within(dialog).getAllByPlaceholderText(/path to matlab executable/i);
    const pathInput = inputs[inputs.length - 1];

    // Change path
    fireEvent.change(pathInput, { target: { value: "/usr/bin/new-matlab" } });

    // Blur path input
    fireEvent.blur(pathInput);

    await waitFor(() => {
      const installs = useGlobalStore.getState().settings.matlabInstallations;
      const customInstall = installs.find((inst) => inst.path === "/usr/bin/new-matlab");
      expect(customInstall?.version).toBe("R2024b");
    });
  });

  it("runs version detection on save/close for installations with path but empty version", async () => {
    const onClose = vi.fn();
    useGlobalStore.setState({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        matlabInstallations: [
          { id: "manual-2", label: "My MATLAB", path: "/usr/bin/save-matlab", version: "" },
        ],
      },
    });

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "which_matlab" && args?.customPaths?.includes("/usr/bin/save-matlab")) {
        return [
          { id: "matlab-0", label: "MATLAB", path: "/usr/bin/save-matlab", version: "R2023b" },
        ];
      }
      return [];
    });

    render(
      <MantineProvider>
        <SettingsModal opened onClose={onClose} />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: /settings/i });
    const dialog = dialogs[dialogs.length - 1];
    const saveButtons = within(dialog).getAllByRole("button", { name: /save & close/i });

    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
      const installs = useGlobalStore.getState().settings.matlabInstallations;
      const customInstall = installs.find((inst) => inst.path === "/usr/bin/save-matlab");
      expect(customInstall?.version).toBe("R2023b");
    });
  });
});

