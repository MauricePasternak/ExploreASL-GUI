import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { DEFAULT_SETTINGS } from "../../schemas/globalSettings";
import { useGlobalStore } from "../../stores/globalStore";
import { makeMatlabProfile } from "../../test/profileFixtures";
import ProfileSelector from "./ProfileSelector";

function renderSelector(props: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return render(
    <MantineProvider>
      <ProfileSelector {...props} />
    </MantineProvider>,
  );
}

beforeEach(() => {
  useGlobalStore.setState({
    loaded: true,
    settings: DEFAULT_SETTINGS,
    profileValidationState: {},
  });
  vi.mocked(invoke).mockResolvedValue({ id: "x", valid: true, errors: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfileSelector", () => {
  it("shows empty hint when no profiles are configured", () => {
    renderSelector({ value: "", onChange: vi.fn() });

    expect(screen.getByTestId("profile-selector-empty")).toBeInTheDocument();
    expect(screen.getByText(/no profiles configured/i)).toBeInTheDocument();
  });

  it("lists profiles in the select dropdown", () => {
    const profile = makeMatlabProfile({ label: "Lab Profile" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: { [profile.id]: { valid: true, errors: [] } },
    });

    renderSelector({ value: profile.id, onChange: vi.fn() });

    expect(screen.getByTestId("profile-selector")).toBeInTheDocument();
    expect(screen.getByText("Lab Profile")).toBeInTheDocument();
  });

  it("shows profile not found when value does not match any profile", () => {
    const profile = makeMatlabProfile({ label: "Existing" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: { [profile.id]: { valid: true, errors: [] } },
    });

    renderSelector({ value: "missing-id", onChange: vi.fn() });

    expect(screen.getByTestId("profile-selector-not-found")).toHaveTextContent(
      /profile not found/i,
    );
  });

  it("calls onChange and validateProfile when selection changes", async () => {
    const p1 = makeMatlabProfile({ id: "11111111-1111-4111-8111-111111111111", label: "A" });
    const p2 = makeMatlabProfile({ id: "22222222-2222-4222-8222-222222222222", label: "B" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [p1, p2] },
      profileValidationState: {
        [p1.id]: { valid: true, errors: [] },
        [p2.id]: { valid: true, errors: [] },
      },
    });

    const onChange = vi.fn();
    renderSelector({ value: p1.id, onChange });

    const combobox = screen.getByRole("combobox", { name: /execution profile/i });
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByTestId(`profile-selector-option-${p2.id}`));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(p2.id);
      expect(invoke).toHaveBeenCalledWith(
        "validate_execution_profile",
        expect.objectContaining({ executionProfile: expect.objectContaining({ id: p2.id }) }),
      );
    });
  });

  it("shows warning after switching to an invalid profile", async () => {
    const p1 = makeMatlabProfile({ id: "11111111-1111-4111-8111-111111111111", label: "Valid" });
    const p2 = makeMatlabProfile({
      id: "22222222-2222-4222-8222-222222222222",
      label: "Invalid",
    });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [p1, p2] },
      profileValidationState: {
        [p1.id]: { valid: true, errors: [] },
        [p2.id]: { valid: false, errors: ["MATLAB not found"] },
      },
    });

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "validate_execution_profile") {
        const profile = (args as any)?.executionProfile as { id: string };
        if (profile.id === p2.id) {
          return { id: p2.id, valid: false, errors: ["MATLAB not found"] };
        }
        return { id: profile.id, valid: true, errors: [] };
      }
      return null;
    });

    function ControlledSelector() {
      const [value, setValue] = useState(p1.id);
      return <ProfileSelector value={value} onChange={setValue} />;
    }

    render(
      <MantineProvider>
        <ControlledSelector />
      </MantineProvider>,
    );

    const combobox = screen.getByRole("combobox", { name: /execution profile/i });
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByTestId(`profile-selector-option-${p2.id}`));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "validate_execution_profile",
        expect.objectContaining({ executionProfile: expect.objectContaining({ id: p2.id }) }),
      );
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "orange",
          title: expect.stringMatching(/invalid/i),
        }),
      );
      expect(screen.getByTestId("profile-selector-invalid-warning")).toBeInTheDocument();
    });
  });

  it("exposes invalid state for parent gating via data attribute", () => {
    const profile = makeMatlabProfile({ label: "Broken" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: {
        [profile.id]: { valid: false, errors: ["ExploreASL not found"] },
      },
    });

    renderSelector({ value: profile.id, onChange: vi.fn() });

    expect(screen.getByTestId("profile-selector")).toHaveAttribute("data-profile-valid", "false");
  });

  it("marks valid selected profile for parent gating", () => {
    const profile = makeMatlabProfile({ label: "Good" });
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: {
        [profile.id]: { valid: true, errors: [] },
      },
    });

    renderSelector({ value: profile.id, onChange: vi.fn() });

    expect(screen.getByTestId("profile-selector")).toHaveAttribute("data-profile-valid", "true");
  });

  it("disables the select when disabled prop is true", () => {
    const profile = makeMatlabProfile();
    useGlobalStore.setState({
      settings: { ...DEFAULT_SETTINGS, executionProfiles: [profile] },
      profileValidationState: { [profile.id]: { valid: true, errors: [] } },
    });

    renderSelector({ value: profile.id, onChange: vi.fn(), disabled: true });

    expect(screen.getByRole("combobox", { name: /execution profile/i })).toBeDisabled();
  });
});
