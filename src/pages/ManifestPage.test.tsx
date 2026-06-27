import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManifestPage from "./ManifestPage";

let mockStep = 0;
const mockSetStep = vi.fn();
const mockRecomputeStaleVerdicts = vi.fn();
const mockLoadQcData = vi.fn();
const mockLoadDataPar = vi.fn();

vi.mock("../stores/manifestStore", () => ({
  useManifestStore: vi.fn((selector?: any) => {
    const state = {
      step: mockStep,
      setStep: mockSetStep,
      filter: "all",
      staleVerdicts: new Set(),
      recomputeStaleVerdicts: mockRecomputeStaleVerdicts,
      loadQcData: mockLoadQcData,
      loadDataPar: mockLoadDataPar,
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("../components/manifest/QcSelectionTable", () => ({
  default: vi.fn(({ onNextReady }) => {
    return (
      <div data-testid="qc-selection-table">
        QC Table
        <button data-testid="trigger-ready" onClick={() => onNextReady?.(true)}>
          Ready
        </button>
        <button data-testid="trigger-unready" onClick={() => onNextReady?.(false)}>
          Unready
        </button>
      </div>
    );
  }),
}));

vi.mock("../components/manifest/ManifestPreview", () => ({
  default: vi.fn(() => <div data-testid="manifest-preview">Preview</div>),
}));

vi.mock("../stores/projectStore", () => ({
  useProjectStore: vi.fn((selector?: any) => {
    const state = {
      project: {
        projectMeta: { rootPath: "/test/project" },
        uiState: { manifest: { verdicts: {} } },
      },
    };
    return selector ? selector(state) : state;
  }),
}));

function renderPage() {
  return render(
    <MantineProvider>
      <ManifestPage />
    </MantineProvider>,
  );
}

describe("ManifestPage", () => {
  afterEach(() => {
    cleanup();
    mockStep = 0;
    vi.clearAllMocks();
  });

  it("renders stepper with 2 steps, defaults to step 0", () => {
    renderPage();
    expect(screen.getByTestId("manifest-page")).toBeInTheDocument();
    expect(screen.getByTestId("manifest-stepper")).toBeInTheDocument();
    expect(screen.getByTestId("qc-selection-table")).toBeInTheDocument();
    expect(screen.queryByTestId("manifest-preview")).not.toBeInTheDocument();
  });

  it("renders ManifestPreview on step 1", () => {
    mockStep = 1;
    renderPage();
    expect(screen.getByTestId("manifest-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("qc-selection-table")).not.toBeInTheDocument();
  });

  it("Next button is disabled by default and progression is gated", () => {
    renderPage();
    const nextBtn = screen.getByTestId("next-button");
    expect(nextBtn).toBeDisabled();
  });
});
