import { Store } from "@tauri-apps/plugin-store";
import { create } from "zustand";

import {
  DEFAULT_SETTINGS,
  GlobalSettingsSchema,
  type GlobalSettings,
  type MatlabInstallation,
} from "../schemas/globalSettings";

interface GlobalState {
  settings: GlobalSettings;
  loaded: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  setMatlabInstallations: (list: MatlabInstallation[]) => void;
  setExploreAslPath: (path: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  setTokenSubDelimiters: (delimiters: string[]) => void;
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
              const normalized = normalizeTokenSubDelimiters(parsed.data);
              merged.tokenSubDelimiters = normalized;
              if (!areEqualStringArrays(normalized, parsed.data)) {
                needsWrite = true;
              }
            } else {
              merged[key] = parsed.data;
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

      set({ settings: merged, loaded: true });
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

  setMatlabInstallations: (list) => {
    set((state) => ({
      settings: { ...state.settings, matlabInstallations: list },
    }));
  },

  setExploreAslPath: (path) => {
    set((state) => ({
      settings: { ...state.settings, exploreAslPath: path },
    }));
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

  addRecentProject: (path) => {
    set((state) => ({
      settings: {
        ...state.settings,
        recentProjects: [path, ...state.settings.recentProjects.filter((item) => item !== path)].slice(0, 20),
      },
    }));
    void get().saveSettings().catch(() => undefined);
  },

  removeRecentProject: (path) => {
    set((state) => ({
      settings: {
        ...state.settings,
        recentProjects: state.settings.recentProjects.filter((item) => item !== path),
      },
    }));
    void get().saveSettings().catch(() => undefined);
  },
}));
