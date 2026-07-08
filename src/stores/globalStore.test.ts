import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import type { MatlabProfile } from "../schemas/executionProfile";
import { useGlobalStore } from "./globalStore";

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
        recentProjects: ["/tmp/project.easl"],
      },
    });
  });

  it("keeps recent projects unique and capped at twenty entries", () => {
    for (let index = 0; index < 25; index += 1) {
      useGlobalStore.getState().addRecentProject(`/tmp/project-${index}.easl`);
    }
    useGlobalStore.getState().addRecentProject("/tmp/project-5.easl");

    expect(useGlobalStore.getState().settings.recentProjects).toHaveLength(20);
    expect(useGlobalStore.getState().settings.recentProjects[0]).toBe("/tmp/project-5.easl");
  });

  it("persists the current settings snapshot", async () => {
    useGlobalStore.getState().setTheme("dark");
    useGlobalStore.getState().addRecentProject("/tmp/a/project.easl");

    await useGlobalStore.getState().saveSettings();

    const store = await Store.load("settings.json");
    await expect(store.get("theme")).resolves.toBe("dark");
    await expect(store.get("recentProjects")).resolves.toEqual(["/tmp/a/project.easl"]);
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
      await expect(store.get("recentProjects")).resolves.toEqual(["/tmp/auto-saved/project.easl"]);
    });

    useGlobalStore.getState().removeRecentProject("/tmp/auto-saved/project.easl");

    await vi.waitFor(async () => {
      await expect(store.get("recentProjects")).resolves.toEqual([]);
    });
  });

  describe("addProfile", () => {
    it("appends profile to executionProfiles list", async () => {
      const profile = makeMatlabProfile({ label: "MATLAB A" });
      await useGlobalStore.getState().addProfile(profile);

      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(1);
      expect(useGlobalStore.getState().settings.executionProfiles[0]).toEqual(profile);
    });

    it("appends multiple profiles", async () => {
      const p1 = makeMatlabProfile({ label: "A" });
      const p2 = makeMatlabProfile({ label: "B" });
      await useGlobalStore.getState().addProfile(p1);
      await useGlobalStore.getState().addProfile(p2);

      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(2);
      expect(useGlobalStore.getState().settings.executionProfiles[0]).toEqual(p1);
      expect(useGlobalStore.getState().settings.executionProfiles[1]).toEqual(p2);
    });

    it("sets placeholder validation entry when backend returns null", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);

      // Default invoke mock returns null → validateProfile early-returns.
      // Placeholder set by addProfile persists the invariant.
      expect(useGlobalStore.getState().profileValidationState[profile.id]).toEqual({
        valid: false,
        errors: [],
      });
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
    it("removes matching profile by id", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);

      useGlobalStore.getState().deleteProfile(profile.id);

      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(0);
    });

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

    it("removes the validation state entry for deleted profile", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);

      expect(useGlobalStore.getState().profileValidationState[profile.id]).toBeDefined();

      useGlobalStore.getState().deleteProfile(profile.id);

      expect(useGlobalStore.getState().profileValidationState[profile.id]).toBeUndefined();
    });

    it("deletes the last remaining profile and logs a warning", async () => {
      const profile = makeMatlabProfile({ label: "Last One" });
      await useGlobalStore.getState().addProfile(profile);

      expect(useGlobalStore.getState().settings.executionProfiles).toHaveLength(1);

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
    it("calls invoke with correct args and updates profileValidationState", async () => {
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
    });

    it("updates exploreAslVersion on the profile when returned", async () => {
      const profile = makeMatlabProfile();
      await useGlobalStore.getState().addProfile(profile);

      vi.mocked(invoke).mockResolvedValueOnce({
        id: profile.id,
        valid: true,
        errors: [],
        exploreAslVersion: "1.15.0",
      });

      await useGlobalStore.getState().validateProfile(profile);

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
