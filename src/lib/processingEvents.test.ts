import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { mapModuleName, runProcessingPipeline } from "./processingEvents";
import { useProjectStore } from "../stores/projectStore";
import type { ProcessConfig } from "../schemas/processingSchemas";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([1234]),
}));

describe("mapModuleName", () => {
  it("maps xASL_module_Structural to structural", () => {
    expect(mapModuleName("xASL_module_Structural")).toBe("structural");
  });

  it("maps xASL_module_ASL to asl", () => {
    expect(mapModuleName("xASL_module_ASL")).toBe("asl");
  });

  it("maps xASL_module_Population to population", () => {
    expect(mapModuleName("xASL_module_Population")).toBe("population");
  });

  it("returns structural for lowercase structural", () => {
    expect(mapModuleName("structural")).toBe("structural");
  });

  it("returns asl for lowercase asl", () => {
    expect(mapModuleName("asl")).toBe("asl");
  });

  it("returns population for lowercase population", () => {
    expect(mapModuleName("population")).toBe("population");
  });

  it("returns undefined for unknown module name", () => {
    expect(mapModuleName("unknown_module")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(mapModuleName("")).toBeUndefined();
  });
});

describe("runProcessingPipeline worker capping", () => {
  const baseConfig: ProcessConfig = {
    subjects: ["sub-001_01", "sub-002_01"],
    modules: ["structural"],
    matlabPath: "/usr/bin/matlab",
    exploreAslPath: "/opt/ExploreASL",
    workers: 4,
    subjectRegexp: "^(sub-001_01|sub-002_01)$",
  };

  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    useProjectStore.setState({
      project: {
        projectMeta: {
          rootPath: "/test/project_root",
        },
      } as any,
    });
  });

  it("throws an error if no project is loaded", async () => {
    useProjectStore.setState({ project: null });
    await expect(runProcessingPipeline(baseConfig)).rejects.toThrow("No project loaded");
  });

  it("caps workers to subjects length when workers exceed selected subjects", async () => {
    const config = {
      ...baseConfig,
      subjects: ["sub-001_01", "sub-002_01"], // 2 subjects
      workers: 4, // 4 workers
    };

    await runProcessingPipeline(config);

    expect(invoke).toHaveBeenCalledWith(
      "run_pipeline",
      expect.objectContaining({
        workers: 2, // Capped to subjects length
      }),
    );
  });

  it("does not cap workers when workers are less than selected subjects", async () => {
    const config = {
      ...baseConfig,
      subjects: ["sub-001_01", "sub-002_01", "sub-003_01"], // 3 subjects
      workers: 2, // 2 workers
    };

    await runProcessingPipeline(config);

    expect(invoke).toHaveBeenCalledWith(
      "run_pipeline",
      expect.objectContaining({
        workers: 2, // Keeps configured worker count
      }),
    );
  });

  it("keeps configured workers when subjects list is empty", async () => {
    const config = {
      ...baseConfig,
      subjects: [], // empty subjects list
      workers: 4,
    };

    await runProcessingPipeline(config);

    expect(invoke).toHaveBeenCalledWith(
      "run_pipeline",
      expect.objectContaining({
        workers: 4, // Keeps 4
      }),
    );
  });
});
