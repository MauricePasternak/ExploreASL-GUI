import { notifications } from "@mantine/notifications";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { create } from "zustand";

import type { ExecutionProfile } from "../schemas/executionProfile";
import {
  DEFAULT_SETTINGS,
  GlobalSettingsSchema,
  type GlobalSettings,
} from "../schemas/globalSettings";

interface ProfileValidationResult {
  id: string;
  valid: boolean;
  errors: string[];
  exploreAslVersion?: string;
}

interface GlobalState {
  settings: GlobalSettings;
  loaded: boolean;
  profileValidationState: Record<string, { valid: boolean; errors: string[] }>;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  addProfile: (profile: ExecutionProfile) => Promise<void>;
  updateProfile: (id: string, updates: Partial<ExecutionProfile>) => void;
  deleteProfile: (id: string) => void;
  getProfileById: (id: string) => ExecutionProfile | undefined;
  validateProfile: (profile: ExecutionProfile) => Promise<void>;
  validateAllProfiles: () => Promise<void>;
  hasValidProfile: () => boolean;
  setTheme: (theme: "light" | "dark") => void;
  setTokenSubDelimiters: (delimiters: string[]) => void;
  setPreserveStagingDir: (preserve: boolean) => void;
  addRecentProject: (path: string) => void;
  removeRecentProject: (path: string) => void;
}

async function getSettingsStore() {
  return Store.load("settings.json");
}

