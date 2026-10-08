import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { projectFixture } from "../test/projectFixtures";
import { captureProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";

import { deriveDisagreements, useManifestStore } from "../stores/manifestStore";
import { useProjectStore } from "../stores/projectStore";
import { installE2EBridge, isE2EEnabled, isE2EScenario, type E2EScenario } from "./bridge";

const router = { navigate: vi.fn(() => Promise.resolve()) };
const location = { hash: "", key: "default", pathname: "/", search: "", state: null };
const snapshot = projectFixture();
snapshot.document.projectMeta.currentPhase = "manifest";
const manifest = snapshot.document.uiState.manifest;
const a = manifest.activeReviewerId;
const b = "22222222-2222-4222-8222-222222222222";
manifest.reviewers.push({ id: b, label: "Reviewer B", createdAt: "2026-01-01T00:00:00Z" });
manifest.verdicts = {
  [a]: {
    "sub-01_01": { status: "pass", setAt: 0 },
    "sub-02_01": { status: "fail", reason: "motion", setAt: 0 },
  },
  [b]: {
    "sub-01_01": { status: "fail", reason: "motion", setAt: 0 },
    "sub-02_01": { status: "pass", setAt: 0 },
  },
};
manifest.resolvedVerdicts = { "sub-01_01": { status: "pass", setAt: 0 } };

describe("E2E bridge", () => {
  beforeEach(() => {
    resetProjectLifecycleForTests();
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation(async (command) => {
        if (command === "inspect_project")
          return {
            candidateId: "seed",
            projectId: "project-1",
            name: "Project",
            rootPath: "/project",
            recoveredFromBackup: false,
            duplicatePath: null,
            movedFrom: null,
            setupRecovered: 0,
          };
        if (command === "activate_project" || command === "save_project") return snapshot;
        if (command === "shutdown_project_runtime")
          return {
            success: true,
            importProcess: { success: true },
            processingWorkers: { success: true },
            lockWatcher: { success: true },
          };
        if (
          command === "get_active_import_run" ||
          command === "get_active_run" ||
          command === "clear_active_project"
        )
          return null;
        if (command === "read_import_status") return [];
        throw new Error(`Unexpected command ${command}`);
      });
    router.navigate.mockClear();
    delete (window as Window & { __E2E__?: unknown }).__E2E__;
  });

  it("enables only for VITE_E2E === 1", () => {
    expect(isE2EEnabled({ VITE_E2E: "1" })).toBe(true);
    expect(isE2EEnabled({ VITE_E2E: "true" })).toBe(false);
    expect(isE2EEnabled({ VITE_E2E: "0" })).toBe(false);
    expect(isE2EEnabled({})).toBe(false);
  });

  it("recognizes only supported E2E scenarios", () => {
    expect(isE2EScenario("manifest-disagreements")).toBe(true);
    expect(isE2EScenario("unsupported")).toBe(false);
  });

  it("does not install __E2E__ when disabled", () => {
    expect(installE2EBridge({ enabled: false, router })).toBeUndefined();
    expect((window as Window & { __E2E__?: unknown }).__E2E__).toBeUndefined();
  });

  it("installs __E2E__ when enabled", () => {
    const control = installE2EBridge({ enabled: true, router });

    expect(control?.bridge).toBe(window.__E2E__);
  });

  it("rejects unknown scenarios", async () => {
    const control = installE2EBridge({ enabled: true, router });

    await expect(
      control?.bridge.seed("unknown" as E2EScenario, "/project/project.easl"),
    ).rejects.toThrow("Unknown E2E scenario");
  });

  it("seeds manifest disagreements", async () => {
    const control = installE2EBridge({ enabled: true, router });

    await control?.bridge.seed("manifest-disagreements", "/project/project.easl");
    expect(invoke).toHaveBeenCalledWith("inspect_project", {
      path: "/project/project.easl",
      recents: [],
    });
    expect(invoke).toHaveBeenCalledWith("activate_project", {
      candidateId: "seed",
      confirmBackup: false,
    });
    expect(captureProjectLease()?.rootPath).toBe("/project");

    const project = useProjectStore.getState().project;
    expect(project?.projectMeta.currentPhase).toBe("manifest");
    expect(useManifestStore.getState()).toMatchObject({
      step: 1,
      qcLoaded: true,
      priorModulesMtimes: { "sub-01_01": null, "sub-02_01": null },
    });
    expect(deriveDisagreements(project?.uiState.manifest)).toHaveLength(2);
    expect(project?.uiState.manifest?.resolvedVerdicts).toHaveProperty("sub-01_01");
    expect(project?.uiState.manifest?.resolvedVerdicts).not.toHaveProperty("sub-02_01");
  });

  it("clears scenario and project state on reset", async () => {
    const control = installE2EBridge({ enabled: true, router });
    await control?.bridge.seed("manifest-disagreements", "/project/project.easl");

    await control?.bridge.reset();

    expect(control?.bridge.currentScenario).toBeNull();
    expect(useProjectStore.getState().project).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith("/");
  });

  it("delegates navigation to the router", async () => {
    const control = installE2EBridge({ enabled: true, router });

    await control?.bridge.navigate("/overview");

    expect(router.navigate).toHaveBeenCalledWith("/overview");
  });

  it("waits for App readiness then resolves", async () => {
    const control = installE2EBridge({ enabled: true, router });
    let resolved = false;
    const ready = control?.bridge.ready().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    control?.onAppReady(location);
    await ready;

    expect(resolved).toBe(true);
    expect(control?.bridge.currentRoute).toBe("/");
  });

  it("starts a new readiness cycle before navigating", async () => {
    let completeNavigation: (() => void) | undefined;
    router.navigate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeNavigation = resolve;
        }),
    );
    const control = installE2EBridge({ enabled: true, router });
    const targetLocation = {
      hash: "",
      key: "manifest",
      pathname: "/project/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest",
      search: "",
      state: null,
    };

    control?.onAppReady(location);
    await control?.bridge.ready();

    const navigation = control?.bridge.navigate(targetLocation.pathname);
    let resolved = false;
    const ready = control?.bridge.ready().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    control?.onAppReady(location);
    await Promise.resolve();
    expect(resolved).toBe(false);

    completeNavigation?.();
    await navigation;
    control?.onAppReady(targetLocation);
    await ready;

    expect(control?.bridge.currentRoute).toBe(targetLocation.pathname);
  });

  it("resolves a readiness cycle for no-op navigation", async () => {
    const control = installE2EBridge({ enabled: true, router });
    control?.onAppReady(location);
    await control?.bridge.ready();

    await control?.bridge.navigate("/");
    await expect(control?.bridge.ready()).resolves.toBeUndefined();
  });

  it("resolves reset readiness when already at the landing route", async () => {
    const control = installE2EBridge({ enabled: true, router });
    control?.onAppReady(location);
    await control?.bridge.ready();

    await control?.bridge.reset();
    await expect(control?.bridge.ready()).resolves.toBeUndefined();
    expect(control?.bridge.currentScenario).toBeNull();
    expect(control?.bridge.currentRoute).toBe("/");
  });
});
