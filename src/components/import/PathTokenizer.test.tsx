import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it } from "vitest";

import PathTokenizer from "./PathTokenizer";
import { useImportStore } from "../../stores/importStore";
import type { PathPattern } from "../../schemas/importSchemas";

const SAMPLE_PATTERNS: PathPattern[] = [
  {
    signature: "VARYING/VARYING/VARYING",
    samplePath: "BAR/05022026_01/sernum-0001_ser-AAHead_Scout",
    blocks: ["BAR", "05022026_01", "sernum-0001_ser-AAHead_Scout"],
    uniqueNames: {
      0: ["BAR", "FOO"],
      1: ["05022026_01"],
      2: [
        "sernum-0001_ser-AAHead_Scout",
        "sernum-0018_ser-pcasl_3d_multiTI",
      ],
    },
    count: 4,
    depth: 3,
  },
];

function renderWithProviders() {
  return render(
    <MantineProvider>
      <PathTokenizer />
    </MantineProvider>,
  );
}

afterEach(() => {
  useImportStore.getState().resetImport();
});

describe("PathTokenizer", () => {
  it("renders the title", () => {
    renderWithProviders();
    expect(screen.getByText("Path Tokenizer")).toBeInTheDocument();
  });

  it("renders pattern cards for discovered patterns", () => {
    useImportStore.getState().setIngestionResults([], SAMPLE_PATTERNS);
    renderWithProviders();

    const cards = screen.queryAllByTestId(
      "pattern-card-VARYING/VARYING/VARYING",
    );
    expect(cards.length).toBeGreaterThan(0);
  });

  it("renders blocks from sample path", () => {
    useImportStore.getState().setIngestionResults([], SAMPLE_PATTERNS);
    renderWithProviders();

    // BAR should appear as badge text — use queryAllByText to handle Mantine duplicates
    const barElements = screen.queryAllByText("BAR");
    expect(barElements.length).toBeGreaterThan(0);
  });

  it("uses Ignore as the only non-semantic dropdown label", () => {
    useImportStore.getState().setIngestionResults([], SAMPLE_PATTERNS);
    renderWithProviders();

    expect(screen.queryByText("— None —")).not.toBeInTheDocument();
    expect(screen.queryAllByText("Ignore").length).toBeGreaterThan(0);
  });

  it("shows regex preview with empty assignments", () => {
    useImportStore.getState().setIngestionResults([], SAMPLE_PATTERNS);
    const { container } = renderWithProviders();

    const configTexts = screen.queryAllByText("Generated Configuration");
    expect(configTexts.length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("mantine-color-dark-7");
    expect(container.innerHTML).not.toContain("mantine-color-dark-8");
  });

  it("disables next button without Subject and Modality assignments", () => {
    useImportStore.getState().setIngestionResults([], SAMPLE_PATTERNS);
    renderWithProviders();

    const nextButtons = screen.queryAllByText(/Next: Resolve Aliases/);
    expect(nextButtons.length).toBeGreaterThan(0);

    // The button containing "Next" should be disabled
    const nextBtn = nextButtons[0].closest("button");
    expect(nextBtn).toBeDisabled();
  });

  it("enables next button when Subject and Modality are assigned", () => {
    useImportStore.getState().setIngestionResults(
      ["/data/BAR/05022026_01/sernum-0001_ser-AAHead_Scout"],
      SAMPLE_PATTERNS,
    );
    useImportStore
      .getState()
      .setTokenAssignment("VARYING/VARYING/VARYING", 0, null, "Subject");
    useImportStore
      .getState()
      .setTokenAssignment("VARYING/VARYING/VARYING", 2, null, "Modality");
    renderWithProviders();

    const nextButtons = screen.queryAllByText(/Next: Resolve Aliases/);
    const nextBtn = nextButtons[0].closest("button");
    expect(nextBtn).not.toBeDisabled();
  });

  it("renders back button", () => {
    renderWithProviders();
    const backButtons = screen.queryAllByText(/Back: Ingest DICOMs/);
    expect(backButtons.length).toBeGreaterThan(0);
  });
});
