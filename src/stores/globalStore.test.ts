import { invoke } from "@tauri-apps/api/core";
import { showErrorNotification } from "../lib/errorNotifications";
import { Store } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import type { MatlabProfile } from "../schemas/executionProfile";
import { useGlobalStore, type ProfileValidationResult } from "./globalStore";

vi.mock("../lib/errorNotifications", () => ({ showErrorNotification: vi.fn() }));

// Helper to create a valid matlab profile
function makeMatlabProfile(overrides: Partial<MatlabProfile> = {}): MatlabProfile {
  return {
    id: crypto.randomUUID(),
    label: "Default MATLAB",
    type: "matlab",
    matlabPath: "/usr/local/bin/matlab",
    exploreAslPath: "/opt/ExploreASL",
    ...overrides,
  };
}

describe("useGlobalStore", () => {
  beforeEach(async () => {
    vi.mocked(showErrorNotification).mockClear();
    useGlobalStore.setState({
      settings: DEFAULT_SETTINGS,
      loaded: false,
      profileValidationState: {},
    });

    const store = await Store.load("settings.json");
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await store.set(key, value);
    }
    await store.save();
  });

  it("loads persisted settings from plugin-store", async () => {
    const store = await Store.load("settings.json");
    await store.set("theme", "dark");
    await store.set("recentProjects", ["/tmp/project.easl"]);
    await store.save();

    await useGlobalStore.getState().loadSettings();

    expect(useGlobalStore.getState()).toMatchObject({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        theme: "dark",
        recentProjects: [{ path: "/tmp/project.easl" }],
      },
    });
  });

  it("keeps recent projects unique and capped at twenty entries", () => {
    for (let index = 0; index < 25; index += 1) {
      useGlobalStore.getState().addRecentProject(`/tmp/project-${index}.easl`);
    }
    useGlobalStore.getState().addRecentProject("/tmp/project-5.easl");

    expect(useGlobalStore.getState().settings.recentProjects).toHaveLength(20);
    expect(useGlobalStore.getState().settings.recentProjects[0]).toEqual({
      path: "/tmp/project-5.easl",
      projectId: undefined,
    });
  });

  it("persists the current settings snapshot", async () => {
    useGlobalStore.getState().setTheme("dark");
    useGlobalStore.getState().addRecentProject("/tmp/a/project.easl");

    await useGlobalStore.getState().saveSettings();

    const store = await Store.load("settings.json");
    await expect(store.get("theme")).resolves.toBe("dark");
    await expect(store.get("recentProjects")).resolves.toEqual([{ path: "/tmp/a/project.easl" }]);
  });

  it("loads and saves tokenizer delimiters", async () => {
    const store = await Store.load("settings.json");
    await store.set("tokenSubDelimiters", ["_", "-"]);
    await store.save();

    await useGlobalStore.getState().loadSettings();
    expect(useGlobalStore.getState().settings.tokenSubDelimiters).toEqual(["_", "-"]);

    useGlobalStore.getState().setTokenSubDelimiters(["_", "-", "."]);
    await useGlobalStore.getState().saveSettings();

    await expect(store.get("tokenSubDelimiters")).resolves.toEqual(["_", "-", "."]);
  });

  it("loads and saves import settings", async () => {
    const store = await Store.load("settings.json");
    await store.set("import", { preserveStagingDir: true });
    await store.save();

    await useGlobalStore.getState().loadSettings();
    expect(useGlobalStore.getState().settings.import.preserveStagingDir).toBe(true);

    await useGlobalStore.getState().saveSettings();

    await expect(store.get("import")).resolves.toEqual({ preserveStagingDir: true });
  });

  it("backfills the default tokenizer delimiters when missing from persisted settings", async () => {
    const store = await Store.load("settings.json");
    await store.set("tokenSubDelimiters", undefined);
    await store.save();

    await useGlobalStore.getState().loadSettings();

    expect(useGlobalStore.getState().settings.tokenSubDelimiters).toEqual(["_", "-"]);
    await expect(store.get("tokenSubDelimiters")).resolves.toEqual(["_", "-"]);
  });

  it("falls back to the default tokenizer delimiters when persisted values are malformed", async () => {
    const store = await Store.load("settings.json");
    await store.set("tokenSubDelimiters", ["__"]);
    await store.save();

    await useGlobalStore.getState().loadSettings();

    expect(useGlobalStore.getState().settings.tokenSubDelimiters).toEqual(["_", "-"]);
    await expect(store.get("tokenSubDelimiters")).resolves.toEqual(["_", "-"]);

    await store.set("tokenSubDelimiters", ["", "_"]);
    await store.save();

    await useGlobalStore.getState().loadSettings();

    expect(useGlobalStore.getState().settings.tokenSubDelimiters).toEqual(["_", "-"]);
    await expect(store.get("tokenSubDelimiters")).resolves.toEqual(["_", "-"]);
  });

  it("does not persist duplicate tokenizer delimiters", async () => {
    const store = await Store.load("settings.json");

    useGlobalStore.getState().setTokenSubDelimiters(["_", "-", "_", "-"]);
    await useGlobalStore.getState().saveSettings();

    expect(useGlobalStore.getState().settings.tokenSubDelimiters).toEqual(["_", "-"]);
    await expect(store.get("tokenSubDelimiters")).resolves.toEqual(["_", "-"]);
  });

  it("does not persist whitespace-only tokenizer delimiters", async () => {
    const store = await Store.load("settings.json");

    useGlobalStore.getState().setTokenSubDelimiters([" ", "\t"]);
    await useGlobalStore.getState().saveSettings();

    expect(useGlobalStore.getState().settings.tokenSubDelimiters).toEqual(["_", "-"]);
    await expect(store.get("tokenSubDelimiters")).resolves.toEqual(["_", "-"]);
  });

  it("persists recent project updates automatically", async () => {
    const store = await Store.load("settings.json");

    useGlobalStore.getState().addRecentProject("/tmp/auto-saved/project.easl");

    await vi.waitFor(async () => {
      await expect(store.get("recentProjects")).resolves.toEqual([
        { path: "/tmp/auto-saved/project.easl" },
      ]);
    });

    useGlobalStore.getState().removeRecentProject("/tmp/auto-saved/project.easl");

    await vi.waitFor(async () => {
      await expect(store.get("recentProjects")).resolves.toEqual([]);
    });
  });

  it("loads identity-aware recent records and canonicalizes legacy strings", async () => {
    const store = await Store.load("settings.json");
    await store.set("recentProjects", [
      "/legacy/project.easl",
      { path: "/known/project.easl", projectId: "known-id" },
    ]);
    await store.save();

    await useGlobalStore.getState().loadSettings();

    const expected = [
      { path: "/legacy/project.easl" },
      { path: "/known/project.easl", projectId: "known-id" },
    ];
    expect(useGlobalStore.getState().settings.recentProjects).toEqual(expected);
    await expect(store.get("recentProjects")).resolves.toEqual(expected);
  });

  it("drops malformed recent entries while retaining unmatched legacy paths", async () => {
    const store = await Store.load("settings.json");
    await store.set("recentProjects", [
      " /legacy/stale/project.easl ",
      { path: "/known/project.easl", projectId: "known-id", ignored: true },
      "",
      null,
      { path: 42 },
      { projectId: "orphan" },
      "/legacy/stale/project.easl",
    ]);
    await store.save();

    await useGlobalStore.getState().loadSettings();

    const expected = [
      { path: "/legacy/stale/project.easl" },
      { path: "/known/project.easl", projectId: "known-id" },
    ];
    expect(useGlobalStore.getState().settings.recentProjects).toEqual(expected);
    await expect(store.get("recentProjects")).resolves.toEqual(expected);
  });

  it("fills identity for a successfully opened legacy recent path", () => {
    useGlobalStore.setState((state) => ({
      settings: {
        ...state.settings,
        recentProjects: [{ path: "/legacy/project.easl" }],
      },
    }));

    useGlobalStore.getState().addRecentProject("/legacy/project.easl", "project-id");

    expect(useGlobalStore.getState().settings.recentProjects).toEqual([
      { path: "/legacy/project.easl", projectId: "project-id" },
    ]);
  });

  it("replaces a moved recent path without deleting unrelated records", () => {
    useGlobalStore.setState((state) => ({
      settings: {
        ...state.settings,
        recentProjects: [
          { path: "/old/project.easl", projectId: "same-id" },
          { path: "/other/project.easl", projectId: "other-id" },
        ],
      },
    }));

    useGlobalStore
      .getState()
      .replaceRecentProject("/old/project.easl", "/new/project.easl", "same-id");

    expect(useGlobalStore.getState().settings.recentProjects).toEqual([
      { path: "/new/project.easl", projectId: "same-id" },
      { path: "/other/project.easl", projectId: "other-id" },
    ]);
  });

  describe("addProfile", () => {
    it("appends multiple profiles", async () => {
      const p1 = makeMatlabProfile({ label: "A" });
      const p2 = makeMatlabProfile({ label: "B" });
      await useGlobalStore.getState().addProfile(p1);
      await useGlobalStore.getState().addProfile(p2);

      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(2);
      expect(useGlobalStore.getState().settings.executionProfiles[0]).toEqual(p1);
      expect(useGlobalStore.getState().settings.executionProfiles[1]).toEqual(p2);
    });

    it("keeps placeholder validation entry while backend validation is pending", async () => {
      const profile = makeMatlabProfile();
      let resolve!: (result: ProfileValidationResult) => void;
      vi.mocked(invoke).mockReturnValueOnce(
        new Promise<ProfileValidationResult>((done) => {
          resolve = done;
        }),
      );
      const adding = useGlobalStore.getState().addProfile(profile);

      expect(useGlobalStore.getState().profileValidationState[profile.id]).toEqual({
        valid: false,
        errors: [],
      });
      resolve({ id: profile.id, valid: true, errors: [] });
      await adding;
      expect(useGlobalStore.getState().profileValidationState[profile.id].valid).toBe(true);
    });

    it("sets validation entry from backend result when invoke returns data", async () => {
      const profile = makeMatlabProfile();
      vi.mocked(invoke).mockResolvedValueOnce({
        id: profile.id,
        valid: true,
        errors: [],
      });

      await useGlobalStore.getState().addProfile(profile);

      expect(useGlobalStore.getState().profileValidationState[profile.id]).toEqual({
        valid: true,
        errors: [],
      });
    });

    it("persists the profile via saveSettings", async () => {
      const profile = makeMatlabProfile({ label: "Persisted" });
      await useGlobalStore.getState().addProfile(profile);

      const store = await Store.load("settings.json");
      const persistedProfiles = await store.get("executionProfiles");
      expect(persistedProfiles).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: profile.id })]),
      );
    });
  });

  describe("updateProfile", () => {
    it("updates matching profile by id", async () => {
      const profile = makeMatlabProfile({ label: "Original" });
      await useGlobalStore.getState().addProfile(profile);

      useGlobalStore.getState().updateProfile(profile.id, { label: "Updated" });

      expect(useGlobalStore.getState().settings.executionProfiles[0].label).toBe("Updated");
    });

    it("persists updates automatically via saveSettings", async () => {
      const profile = makeMatlabProfile({ label: "Original" });
      await useGlobalStore.getState().addProfile(profile);

      useGlobalStore.getState().updateProfile(profile.id, { label: "Updated" });

      const store = await Store.load("settings.json");
      await vi.waitFor(async () => {
        const persisted = await store.get<any[]>("executionProfiles");
        expect(persisted?.[0]?.label).toBe("Updated");
      });
    });

    it("does not change other profiles", async () => {
      const p1 = makeMatlabProfile({ label: "A" });
      const p2 = makeMatlabProfile({ label: "B" });
      await useGlobalStore.getState().addProfile(p1);
      await useGlobalStore.getState().addProfile(p2);

      useGlobalStore.getState().updateProfile(p1.id, { label: "A-updated" });

      expect(useGlobalStore.getState().settings.executionProfiles[1].label).toBe("B");
    });

    it("does nothing when id does not match", async () => {
      const profile = makeMatlabProfile({ label: "Original" });
      await useGlobalStore.getState().addProfile(profile);

      useGlobalStore.getState().updateProfile("nonexistent", { label: "X" });

      expect(useGlobalStore.getState().settings.executionProfiles[0].label).toBe("Original");
    });
  });

  describe("deleteProfile", () => {
    it("persists deletion automatically via saveSettings", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);

      useGlobalStore.getState().deleteProfile(profile.id);

      const store = await Store.load("settings.json");
      await vi.waitFor(async () => {
        const persisted = await store.get<any[]>("executionProfiles");
        expect(persisted).toHaveLength(0);
      });
    });

    it("deletes the last remaining profile and logs a warning", async () => {
      const profile = makeMatlabProfile({ label: "Last One" });
      await useGlobalStore.getState().addProfile(profile);

      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(1);
      expect(useGlobalStore.getState().profileValidationState[profile.id]).toBeDefined();

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      useGlobalStore.getState().deleteProfile(profile.id);

      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(0);
      expect(useGlobalStore.getState().profileValidationState[profile.id]).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Deleting the last execution profile"),
      );

      warnSpy.mockRestore();
    });

    it("does nothing when id does not match", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);

      useGlobalStore.getState().deleteProfile("nonexistent");

      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(1);
    });
  });

  describe("getProfileById", () => {
    it("returns matching profile", async () => {
      const profile = makeMatlabProfile({ label: "Find Me" });
      await useGlobalStore.getState().addProfile(profile);

      const found = useGlobalStore.getState().getProfileById(profile.id);
      expect(found).toEqual(profile);
    });

    it("returns undefined when not found", () => {
      const found = useGlobalStore.getState().getProfileById("nonexistent");
      expect(found).toBeUndefined();
    });
  });

  describe("validateProfile", () => {
    it("calls invoke with correct args and updates validation state and detected version", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);

      vi.mocked(invoke).mockResolvedValueOnce({
        id: profile.id,
        valid: true,
        errors: [],
        exploreAslVersion: "1.15.0",
      });

      await useGlobalStore.getState().validateProfile(profile);

      expect(invoke).toHaveBeenCalledWith("validate_execution_profile", {
        executionProfile: profile,
      });
      expect(useGlobalStore.getState().profileValidationState[profile.id]).toEqual({
        valid: true,
        errors: [],
      });
      expect(useGlobalStore.getState().settings.executionProfiles[0].exploreAslVersion).toBe(
        "1.15.0",
      );
    });

    it("records errors when validation fails", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);

      vi.mocked(invoke).mockResolvedValueOnce({
        id: profile.id,
        valid: false,
        errors: ["MATLAB not found"],
      });

      await useGlobalStore.getState().validateProfile(profile);

      expect(useGlobalStore.getState().profileValidationState[profile.id]).toEqual({
        valid: false,
        errors: ["MATLAB not found"],
      });
    });

    it("handles concurrent deletion gracefully and guards mirror invariant", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);

      let resolveInvoke: (val: any) => void = () => {};
      const invokePromise = new Promise((resolve) => {
        resolveInvoke = resolve;
      });

      vi.mocked(invoke).mockImplementationOnce(() => invokePromise);

      // Trigger validation (which will wait on the invokePromise)
      const validatePromise = useGlobalStore.getState().validateProfile(profile);

      // Concurrently delete the profile
      useGlobalStore.getState().deleteProfile(profile.id);

      // Now resolve the invoke
      resolveInvoke({
        id: profile.id,
        valid: true,
        errors: [],
      });

      await validatePromise;

      // Verify that no orphaned entry is added to profileValidationState
      expect(useGlobalStore.getState().profileValidationState[profile.id]).toBeUndefined();
    });
  });

  describe("validateAllProfiles", () => {
    it("calls invoke with all profiles and updates validation state", async () => {
      const p1 = makeMatlabProfile({ label: "A" });
      const p2 = makeMatlabProfile({ label: "B" });
      await useGlobalStore.getState().addProfile(p1);
      await useGlobalStore.getState().addProfile(p2);

      vi.mocked(invoke).mockResolvedValueOnce([
        { id: p1.id, valid: true, errors: [] },
        { id: p2.id, valid: false, errors: ["ExploreASL not found"] },
      ]);

      await useGlobalStore.getState().validateAllProfiles();

      expect(invoke).toHaveBeenCalledWith("validate_all_execution_profiles", {
        executionProfiles: [p1, p2],
      });
      expect(useGlobalStore.getState().profileValidationState[p1.id]).toEqual({
        valid: true,
        errors: [],
      });
      expect(useGlobalStore.getState().profileValidationState[p2.id]).toEqual({
        valid: false,
        errors: ["ExploreASL not found"],
      });
    });

    it("updates exploreAslVersion when changed", async () => {
      const p1 = makeMatlabProfile({ label: "A" });
      await useGlobalStore.getState().addProfile(p1);

      vi.mocked(invoke).mockResolvedValueOnce([
        { id: p1.id, valid: true, errors: [], exploreAslVersion: "1.15.0" },
      ]);

      await useGlobalStore.getState().validateAllProfiles();

      expect(useGlobalStore.getState().settings.executionProfiles[0].exploreAslVersion).toBe(
        "1.15.0",
      );
    });

    it("preserves mirror invariant when backend omits a profile and returns an unknown id", async () => {
      const p1 = makeMatlabProfile({ label: "Known" });
      const p2 = makeMatlabProfile({ label: "Omitted" });
      await useGlobalStore.getState().addProfile(p1);
      await useGlobalStore.getState().addProfile(p2);

      // Backend reports p1, omits p2, and includes a stale id that matches no profile.
      vi.mocked(invoke).mockResolvedValueOnce([
        { id: p1.id, valid: true, errors: [] },
        { id: "unknown-stale-id", valid: false, errors: ["stale"] },
      ]);

      await useGlobalStore.getState().validateAllProfiles();

      const state = useGlobalStore.getState();
      // No orphan entry for the stale id.
      expect(state.profileValidationState["unknown-stale-id"]).toBeUndefined();
      // Mirror: every profile has an entry, and only profile ids are keys.
      const profileIds = state.settings.executionProfiles.map((p) => p.id);
      expect(Object.keys(state.profileValidationState).sort()).toEqual([...profileIds].sort());
      // Omitted profile kept its existing placeholder (valid: false).
      expect(state.profileValidationState[p2.id]).toEqual({ valid: false, errors: [] });
    });

    it("preserves concurrently added profiles and maintains mirror invariant during validation", async () => {
      const p1 = makeMatlabProfile({ label: "P1" });
      await useGlobalStore.getState().addProfile(p1);

      let resolveInvoke: (val: any) => void = () => {};
      const invokePromise = new Promise((resolve) => {
        resolveInvoke = resolve;
      });

      vi.mocked(invoke).mockImplementationOnce(() => invokePromise);

      // Start validation (will block on invokePromise)
      const validatePromise = useGlobalStore.getState().validateAllProfiles();

      // Concurrently add a new profile P2
      const p2 = makeMatlabProfile({ label: "P2" });
      // Add P2 but bypass validateProfile to make test deterministic
      useGlobalStore.setState((state) => ({
        settings: {
          ...state.settings,
          executionProfiles: [...state.settings.executionProfiles, p2],
        },
        profileValidationState: {
          ...state.profileValidationState,
          [p2.id]: { valid: false, errors: [] },
        },
      }));

      // Now resolve the invoke (only returns result for P1, since P2 wasn't in the initial call)
      resolveInvoke([{ id: p1.id, valid: true, errors: [] }]);

      await validatePromise;

      const state = useGlobalStore.getState();
      // P2 must NOT be deleted/lost from executionProfiles
      const profileIds = state.settings.executionProfiles.map((p) => p.id);
      expect(profileIds).toContain(p1.id);
      expect(profileIds).toContain(p2.id);

      // profileValidationState must remain fully in sync (no orphans, no missing entries)
      expect(Object.keys(state.profileValidationState).sort()).toEqual([p1.id, p2.id].sort());
      // P1 validation updated
      expect(state.profileValidationState[p1.id]).toEqual({ valid: true, errors: [] });
      // P2 validation preserved as placeholder
      expect(state.profileValidationState[p2.id]).toEqual({ valid: false, errors: [] });
    });
  });

  describe("validateProfile orphan guard", () => {
    it("does not record validation state for a profile that is not stored", async () => {
      const transient = makeMatlabProfile({ label: "Transient" });

      vi.mocked(invoke).mockResolvedValueOnce({
        id: transient.id,
        valid: true,
        errors: [],
      });

      await useGlobalStore.getState().validateProfile(transient);

      expect(useGlobalStore.getState().profileValidationState[transient.id]).toBeUndefined();
    });
  });

  describe("hasValidProfile", () => {
    it("returns false when no profiles exist", () => {
      expect(useGlobalStore.getState().hasValidProfile()).toBe(false);
    });

    it("returns false when all profiles are invalid", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);
      useGlobalStore.setState({
        profileValidationState: {
          [profile.id]: { valid: false, errors: ["err"] },
        },
      });

      expect(useGlobalStore.getState().hasValidProfile()).toBe(false);
    });

    it("returns true when at least one profile is valid", async () => {
      const p1 = makeMatlabProfile({ label: "Invalid" });
      const p2 = makeMatlabProfile({ label: "Valid" });
      await useGlobalStore.getState().addProfile(p1);
      await useGlobalStore.getState().addProfile(p2);
      useGlobalStore.setState({
        profileValidationState: {
          [p1.id]: { valid: false, errors: ["err"] },
          [p2.id]: { valid: true, errors: [] },
        },
      });

      expect(useGlobalStore.getState().hasValidProfile()).toBe(true);
    });
  });

  describe("loadSettings", () => {
    it("preserves loaded settings when startup validation fails, including on a later save", async () => {
      const profile = makeMatlabProfile({ label: "Saved profile" });
      const recentProjects = [{ path: "/saved/project.easl", projectId: "saved-project" }];
      const store = await Store.load("settings.json");
      await store.set("executionProfiles", [profile]);
      await store.set("recentProjects", recentProjects);
      await store.set("theme", "dark");
      const error = new Error("private validation diagnostic");
      vi.mocked(invoke).mockRejectedValueOnce(error);

      await useGlobalStore.getState().loadSettings();
      await useGlobalStore.getState().saveSettings();

      expect(useGlobalStore.getState()).toMatchObject({
        loaded: true,
        settings: { theme: "dark", executionProfiles: [profile], recentProjects },
      });
      await expect(store.get("executionProfiles")).resolves.toEqual([profile]);
      await expect(store.get("recentProjects")).resolves.toEqual(recentProjects);
      expect(showErrorNotification).toHaveBeenCalledExactlyOnceWith({
        id: "startup-profile-validation",
        title: "Profile validation failed",
        message:
          "Execution profiles could not be checked. Review them in Settings before starting work.",
        error,
      });
    });

    it("sets loaded: true only after validation completes", async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]);

      const loadPromise = useGlobalStore.getState().loadSettings();

      // Before the promise resolves, loaded should be false
      expect(useGlobalStore.getState().loaded).toBe(false);

      await loadPromise;

      expect(useGlobalStore.getState().loaded).toBe(true);
      expect(invoke).toHaveBeenCalledWith("validate_all_execution_profiles", {
        executionProfiles: [],
      });
    });

    it("shows a concise startup notification with the profile's explanation in details", async () => {
      const profile = makeMatlabProfile({ label: "Broken MATLAB" });
      const store = await Store.load("settings.json");
      await store.set("executionProfiles", [profile]);
      await store.save();

      vi.mocked(invoke).mockResolvedValueOnce([
        { id: profile.id, valid: false, errors: ["MATLAB not found"] },
      ]);

      await useGlobalStore.getState().loadSettings();

      expect(showErrorNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "startup-invalid-execution-profiles",
          message: 'Profile "Broken MATLAB" needs attention. Review it in Settings.',
          details: "Broken MATLAB\n• MATLAB not found",
        }),
      );
    });

    it("groups multiple invalid profiles into one notification without including valid profiles", async () => {
      const first = makeMatlabProfile({ label: "First MATLAB" });
      const second = makeMatlabProfile({ label: "Second MATLAB" });
      const valid = makeMatlabProfile({ label: "Working MATLAB" });
      const store = await Store.load("settings.json");
      await store.set("executionProfiles", [first, second, valid]);
      vi.mocked(invoke).mockResolvedValueOnce([
        { id: first.id, valid: false, errors: ["Select the MATLAB executable in Settings."] },
        { id: second.id, valid: false, errors: ["Select the ExploreASL folder in Settings."] },
        { id: valid.id, valid: true, errors: [] },
      ]);

      await useGlobalStore.getState().loadSettings();

      expect(showErrorNotification).toHaveBeenCalledExactlyOnceWith({
        id: "startup-invalid-execution-profiles",
        title: "Invalid execution profiles",
        message: "2 execution profiles need attention. Review them in Settings.",
        details:
          "First MATLAB\n• Select the MATLAB executable in Settings.\n\nSecond MATLAB\n• Select the ExploreASL folder in Settings.",
      });
    });

    it("omits details when a single invalid profile has no explanation", async () => {
      const profile = makeMatlabProfile();
      const store = await Store.load("settings.json");
      await store.set("executionProfiles", [profile]);
      vi.mocked(invoke).mockResolvedValueOnce([{ id: profile.id, valid: false, errors: [] }]);

      await useGlobalStore.getState().loadSettings();

      expect(showErrorNotification).toHaveBeenCalledWith(expect.objectContaining({ details: "" }));
    });

    it("persists exploreAslVersion when startup re-detection changes it", async () => {
      const profile = makeMatlabProfile({ exploreAslVersion: "1.14.0" });
      const store = await Store.load("settings.json");
      await store.set("executionProfiles", [profile]);
      await store.save();

      vi.mocked(invoke).mockResolvedValueOnce([
        { id: profile.id, valid: true, errors: [], exploreAslVersion: "1.15.0" },
      ]);

      await useGlobalStore.getState().loadSettings();

      expect(useGlobalStore.getState().settings.executionProfiles[0].exploreAslVersion).toBe(
        "1.15.0",
      );
      await expect(store.get("executionProfiles")).resolves.toEqual([
        expect.objectContaining({ id: profile.id, exploreAslVersion: "1.15.0" }),
      ]);
    });

    it("reports version persistence separately without discarding validation results", async () => {
      const valid = makeMatlabProfile({ label: "Valid", exploreAslVersion: "1.14.0" });
      const invalid = makeMatlabProfile({ label: "Invalid" });
      const store = await Store.load("settings.json");
      await store.set("executionProfiles", [valid, invalid]);
      const error = new Error("private settings-write diagnostic");
      vi.mocked(store.save).mockRejectedValueOnce(error);
      vi.mocked(Store.load).mockResolvedValueOnce(store).mockResolvedValueOnce(store);
      vi.mocked(invoke).mockResolvedValueOnce([
        { id: valid.id, valid: true, errors: [], exploreAslVersion: "1.15.0" },
        { id: invalid.id, valid: false, errors: ["Select the MATLAB executable in Settings."] },
      ]);

      await useGlobalStore.getState().loadSettings();

      expect(useGlobalStore.getState().loaded).toBe(true);
      expect(useGlobalStore.getState().hasValidProfile()).toBe(true);
      expect(useGlobalStore.getState().settings.executionProfiles[0].exploreAslVersion).toBe(
        "1.15.0",
      );
      expect(showErrorNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "execution-profile-version-save",
          message: "Detected execution-profile versions could not be saved.",
          details: expect.stringContaining("Validation completed"),
          error,
        }),
      );
      expect(showErrorNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "startup-invalid-execution-profiles",
          message: 'Profile "Invalid" needs attention. Review it in Settings.',
        }),
      );
      expect(showErrorNotification).not.toHaveBeenCalledWith(
        expect.objectContaining({
          id: "startup-profile-validation",
        }),
      );
    });
  });

  describe("profileValidationState", () => {
    it("is not persisted to plugin-store", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);

      await useGlobalStore.getState().saveSettings();

      const store = await Store.load("settings.json");
      // profileValidationState should NOT be in the persisted store
      await expect(store.get("profileValidationState")).resolves.toBeUndefined();
    });
  });
});
