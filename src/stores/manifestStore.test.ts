import { describe, it, expect, beforeEach, vi } from "vitest";
import { useManifestStore } from "./manifestStore";

const { mockGetState } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
}));

vi.mock("./projectStore", () => ({
  useProjectStore: {
    getState: mockGetState,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("useManifestStore", () => {
  beforeEach(() => {
    useManifestStore.setState({
      step: 0,
      filter: "all",
      staleVerdicts: new Set(),
    });
  });

  it("starts on step 0 by default", () => {
    expect(useManifestStore.getState().step).toBe(0);
  });

  it("setStep advances step", () => {
    useManifestStore.getState().setStep(1);
    expect(useManifestStore.getState().step).toBe(1);
  });

  it("starts with filter 'all'", () => {
    expect(useManifestStore.getState().filter).toBe("all");
  });

  it("setFilter changes filter", () => {
    useManifestStore.getState().setFilter("pass");
    expect(useManifestStore.getState().filter).toBe("pass");
  });

  it("resetStep returns to step 0", () => {
    useManifestStore.getState().setStep(1);
    useManifestStore.getState().resetStep();
    expect(useManifestStore.getState().step).toBe(0);
  });
});

describe("useManifestStore recomputeStaleVerdicts", () => {
  beforeEach(async () => {
    useManifestStore.setState({
      step: 0,
      filter: "all",
      staleVerdicts: new Set(),
    });
    mockGetState.mockReturnValue({
      project: {
        projectMeta: { rootPath: "/test/root" },
        uiState: {
          manifest: {
            verdicts: {
              "sub-A_01": { status: "pass" as const, setAt: 1700000000000 },
              "sub-B_01": {
                status: "fail" as const,
                reason: "motion" as const,
                setAt: 1700000060000,
              },
            },
          },
        },
      },
    });
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue(1700000060000);
  });

  it("recomputeStaleVerdicts identifies stale when mtimes differ", async () => {
    await useManifestStore.getState().recomputeStaleVerdicts();
    const stale = useManifestStore.getState().staleVerdicts;
    expect(stale.has("sub-A_01")).toBe(true);
    expect(stale.has("sub-B_01")).toBe(false);
  });

  it("recomputeStaleVerdicts clears stale set when no verdicts exist", async () => {
    mockGetState.mockReturnValue({
      project: {
        projectMeta: { rootPath: "/test/root" },
        uiState: { manifest: { verdicts: {} } },
      },
    });
    await useManifestStore.getState().recomputeStaleVerdicts();
    expect(useManifestStore.getState().staleVerdicts.size).toBe(0);
  });

  it("recomputeStaleVerdicts no-ops when no project root", async () => {
    mockGetState.mockReturnValue({ project: null });
    await useManifestStore.getState().recomputeStaleVerdicts();
    expect(useManifestStore.getState().staleVerdicts.size).toBe(0);
  });

  it("recomputeStaleVerdicts handles invoke errors gracefully", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("fs error"));
    await useManifestStore.getState().recomputeStaleVerdicts();
    expect(useManifestStore.getState().staleVerdicts.size).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      "[manifestStore] failed to read population mtime for staleness",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
