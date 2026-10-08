import { TestMantineProvider as MantineProvider } from "../../test/render";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMatlabProfile } from "../../test/profileFixtures";

let mockConfig: Record<string, unknown> | null = {
  subjects: [],
  modules: ["population"],
  selectedProfileId: "profile-1",
  workers: 1,
};

const mockSetConfig = vi.fn().mockResolvedValue(undefined);
vi.mock("../../stores/projectStore", () => ({
  useProjectStore: (selector: (state: unknown) => unknown) =>
    selector({ project: { uiState: { processing: { config: mockConfig } } } }),
}));

vi.mock("../../stores/processingStore", () => ({
  useProcessingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      config: mockConfig,
      setConfig: mockSetConfig,
    }),
}));

const profile = makeMatlabProfile({ id: "profile-1", label: "R2024a" });

vi.mock("../../stores/globalStore", () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settings: {
        executionProfiles: [{ ...profile, id: "invalid", label: "Invalid" }, profile],
      },
      profileValidationState: {
        [profile.id]: { valid: true, errors: [] },
      },
      getProfileById: (id: string) => (id === profile.id ? profile : undefined),
      validateProfile: vi.fn(),
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
    <MantineProvider env="test">
      <PipelineConfig />
    </MantineProvider>,
  );
}

afterEach(() => cleanup());

describe("PipelineConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("initializes lazily with the first valid profile but retains a missing saved ID", async () => {
    mockConfig = null;
    const mounted = renderConfig();
    await vi.waitFor(() =>
      expect(mockSetConfig.mock.calls[0]?.[0](undefined)).toMatchObject({
        selectedProfileId: profile.id,
      }),
    );
    mounted.unmount();
    mockSetConfig.mockClear();
    mockConfig = { subjects: [], modules: [], selectedProfileId: "deleted", workers: 1 };
    renderConfig();
    expect(mockSetConfig).not.toHaveBeenCalled();
    expect(screen.getByText("(Profile not found)")).toBeInTheDocument();
  });

  describe("module selection labels", () => {
    beforeEach(() => {
      mockConfig = {
        subjects: [],
        modules: ["structural", "asl"],
        selectedProfileId: "profile-1",
        workers: 4,
      };
    });

    it("renders ASL checkbox with label 'ASL' in uppercase", () => {
      renderConfig();
      expect(screen.getByLabelText("ASL")).toBeInTheDocument();
      expect(screen.queryByLabelText("Asl")).not.toBeInTheDocument();
    });

    it("renders ProfileSelector instead of MATLAB path select", () => {
      renderConfig();
      expect(screen.getByTestId("profile-selector")).toBeInTheDocument();
      expect(screen.queryByTestId("matlab-select")).not.toBeInTheDocument();
    });
  });

  describe("module toggle interactions", () => {
    beforeEach(() => {
      mockConfig = {
        subjects: [],
        modules: ["population"],
        selectedProfileId: "profile-1",
        workers: 1,
      };
      mockSetConfig.mockClear();
    });

    it.each(["structural", "asl"])("unchecks population when %s checkbox is clicked", (module) => {
      renderConfig();
      const structuralCheckbox = screen.getByLabelText(
        module === "structural" ? "Structural" : "ASL",
      );
      fireEvent.click(structuralCheckbox);

      expect(mockSetConfig).toHaveBeenCalled();
      const calledConfig = mockSetConfig.mock.calls[0][0](mockConfig);
      expect(calledConfig.modules).toContain(module);
      expect(calledConfig.modules).not.toContain("population");
    });
  });

  describe("BIDS2Legacy rerun toggle", () => {
    beforeEach(() => {
      mockConfig = {
        subjects: [],
        modules: ["structural"],
        selectedProfileId: "profile-1",
        workers: 2,
        rerunBids2Legacy: false,
      };
      mockSetConfig.mockClear();
    });

    it("renders rerun BIDS2Legacy checkbox", () => {
      renderConfig();
      expect(
        screen.getByLabelText(
          "Force re-sync between imported/BIDS data and preliminary ExploreASL derivatives",
        ),
      ).toBeInTheDocument();
    });

    it("calls setConfig when checkbox is clicked", () => {
      renderConfig();
      const checkbox = screen.getByLabelText(
        "Force re-sync between imported/BIDS data and preliminary ExploreASL derivatives",
      );
      fireEvent.click(checkbox);

      expect(mockSetConfig).toHaveBeenCalled();
      const calledConfig = mockSetConfig.mock.calls[0][0](mockConfig);
      expect(calledConfig.rerunBids2Legacy).toBe(true);
    });

    it("disables checkbox if neither structural nor ASL is selected", () => {
      mockConfig = {
        subjects: [],
        modules: ["population"],
        selectedProfileId: "profile-1",
        workers: 1,
        rerunBids2Legacy: false,
      };
      renderConfig();
      const checkbox = screen.getByLabelText(
        "Force re-sync between imported/BIDS data and preliminary ExploreASL derivatives",
      );
      expect(checkbox).toBeDisabled();
    });
  });
});