function areEqualStringArrays(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeTokenSubDelimiters(delimiters: string[]) {
  const normalized = delimiters
    .map((delimiter) => delimiter.trim())
    .filter((delimiter) => delimiter.length === 1)
    .filter((delimiter, index, array) => array.indexOf(delimiter) === index);

  return normalized.length > 0 ? normalized : DEFAULT_SETTINGS.tokenSubDelimiters;
}

export const useGlobalStore = create<GlobalState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  profileValidationState: {},

  loadSettings: async () => {
    try {
      const store = await getSettingsStore();
      const merged: GlobalSettings = { ...DEFAULT_SETTINGS };
      let needsWrite = false;

      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GlobalSettings)[]) {
        const value = await store.get<GlobalSettings[typeof key]>(key);
        if (value !== undefined && value !== null) {
          const parsed = GlobalSettingsSchema.shape[key].safeParse(value);
          if (parsed.success) {
            if (key === "tokenSubDelimiters") {
              const normalized = normalizeTokenSubDelimiters(parsed.data as string[]);
              merged.tokenSubDelimiters = normalized;
              if (!areEqualStringArrays(normalized, parsed.data as string[])) {
                needsWrite = true;
              }
            } else {
              (merged as Record<string, unknown>)[key] = parsed.data;
            }
          } else {
            needsWrite = true;
          }
        } else {
          needsWrite = true;
        }
      }

      if (needsWrite) {
        for (const [key, value] of Object.entries(merged)) {
          await store.set(key, value);
        }
        await store.save();
      }

      set({ settings: merged });

      // Validate all profiles before marking loaded
      await get().validateAllProfiles();

      const { settings, profileValidationState } = get();
      for (const profile of settings.executionProfiles) {
        const validation = profileValidationState[profile.id];
        if (validation && !validation.valid) {
          const errorSummary = validation.errors.join("; ") || "Unknown error";
          notifications.show({
            color: "red",
            title: "Invalid execution profile",
            message: `Profile '${profile.label}' is invalid: ${errorSummary}. Fix it in Settings.`,
          });
        }
      }

      set({ loaded: true });
    } catch {
      set({ settings: DEFAULT_SETTINGS, loaded: true });
    }
  },

  saveSettings: async () => {
    const store = await getSettingsStore();
    const { settings } = get();
    const normalizedSettings: GlobalSettings = {
      ...settings,
      tokenSubDelimiters: normalizeTokenSubDelimiters(settings.tokenSubDelimiters),
    };

    set({ settings: normalizedSettings });

    for (const [key, value] of Object.entries(normalizedSettings)) {
      await store.set(key, value);
    }

    await store.save();
  },

  addProfile: async (profile) => {
    set((state) => ({
      settings: {
        ...state.settings,
        executionProfiles: [...state.settings.executionProfiles, profile],
      },
      profileValidationState: {
        ...state.profileValidationState,
        [profile.id]: { valid: false, errors: [] },
      },
    }));
    await get().validateProfile(profile);
    await get().saveSettings();
  },

  updateProfile: (id, updates) => {
    set((state) => ({
      settings: {
        ...state.settings,
        executionProfiles: state.settings.executionProfiles.map((p) =>
          p.id === id ? ({ ...p, ...updates } as ExecutionProfile) : p,
        ),
      },
    }));
    void get()
      .saveSettings()
      .catch((err) => {
        console.error("[globalStore] Failed to save settings:", err);
      });
  },

  deleteProfile: (id) => {
    set((state) => {
      const remaining = state.settings.executionProfiles.filter((p) => p.id !== id);
      if (remaining.length === 0) {
        console.warn(
          "[globalStore] Deleting the last execution profile. Project actions will be gated.",
        );
      }
      const { [id]: _, ...restValidation } = state.profileValidationState;
      return {
        settings: {
          ...state.settings,
          executionProfiles: remaining,
        },
        profileValidationState: restValidation,
      };
    });
    void get()
      .saveSettings()
      .catch((err) => {
        console.error("[globalStore] Failed to save settings:", err);
      });
  },

  getProfileById: (id) => {
    return get().settings.executionProfiles.find((p) => p.id === id);
  },

  validateProfile: async (profile) => {
    const result = (await invoke("validate_execution_profile", {
      executionProfile: profile,
    })) as ProfileValidationResult | null;

    if (!result) return;

    let versionChanged = false;

    set((state) => {
      // Guard the mirror invariant: only record validation state for profiles
      // that still exist in the store, otherwise we would orphan the entry.
      const exists = state.settings.executionProfiles.some((p) => p.id === profile.id);
      if (!exists) return state;

      const current = state.settings.executionProfiles.find((p) => p.id === profile.id);
      const isVersionUpdated =
        result.exploreAslVersion !== undefined &&
        current &&
        current.exploreAslVersion !== result.exploreAslVersion;

      if (isVersionUpdated) {
        versionChanged = true;
      }

      return {
        profileValidationState: {
          ...state.profileValidationState,
          [profile.id]: { valid: result.valid, errors: result.errors },
        },
        settings: isVersionUpdated
          ? {
              ...state.settings,
              executionProfiles: state.settings.executionProfiles.map((p) =>
                p.id === profile.id
                  ? ({ ...p, exploreAslVersion: result.exploreAslVersion } as ExecutionProfile)
                  : p,
              ),
            }
          : state.settings,
      };
    });

    if (versionChanged) {
      await get().saveSettings();
    }
  },

  validateAllProfiles: async () => {
    const profiles = get().settings.executionProfiles;

    const results = (await invoke("validate_all_execution_profiles", {
      executionProfiles: profiles,
    })) as ProfileValidationResult[] | null;

    if (!results) return;

    // Index results by id, keeping only those that correspond to a known profile.
    const resultsById = new Map<string, ProfileValidationResult>();
    for (const result of results) {
      resultsById.set(result.id, result);
    }

    let versionChanged = false;

    set((state) => {
      const currentProfiles = state.settings.executionProfiles;
      const updatedValidationState = { ...state.profileValidationState };

      const updatedProfiles = currentProfiles.map((profile) => {
        const result = resultsById.get(profile.id);
        if (result) {
          updatedValidationState[profile.id] = { valid: result.valid, errors: result.errors };
          if (
            result.exploreAslVersion !== undefined &&
            result.exploreAslVersion !== profile.exploreAslVersion
          ) {
            versionChanged = true;
            return { ...profile, exploreAslVersion: result.exploreAslVersion } as ExecutionProfile;
          }
        } else {
          // Backend omitted this profile: preserve the existing entry (or a
          // placeholder) so the mirror invariant holds across partial results.
          if (!updatedValidationState[profile.id]) {
            updatedValidationState[profile.id] = { valid: false, errors: [] };
          }
        }
        return profile;
      });

      // Index results by id, keeping only those that correspond to a known
      // profile. This upholds the mirror invariant: validation-state keys are
      // exactly the executionProfile ids (no orphans, no missing entries).
      const profileIds = new Set(currentProfiles.map((p) => p.id));
      for (const id of Object.keys(updatedValidationState)) {
        if (!profileIds.has(id)) {
          delete updatedValidationState[id];
        }
      }

      return {
        profileValidationState: updatedValidationState,
        settings: versionChanged
          ? { ...state.settings, executionProfiles: updatedProfiles }
          : state.settings,
      };
    });

    if (versionChanged) {
      await get().saveSettings();
    }
  },

  hasValidProfile: () => {
    const { settings, profileValidationState } = get();
    return settings.executionProfiles.some((p) => profileValidationState[p.id]?.valid === true);
  },

  setTheme: (theme) => {
    set((state) => ({
      settings: { ...state.settings, theme },
    }));
  },

  setTokenSubDelimiters: (delimiters) => {
    const normalized = normalizeTokenSubDelimiters(delimiters);
    set((state) => ({
      settings: { ...state.settings, tokenSubDelimiters: normalized },
    }));
  },

  setPreserveStagingDir: (preserve) => {
    set((state) => ({
      settings: {
        ...state.settings,
        import: { ...state.settings.import, preserveStagingDir: preserve },
      },
    }));
  },

  addRecentProject: (path) => {
    set((state) => ({
      settings: {
        ...state.settings,
        recentProjects: [
          path,
          ...state.settings.recentProjects.filter((item) => item !== path),
        ].slice(0, 20),
      },
    }));
    void get()
      .saveSettings()
      .catch((err) => {
        console.error("[globalStore] Failed to save settings:", err);
      });
  },

  removeRecentProject: (path) => {
    set((state) => ({
      settings: {
        ...state.settings,
        recentProjects: state.settings.recentProjects.filter((item) => item !== path),
      },
    }));
    void get()
      .saveSettings()
      .catch((err) => {
        console.error("[globalStore] Failed to save settings:", err);
      });
  },
}));
