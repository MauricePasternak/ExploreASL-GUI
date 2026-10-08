import { cleanup, render, screen } from "@testing-library/react";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, describe, expect, it } from "vitest";

import PathTokenizer from "./PathTokenizer";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import { projectFixture } from "../../test/projectFixtures";
import type { PathPattern } from "../../schemas/importSchemas";

const SAMPLE_PATTERNS: PathPattern[] = [
  {
    signature: "VARYING/VARYING/VARYING",
    samplePath: "BAR/05022026_01/sernum-0001_ser-AAHead_Scout",
    blocks: ["BAR", "05022026_01", "sernum-0001_ser-AAHead_Scout"],
    uniqueNames: {
      0: ["BAR", "FOO"],
      1: ["05022026_01"],
      2: ["sernum-0001_ser-AAHead_Scout", "sernum-0018_ser-pcasl_3d_multiTI"],
    },
    count: 4,
    depth: 3,
  },
];

function renderWithProviders() {
  return render(
    <MantineProvider env="test">
      <PathTokenizer />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  useImportStore.getState().resetImport();
  useProjectStore.setState(useProjectStore.getInitialState(), true);
});

describe("PathTokenizer", () => {
  it("renders the title", () => {
    renderWithProviders();
    expect(screen.getByText("Path Tokenizer")).toBeInTheDocument();
  });

  it("renders pattern cards for discovered patterns", () => {
    const snapshot = projectFixture();
    snapshot.document.mappingState.pathPatterns = SAMPLE_PATTERNS;
    useProjectStore.getState().acceptSnapshot(snapshot);
    const { container } = renderWithProviders();
    expect(screen.queryAllByTestId("pattern-card-VARYING/VARYING/VARYING").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryAllByText("BAR").length).toBeGreaterThan(0);
    expect(screen.queryByText("— None —")).not.toBeInTheDocument();
    expect(screen.queryAllByText("Ignore").length).toBeGreaterThan(0);
    const configTexts = screen.queryAllByText("Generated Configuration");
    expect(configTexts.length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("mantine-color-dark-7");
    expect(container.innerHTML).not.toContain("mantine-color-dark-8");
    const nextButtons = screen.queryAllByText(/Next: Resolve Aliases/);
    expect(nextButtons.length).toBeGreaterThan(0);

    const nextBtn = nextButtons[0].closest("button");
    expect(nextBtn).toBeDisabled();
  });

  it("enables next button when Subject and Modality are assigned", () => {
    const snapshot = projectFixture();
    snapshot.document.mappingState = {
      ingestionComplete: true,
      pathPatterns: SAMPLE_PATTERNS,
      tokenizerConfigs: {
        "VARYING/VARYING/VARYING": [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
          { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
        ],
      },
    };
    useProjectStore.getState().acceptSnapshot(snapshot);
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
