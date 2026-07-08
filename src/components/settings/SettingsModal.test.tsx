import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../schemas/globalSettings";
import { useGlobalStore } from "../../stores/globalStore";
import { makeMatlabProfile } from "../../test/profileFixtures";
import SettingsModal from "./SettingsModal";

describe("SettingsModal", () => {
  beforeEach(() => {
    useGlobalStore.setState({
      loaded: true,
      settings: DEFAULT_SETTINGS,
      profileValidationState: {},
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "validate_execution_profile") {
        const profile = (args as { executionProfile?: { id: string } })?.executionProfile;
        return {
          id: profile?.id ?? "unknown",
          valid: true,
          errors: [],
          exploreAslVersion: "1.15.0",
        };
      }
      if (cmd === "which_matlab") {
        return [
          {
            id: "matlab-1",
            label: "MATLAB (/usr/local/bin/matlab)",
            path: "/usr/local/bin/matlab",
            version: "R2022b",
          },
        ];
      }
      if (cmd === "detect_exploreasl_version") {
        return "1.15.0";
      }
      return null;
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

  it("adds a profile through ProfileManager detect flow", async () => {
    render(
      <MantineProvider>
        <SettingsModal opened onClose={() => undefined} />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: /settings/i });
    const dialog = dialogs[dialogs.length - 1];

    await userEvent.click(within(dialog).getByTestId("profile-manager-add-btn"));
    fireEvent.change(within(dialog).getByTestId("profile-form-label"), {
      target: { value: "Detected MATLAB" },
    });
    fireEvent.change(within(dialog).getByTestId("profile-form-exploreasl-path"), {
      target: { value: "/opt/ExploreASL" },
    });
    await userEvent.click(within(dialog).getByTestId("profile-detect-matlab-btn"));
    await waitFor(() => {
      expect(within(dialog).getByTestId("profile-detected-matlab-list")).toBeInTheDocument();
    });
    await userEvent.click(within(dialog).getByTestId("profile-detected-matlab-0"));
    await userEvent.click(within(dialog).getByTestId("profile-form-save-btn"));

    await waitFor(() => {
      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(1);
      expect(useGlobalStore.getState().settings.executionProfiles[0].matlabPath).toBe(
        "/usr/local/bin/matlab",
      );
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

  it("renders existing profiles from the global store", () => {
    const profile = makeMatlabProfile({ id: "stored-profile-id", label: "Stored Profile" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: { [profile.id]: { valid: true, errors: [] } },
    });

    render(
      <MantineProvider>
        <SettingsModal opened onClose={() => undefined} />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: /settings/i });
    const dialog = dialogs[dialogs.length - 1];
    expect(within(dialog).getByTestId(`profile-row-${profile.id}`)).toBeInTheDocument();
  });
});
