import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockConfig: Record<string, unknown> | null = {
  subjects: [],
  modules: ["population"],
  matlabPath: "/usr/bin/matlab",
  exploreAslPath: "/opt/ExploreASL",
  workers: 1,
  subjectRegexp: "",
};

vi.mock("../../stores/processingStore", () => ({
  useProcessingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      config: mockConfig,
    }),
}));

vi.mock("../../stores/globalStore", () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settings: {
        matlabInstallations: [{ label: "R2024a", path: "/usr/bin/matlab", version: "R2024a" }],
        exploreAslPath: "/opt/ExploreASL",
      },
    }),
}));

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      project: { projectMeta: { rootPath: "/test/project" } },
    }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_cpu_cores") return Promise.resolve(8);
    return Promise.resolve(null);
  }),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn().mockResolvedValue(true),
}));

const { default: PreflightCheck } = await import("./PreflightCheck");

function renderCheck() {
  return render(
    <MantineProvider>
      <PreflightCheck />
    </MantineProvider>,
  );
}

afterEach(() => cleanup());

describe("PreflightCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("population-only subject exemption", () => {
    beforeEach(() => {
      mockConfig = {
        subjects: [],
        modules: ["population"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
    });

    it("does not show subjects error when only population module selected", () => {
      renderCheck();
      expect(screen.queryByText(/No subjects selected/i)).not.toBeInTheDocument();
    });
  });

  describe("structural module requires subjects", () => {
    beforeEach(() => {
      mockConfig = {
        subjects: [],
        modules: ["structural"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "",
      };
    });

    it("shows subjects error when structural selected without subjects", () => {
      renderCheck();
      expect(screen.getByText(/No subjects selected/i)).toBeInTheDocument();
    });
  });
});
