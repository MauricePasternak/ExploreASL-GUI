import { cleanup, render, screen } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StagingMappingByPattern } from "../../schemas/importSchemas";
import { TestMantineProvider } from "../../test/render";
import StagingMappingTable from "./StagingMappingTable";

vi.mock("react-virtuoso", () => ({
  TableVirtuoso: ({ style }: { style: CSSProperties }) => (
    <div style={style} data-testid="staging-table-viewport" />
  ),
}));

afterEach(cleanup);

function mapping(count: number, patternSignature: string): StagingMappingByPattern {
  return {
    patternSignature,
    pattern: {
      signature: patternSignature,
      blocks: ["SUB01", "ASL"],
      samplePath: "SUB01/ASL",
      uniqueNames: {},
      count,
      depth: 2,
    },
    assignments: [],
    entries: Array.from({ length: count }, (_, index) => ({
      subject: `SUB${index}`,
      session: "01",
      run: "01",
      runAlias: "01",
      modality: "ASL4D",
      originalSubject: `SUB${index}`,
      originalSession: "01",
      originalRun: "01",
      sourcePath: `SUB${index}/ASL`,
    })),
  };
}

describe("StagingMappingTable sizing", () => {
  it("reserves five rows plus a header for the smaller second pattern", () => {
    render(
      <TestMantineProvider>
        <StagingMappingTable
          mappings={[mapping(8, "first"), mapping(4, "second")]}
          subjectRows={[]}
          metadataGroups={[]}
        />
      </TestMantineProvider>,
    );

    const [first, second] = screen.getAllByTestId("staging-table-viewport");
    expect(first).toHaveStyle({ height: "306px", minHeight: "306px" });
    expect(second).toHaveStyle({ height: "204px", minHeight: "204px" });
  });

  it("keeps large patterns capped at the scrollable table height", () => {
    render(
      <TestMantineProvider>
        <StagingMappingTable
          mappings={[mapping(100, "large")]}
          subjectRows={[]}
          metadataGroups={[]}
        />
      </TestMantineProvider>,
    );

    expect(screen.getByTestId("staging-table-viewport")).toHaveStyle({
      height: "400px",
      minHeight: "400px",
    });
  });
});
