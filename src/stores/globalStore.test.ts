import { Store } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useGlobalStore } from "./globalStore";

describe("useGlobalStore", () => {
  beforeEach(async () => {
    useGlobalStore.setState({ settings: DEFAULT_SETTINGS, loaded: false });

    const store = await Store.load("settings.json");
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await store.set(key, value);
    }
    await store.save();
  });

  it("loads persisted settings from plugin-store", async () => {
    const store = await Store.load("settings.json");
    await store.set("theme", "dark");
    await store.set("exploreAslPath", "/opt/ExploreASL");
    await store.set("recentProjects", ["/tmp/project.easl"]);
    await store.save();

    await useGlobalStore.getState().loadSettings();

    expect(useGlobalStore.getState()).toMatchObject({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        theme: "dark",
        exploreAslPath: "/opt/ExploreASL",
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
    useGlobalStore.getState().setExploreAslPath("/srv/exploreasl");
    useGlobalStore
      .getState()
      .setMatlabInstallations([
        { id: "matlab-1", label: "MATLAB R2025a", path: "/usr/local/bin/matlab", version: "" },
      ]);
    useGlobalStore.getState().addRecentProject("/tmp/a/project.easl");

    await useGlobalStore.getState().saveSettings();

    const store = await Store.load("settings.json");
    await expect(store.get("theme")).resolves.toBe("dark");
    await expect(store.get("exploreAslPath")).resolves.toBe("/srv/exploreasl");
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
});
