import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it } from "vitest";

import JoinDiagram from "./JoinDiagram";

afterEach(cleanup);

interface ColumnInfo {
  name: string;
  isIdentifier: boolean;
}

interface ExtColumnInfo {
  name: string;
}

interface KeyPair {
  left: string;
  right: string;
}

interface JoinDiagramProps {
  qcbfFileName: string;
  qcbfRowCount: number;
  qcbfColumns: ColumnInfo[];
  extFilePath: string;
  extRowCount: number;
  extColumns: ExtColumnInfo[];
  keyPairs: KeyPair[];
}

function renderComponent(props: JoinDiagramProps) {
  return render(
    <MantineProvider>
      <JoinDiagram {...props} />
    </MantineProvider>,
  );
}

describe("JoinDiagram", () => {
  const defaultProps: JoinDiagramProps = {
    qcbfFileName: "subjects.tsv",
    qcbfRowCount: 42,
    qcbfColumns: [
      { name: "participant_id", isIdentifier: true },
      { name: "age", isIdentifier: false },
    ],
    extFilePath: "/path/to/extra.csv",
    extRowCount: 100,
    extColumns: [{ name: "Diagnosis" }, { name: "Age" }],
    keyPairs: [{ left: "participant_id", right: "Diagnosis" }],
  };

  it("renders qcbf and external columns, badges and keys", () => {
    renderComponent(defaultProps);
    expect(screen.getByTestId("join-diagram")).toBeInTheDocument();
    expect(screen.getByTestId("diagram-arrow")).toBeInTheDocument();

    // Check files and row counts
    expect(screen.getByText("subjects.tsv")).toBeInTheDocument();
    expect(screen.getByText("42 rows")).toBeInTheDocument();
    expect(screen.getByText("extra.csv")).toBeInTheDocument();
    expect(screen.getByText("100 rows")).toBeInTheDocument();

    // Check columns
    expect(screen.getByTestId("diagram-qcbf-col-participant_id")).toBeInTheDocument();
    expect(screen.getByTestId("diagram-qcbf-col-age")).toBeInTheDocument();
    expect(screen.getByTestId("diagram-ext-col-Diagnosis")).toBeInTheDocument();
    expect(screen.getByTestId("diagram-ext-col-Age")).toBeInTheDocument();

    // Check ID badge
    expect(screen.getByText("ID")).toBeInTheDocument();
  });
});
