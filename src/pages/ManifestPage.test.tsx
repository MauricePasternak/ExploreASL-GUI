import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManifestPage from "./ManifestPage";

let mockStep = 0;

vi.mock("../stores/manifestStore", () => ({
  useManifestStore: vi.fn((selector?: any) => {
    const state = { step: mockStep, setStep: vi.fn(), filter: "all", staleVerdicts: new Set() };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("../components/manifest/QcSelectionTable", () => ({
  default: vi.fn(() => <div data-testid="qc-selection-table">QC Table</div>),
}));
vi.mock("../components/manifest/ManifestPreview", () => ({
  default: vi.fn(() => <div data-testid="manifest-preview">Preview</div>),
}));

vi.mock("../stores/projectStore", () => ({
  useProjectStore: vi.fn(() => ({})),
}));
vi.mock("../stores/processingStore", () => ({
  useProcessingStore: vi.fn(() => ({ availableSubjects: [], subjectStatuses: [] })),
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
});
