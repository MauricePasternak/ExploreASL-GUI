import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockConfig: Record<string, unknown> | null = {
  subjects: [],
  modules: ["population"],
  matlabPath: "/usr/bin/matlab",
  exploreAslPath: "/opt/ExploreASL",
  workers: 1,
};

const mockSetConfig = vi.fn();

vi.mock("../../stores/processingStore", () => ({
  useProcessingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      config: mockConfig,
      setConfig: mockSetConfig,
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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_cpu_cores") return Promise.resolve(8);
    if (cmd === "get_available_memory_mb") return Promise.resolve(16384);
    return Promise.resolve(null);
  }),
}));

const { default: PipelineConfig } = await import("./PipelineConfig");

function renderConfig() {
  return render(
    <MantineProvider>
      <PipelineConfig />
    </MantineProvider>,
  );
}

afterEach(() => cleanup());

describe("PipelineConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("module selection labels", () => {
    beforeEach(() => {
      mockConfig = {
        subjects: [],
        modules: ["structural", "asl"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 4,
      };
    });

    it("renders ASL checkbox with label 'ASL' in uppercase", () => {
      renderConfig();
      expect(screen.getByLabelText("ASL")).toBeInTheDocument();
      expect(screen.queryByLabelText("Asl")).not.toBeInTheDocument();
    });
  });

  describe("module toggle interactions", () => {
    beforeEach(() => {
      mockConfig = {
        subjects: [],
        modules: ["population"],
        matlabPath: "/usr/bin/matlab",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
      };
      mockSetConfig.mockClear();
    });

    it("unchecks population when structural checkbox is clicked", () => {
      renderConfig();
      const structuralCheckbox = screen.getByLabelText("Structural");
      fireEvent.click(structuralCheckbox);

      expect(mockSetConfig).toHaveBeenCalled();
      const calledConfig = mockSetConfig.mock.calls[0][0];
      expect(calledConfig.modules).toContain("structural");
      expect(calledConfig.modules).not.toContain("population");
    });

    it("unchecks population when ASL checkbox is clicked", () => {
      renderConfig();
      const aslCheckbox = screen.getByLabelText("ASL");
      fireEvent.click(aslCheckbox);

      expect(mockSetConfig).toHaveBeenCalled();
      const calledConfig = mockSetConfig.mock.calls[0][0];
      expect(calledConfig.modules).toContain("asl");
      expect(calledConfig.modules).not.toContain("population");
    });
  });
});
