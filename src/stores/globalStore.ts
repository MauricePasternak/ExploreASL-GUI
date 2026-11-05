import { showErrorNotification } from "../lib/errorNotifications";
import { commands, unwrap } from "../lib/ipc";
import type { ProfileValidationResult_Serialize as ProfileValidationResult } from "../generated/bindings";
export type { ProfileValidationResult_Serialize as ProfileValidationResult } from "../generated/bindings";
import { Store } from "@tauri-apps/plugin-store";
import { create } from "zustand";

import type { ExecutionProfile } from "../schemas/executionProfile";
import {
  DEFAULT_SETTINGS,
  GlobalSettingsSchema,
  type GlobalSettings,
  type RecentProject,
  RecentProjectsSchema,
} from "../schemas/globalSettings";

interface GlobalState {
  settings: GlobalSettings;
  loaded: boolean;
  profileValidationState: Record<string, { valid: boolean; errors: string[] }>;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  addProfile: (
    profile: ExecutionProfile,
    validationResult?: ProfileValidationResult,
  ) => Promise<void>;
  updateProfile: (id: string, updates: Partial<ExecutionProfile>) => void;
  deleteProfile: (id: string) => void;
  getProfileById: (id: string) => ExecutionProfile | undefined;
  validateProfile: (
    profile: ExecutionProfile,
    validationResult?: ProfileValidationResult,
  ) => Promise<void>;
  validateAllProfiles: () => Promise<void>;
  hasValidProfile: () => boolean;
  setTheme: (theme: "light" | "dark") => void;
  setTokenSubDelimiters: (delimiters: string[]) => void;
  setPreserveStagingDir: (preserve: boolean) => void;
  addRecentProject: (path: string, projectId?: string, name?: string) => void;
  replaceRecentProject: (
    oldPath: string,
    newPath: string,
    projectId: string,
    name?: string,
  ) => void;
  updateRecentProjectName: (path: string, projectId: string, name: string) => void;
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

async function saveDetectedProfileVersions(saveSettings: () => Promise<void>) {
  try {
    await saveSettings();
  } catch (error) {
    showErrorNotification({
      id: "execution-profile-version-save",
      title: "Profile versions not saved",
      message: "Detected execution-profile versions could not be saved.",
      details:
        "Validation completed. Detected versions remain available for this session. Check access to application settings, then save a profile in Settings to retry.",
      error,
    });
  }
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
              if (
                key === "recentProjects" &&
                JSON.stringify(value) !== JSON.stringify(parsed.data)
              ) {
                needsWrite = true;
              }
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
      try {
        await get().validateAllProfiles();
      } catch (error) {
        showErrorNotification({
          id: "startup-profile-validation",
          title: "Profile validation failed",
          message:
            "Execution profiles could not be checked. Review them in Settings before starting work.",
          error,
        });
        // Settings were loaded successfully; a validation failure must not replace
        // profiles or recent projects with defaults that a later save would persist.
        set({ loaded: true });
        return;
      }

      const { settings, profileValidationState } = get();
      const invalidProfiles = settings.executionProfiles.filter(
        (profile) => profileValidationState[profile.id]?.valid === false,
      );
      if (invalidProfiles.length > 0) {
        showErrorNotification({
          id: "startup-invalid-execution-profiles",
          title:
            invalidProfiles.length === 1
              ? "Invalid execution profile"
              : "Invalid execution profiles",
          message:
            invalidProfiles.length === 1
              ? `Profile "${invalidProfiles[0].label}" needs attention. Review it in Settings.`
              : `${invalidProfiles.length} execution profiles need attention. Review them in Settings.`,
          details: invalidProfiles
            .map((profile) => {
              const explanations = profileValidationState[profile.id].errors;
              if (invalidProfiles.length === 1 && explanations.length === 0) return "";
              return [profile.label, ...explanations.map((explanation) => `• ${explanation}`)].join(
                "\n",
              );
            })
            .join("\n\n"),
        });
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
      recentProjects: RecentProjectsSchema.parse(settings.recentProjects),
    };

    set({ settings: normalizedSettings });

    for (const [key, value] of Object.entries(normalizedSettings)) {
      await store.set(key, value);
    }

    await store.save();
  },

  addProfile: async (profile, validationResult) => {
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
    await get().validateProfile(profile, validationResult);
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

  validateProfile: async (profile, validationResult) => {
    const result = validationResult ?? (await unwrap(commands.validateExecutionProfile(profile)));

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
      await saveDetectedProfileVersions(get().saveSettings);
    }
  },

  validateAllProfiles: async () => {
    const profiles = get().settings.executionProfiles;

    const results = await unwrap(commands.validateAllExecutionProfiles(profiles));

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
      await saveDetectedProfileVersions(get().saveSettings);
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

  addRecentProject: (path, projectId, name) => {
    set((state) => ({
      settings: {
        ...state.settings,
        recentProjects: [
          {
            ...state.settings.recentProjects.find((item) => item.path === path),
            path,
            projectId:
              projectId ??
              state.settings.recentProjects.find((item) => item.path === path)?.projectId,
            ...(name === undefined ? {} : { name }),
          },
          ...state.settings.recentProjects.filter((item) => item.path !== path),
        ].slice(0, 20),
      },
    }));
    void get()
      .saveSettings()
      .catch((err) => {
        console.error("[globalStore] Failed to save settings:", err);
      });
  },

  replaceRecentProject: (oldPath, newPath, projectId, name) => {
    set((state) => ({
      settings: {
        ...state.settings,
        recentProjects: [
          {
            ...state.settings.recentProjects.find((item) => item.path === oldPath),
            path: newPath,
            projectId,
            ...(name === undefined ? {} : { name }),
          },
          ...state.settings.recentProjects.filter(
            (item) => item.path !== oldPath && item.path !== newPath,
          ),
        ].slice(0, 20),
      },
    }));
    void get()
      .saveSettings()
      .catch((err) => {
        console.error("[globalStore] Failed to save settings:", err);
      });
  },

  updateRecentProjectName: (path, projectId, name) => {
    const recentProjects = get().settings.recentProjects;
    const normalizedPath = path.replace(/\\/g, "/");
    const matches = (item: RecentProject) =>
      item.projectId === projectId || item.path.replace(/\\/g, "/") === normalizedPath;
    if (!recentProjects.some((item) => matches(item) && item.name !== name)) return;
    set((state) => ({
      settings: {
        ...state.settings,
        recentProjects: state.settings.recentProjects.map((item) =>
          matches(item) ? { ...item, projectId, name } : item,
        ),
      },
    }));
    void get()
      .saveSettings()
      .catch((err) => {
        console.error("[globalStore] Failed to save recent project name:", err);
      });
  },

  removeRecentProject: (path) => {
    set((state) => ({
      settings: {
        ...state.settings,
        recentProjects: state.settings.recentProjects.filter((item) => item.path !== path),
      },
    }));
    void get()
      .saveSettings()
      .catch((err) => {
        console.error("[globalStore] Failed to save settings:", err);
      });
  },
}));
