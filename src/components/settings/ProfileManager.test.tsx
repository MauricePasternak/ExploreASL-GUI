import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../schemas/globalSettings";
import type { ApptainerProfile } from "../../schemas/executionProfile";
import { useGlobalStore } from "../../stores/globalStore";
import { makeMatlabProfile } from "../../test/profileFixtures";
import ProfileManager from "./ProfileManager";

function renderManager() {
  return render(
    <MantineProvider>
      <ProfileManager />
    </MantineProvider>,
  );
}

beforeEach(() => {
  useGlobalStore.setState({
    loaded: true,
    settings: DEFAULT_SETTINGS,
    profileValidationState: {},
  });
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "validate_execution_profile") {
      return { id: "new-id", valid: true, errors: [], exploreAslVersion: "1.15.0" };
    }
    if (cmd === "which_matlab") {
      return [];
    }
    if (cmd === "which_apptainer") {
      return [];
    }
    if (cmd === "detect_exploreasl_version") {
      return "1.15.0";
    }
    return null;
  });
  vi.mocked(open).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfileManager", () => {
  it("renders empty state with add profile action", () => {
    renderManager();

    expect(screen.getByTestId("profile-manager")).toBeInTheDocument();
    expect(screen.getByTestId("profile-manager-add-btn")).toBeInTheDocument();
    expect(screen.getByText(/no execution profiles configured/i)).toBeInTheDocument();
  });

  it("lists profiles with validity indicators", () => {
    const profile = makeMatlabProfile({ label: "Lab MATLAB" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: {
        [profile.id]: { valid: true, errors: [] },
      },
    });

    renderManager();

    expect(screen.getByTestId(`profile-row-${profile.id}`)).toBeInTheDocument();
    expect(screen.getByText("Lab MATLAB")).toBeInTheDocument();
    expect(screen.getByTestId(`profile-valid-${profile.id}`)).toBeInTheDocument();
  });

  it("shows invalid indicator and tooltip errors for invalid profiles", () => {
    const profile = makeMatlabProfile({ label: "Broken" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: {
        [profile.id]: { valid: false, errors: ["MATLAB executable not found"] },
      },
    });

    renderManager();

    expect(screen.getByTestId(`profile-invalid-${profile.id}`)).toBeInTheDocument();
  });

  it("opens inline add form and saves a validated profile", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "validate_execution_profile") {
        const profile = (args as any)?.executionProfile as { id: string };
        return { id: profile.id, valid: true, errors: [], exploreAslVersion: "1.15.0" };
      }
      if (cmd === "detect_exploreasl_version") {
        return "1.15.0";
      }
      return null;
    });

    renderManager();

    await userEvent.click(screen.getByTestId("profile-manager-add-btn"));

    const form = screen.getByTestId("profile-form");
    fireEvent.change(within(form).getByTestId("profile-form-label"), {
      target: { value: "New Profile" },
    });
    fireEvent.change(within(form).getByTestId("profile-form-matlab-path"), {
      target: { value: "/opt/matlab/bin/matlab" },
    });
    fireEvent.change(within(form).getByTestId("profile-form-exploreasl-path"), {
      target: { value: "/opt/ExploreASL" },
    });

    await userEvent.click(within(form).getByTestId("profile-form-save-btn"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "validate_execution_profile",
        expect.objectContaining({
          executionProfile: expect.objectContaining({
            label: "New Profile",
            type: "matlab",
            matlabPath: "/opt/matlab/bin/matlab",
            exploreAslPath: "/opt/ExploreASL",
          }),
        }),
      );
      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(1);
      expect(useGlobalStore.getState().settings.executionProfiles[0].label).toBe("New Profile");
      expect(useGlobalStore.getState().settings.executionProfiles[0].exploreAslVersion).toBe(
        "1.15.0",
      );
    });
  });

  it("creates an Apptainer profile with SIF and executable paths", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "validate_execution_profile") {
        const profile = (args as any)?.executionProfile as { id: string };
        return { id: profile.id, valid: true, errors: [], exploreAslVersion: "1.11.0" };
      }
      if (cmd === "which_apptainer") {
        return [];
      }
      return null;
    });
    vi.mocked(open).mockResolvedValueOnce("/picked/exploreasl.sif" as never);

    renderManager();
    await userEvent.click(screen.getByTestId("profile-manager-add-btn"));

    const form = screen.getByTestId("profile-form");
    await userEvent.click(within(form).getByRole("combobox", { name: "Type" }));
    fireEvent.click(screen.getByText("Apptainer"));

    expect(within(form).queryByTestId("profile-form-matlab-path")).not.toBeInTheDocument();
    expect(within(form).queryByTestId("profile-form-exploreasl-path")).not.toBeInTheDocument();
    expect(within(form).getByTestId("profile-form-sif-path")).toBeInTheDocument();
    expect(within(form).getByTestId("profile-form-apptainer-path")).toHaveValue("apptainer");

    await userEvent.click(within(form).getByTestId("profile-browse-sif-btn"));
    fireEvent.change(within(form).getByTestId("profile-form-label"), {
      target: { value: "Container profile" },
    });
    await userEvent.click(within(form).getByTestId("profile-form-save-btn"));

    await waitFor(() => {
      const saved = useGlobalStore.getState().settings.executionProfiles[0] as ApptainerProfile;
      expect(saved.type).toBe("apptainer");
      expect(saved.sifPath).toBe("/picked/exploreasl.sif");
      expect(saved.apptainerPath).toBe("apptainer");
      expect(saved.exploreAslVersion).toBe("1.11.0");
    });
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([
          { name: "Apptainer image", extensions: ["sif"] },
          { name: "All files", extensions: ["*.*"] },
        ]),
      }),
    );
  });

  it("auto-detects multiple Apptainer executables and allows selecting one", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "which_apptainer") {
        return [
          {
            id: "apptainer-1",
            label: "Apptainer 1.5.2",
            path: "/usr/bin/apptainer",
            version: "1.5.2",
          },
          {
            id: "apptainer-2",
            label: "Singularity 4.1.0",
            path: "/opt/singularity/bin/singularity",
            version: "4.1.0",
          },
        ];
      }
      return null;
    });

    renderManager();
    await userEvent.click(screen.getByTestId("profile-manager-add-btn"));
    const form = screen.getByTestId("profile-form");
    await userEvent.click(within(form).getByRole("combobox", { name: "Type" }));
    fireEvent.click(screen.getByText("Apptainer"));

    await waitFor(() => {
      expect(within(form).getByTestId("profile-form-apptainer-path")).toHaveValue(
        "/usr/bin/apptainer",
      );
      expect(within(form).getByTestId("profile-form-label")).toHaveValue("Apptainer 1.5.2");
      expect(within(form).getByTestId("profile-detected-apptainer-list")).toBeInTheDocument();
    });
    expect(within(form).getByTestId("profile-detected-apptainer-0")).toHaveTextContent(
      "Apptainer 1.5.2",
    );
    expect(within(form).getByTestId("profile-detected-apptainer-1")).toHaveTextContent(
      "Singularity 4.1.0",
    );

    await userEvent.click(within(form).getByTestId("profile-detected-apptainer-1"));
    expect(within(form).getByTestId("profile-form-apptainer-path")).toHaveValue(
      "/opt/singularity/bin/singularity",
    );
  });

  it("browses for an Apptainer executable", async () => {
    vi.mocked(open).mockResolvedValueOnce("/picked/apptainer" as never);

    renderManager();
    await userEvent.click(screen.getByTestId("profile-manager-add-btn"));
    const form = screen.getByTestId("profile-form");
    await userEvent.click(within(form).getByRole("combobox", { name: "Type" }));
    fireEvent.click(screen.getByText("Apptainer"));
    await userEvent.click(within(form).getByTestId("profile-browse-apptainer-btn"));

    expect(within(form).getByTestId("profile-form-apptainer-path")).toHaveValue(
      "/picked/apptainer",
    );
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Select Apptainer executable",
        directory: false,
        multiple: false,
      }),
    );
    expect(invoke).toHaveBeenCalledWith("which_apptainer", {
      customPaths: ["/picked/apptainer"],
    });
  });

  it("blocks save and shows inline errors when validation fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "validate_execution_profile") {
        return { id: "x", valid: false, errors: ["ExploreASL.m not found"] };
      }
      return null;
    });

    renderManager();
    await userEvent.click(screen.getByTestId("profile-manager-add-btn"));

    const form = screen.getByTestId("profile-form");
    fireEvent.change(within(form).getByLabelText(/label/i), {
      target: { value: "Bad Profile" },
    });
    fireEvent.change(within(form).getByLabelText(/matlab path/i), {
      target: { value: "/opt/matlab/bin/matlab" },
    });
    fireEvent.change(within(form).getByLabelText(/exploreasl path/i), {
      target: { value: "/bad/path" },
    });

    await userEvent.click(within(form).getByTestId("profile-form-save-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("profile-form-errors")).toHaveTextContent(
        /ExploreASL\.m not found/i,
      );
      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(0);
    });
  });

  it("detects MATLAB installations and applies a selected path", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "which_matlab") {
        return [
          {
            id: "matlab-1",
            label: "MATLAB R2025b",
            path: "/usr/local/bin/matlab",
            version: "R2025b",
          },
        ];
      }
      return null;
    });

    renderManager();
    await userEvent.click(screen.getByTestId("profile-manager-add-btn"));

    await userEvent.click(screen.getByTestId("profile-detect-matlab-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("profile-detected-matlab-list")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("profile-detected-matlab-0"));

    const form = screen.getByTestId("profile-form");
    expect(within(form).getByTestId("profile-form-matlab-path")).toHaveValue(
      "/usr/local/bin/matlab",
    );
  });

  it("browses for MATLAB executable and ExploreASL directory", async () => {
    vi.mocked(open)
      .mockResolvedValueOnce("/picked/matlab" as never)
      .mockResolvedValueOnce("/picked/ExploreASL" as never);

    renderManager();
    await userEvent.click(screen.getByTestId("profile-manager-add-btn"));

    await userEvent.click(screen.getByTestId("profile-browse-matlab-btn"));
    await userEvent.click(screen.getByTestId("profile-browse-exploreasl-btn"));

    const form = screen.getByTestId("profile-form");
    await waitFor(() => {
      expect(within(form).getByTestId("profile-form-matlab-path")).toHaveValue("/picked/matlab");
      expect(within(form).getByTestId("profile-form-exploreasl-path")).toHaveValue(
        "/picked/ExploreASL",
      );
    });
  });

  it("shows teal version when ExploreASL version is detected", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "detect_exploreasl_version") {
        return "2.0.0";
      }
      return null;
    });

    renderManager();
    await userEvent.click(screen.getByTestId("profile-manager-add-btn"));

    const form = screen.getByTestId("profile-form");
    fireEvent.change(within(form).getByTestId("profile-form-exploreasl-path"), {
      target: { value: "/opt/ExploreASL" },
    });
    fireEvent.blur(within(form).getByTestId("profile-form-exploreasl-path"));

    await waitFor(() => {
      const version = screen.getByTestId("profile-exploreasl-version");
      expect(version).toHaveTextContent(/2\.0\.0/);
      expect(version).toHaveAttribute("data-detected", "true");
    });
  });

  it("shows orange version hint when ExploreASL version is not detected", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "detect_exploreasl_version") {
        return null;
      }
      return null;
    });

    renderManager();
    await userEvent.click(screen.getByTestId("profile-manager-add-btn"));

    const form = screen.getByTestId("profile-form");
    fireEvent.change(within(form).getByTestId("profile-form-exploreasl-path"), {
      target: { value: "/opt/ExploreASL" },
    });
    fireEvent.blur(within(form).getByTestId("profile-form-exploreasl-path"));

    await waitFor(() => {
      const version = screen.getByTestId("profile-exploreasl-version");
      expect(version).toHaveTextContent(/version not detected/i);
      expect(version).toHaveAttribute("data-detected", "false");
    });
  });

  it("opens delete confirmation and removes profile on confirm", async () => {
    const profile = makeMatlabProfile();
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: { [profile.id]: { valid: true, errors: [] } },
    });

    renderManager();

    await userEvent.click(screen.getByTestId(`profile-delete-${profile.id}`));
    expect(await screen.findByTestId("profile-delete-dialog")).toBeInTheDocument();

    await userEvent.click(await screen.findByTestId("profile-delete-confirm-btn"));

    await waitFor(() => {
      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(0);
    });
  });

  it("warns when deleting the last profile", async () => {
    const profile = makeMatlabProfile();
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: { [profile.id]: { valid: true, errors: [] } },
    });

    renderManager();

    await userEvent.click(screen.getByTestId(`profile-delete-${profile.id}`));

    expect(await screen.findByTestId("profile-delete-last-warning")).toBeInTheDocument();
  });

  it("pre-fills edit form and updates profile on save", async () => {
    const profile = makeMatlabProfile({ label: "Original" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: { [profile.id]: { valid: true, errors: [] } },
    });

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "validate_execution_profile") {
        const executionProfile = (args as any)?.executionProfile as { label: string; id: string };
        return {
          id: executionProfile.id,
          valid: true,
          errors: [],
          exploreAslVersion: "1.15.0",
        };
      }
      return null;
    });

    renderManager();

    await userEvent.click(screen.getByTestId(`profile-edit-${profile.id}`));

    const form = screen.getByTestId("profile-form");
    expect(within(form).getByTestId("profile-form-label")).toHaveValue("Original");

    fireEvent.change(within(form).getByTestId("profile-form-label"), {
      target: { value: "Updated Label" },
    });
    await userEvent.click(within(form).getByTestId("profile-form-save-btn"));

    await waitFor(() => {
      expect(useGlobalStore.getState().settings.executionProfiles[0].label).toBe("Updated Label");
    });
  });
});
