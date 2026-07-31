import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

import { useProcessingEnvironment } from "./useProcessingEnvironment";
import { __resetProcessingEnvironmentCacheForTests } from "./useProcessingEnvironment";
import { invoke } from "@tauri-apps/api/core";

describe("useProcessingEnvironment", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    __resetProcessingEnvironmentCacheForTests();
  });

  it("returns default cores=0 and workers=0 before IPC resolves", () => {
    vi.mocked(invoke).mockResolvedValue(8);
    const { result } = renderHook(() => useProcessingEnvironment());
    expect(result.current.systemCores).toBe(0);
    expect(result.current.defaultWorkers).toBe(0);
  });

  it("queries get_cpu_cores and get_available_memory_mb once on mount", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_cpu_cores") return Promise.resolve(8);
      if (cmd === "get_available_memory_mb") return Promise.resolve(16384);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useProcessingEnvironment());

    await waitFor(() => expect(result.current.systemCores).toBe(8));

    expect(result.current.defaultWorkers).toBe(4);
    const calls = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    const cpuCalls = calls.filter((c) => c === "get_cpu_cores").length;
    const memCalls = calls.filter((c) => c === "get_available_memory_mb").length;
    expect(cpuCalls).toBe(1);
    expect(memCalls).toBe(1);
  });

  it("caps default workers at min(mem/4GB, cores, 4)", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_cpu_cores") return Promise.resolve(16);
      if (cmd === "get_available_memory_mb") return Promise.resolve(8192);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useProcessingEnvironment());

    await waitFor(() => expect(result.current.systemCores).toBe(16));

    expect(result.current.defaultWorkers).toBe(2);
  });

  it("shares a single IPC request across multiple hook instances", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_cpu_cores") return Promise.resolve(8);
      if (cmd === "get_available_memory_mb") return Promise.resolve(16384);
      return Promise.resolve(null);
    });

    const r1 = renderHook(() => useProcessingEnvironment());
    const r2 = renderHook(() => useProcessingEnvironment());

    await waitFor(() => expect(r1.result.current.systemCores).toBe(8));
    await waitFor(() => expect(r2.result.current.systemCores).toBe(8));

    const cpuCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "get_cpu_cores").length;
    const memCalls = vi
      .mocked(invoke)
      .mock.calls.filter((c) => c[0] === "get_available_memory_mb").length;
    expect(cpuCalls).toBe(1);
    expect(memCalls).toBe(1);
  });

  it("falls back to defaults on IPC failure", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("ipc failed"));

    const { result } = renderHook(() => useProcessingEnvironment());

    await waitFor(() => expect(result.current.systemCores).toBe(4));
    expect(result.current.defaultWorkers).toBe(4);
  });
});
