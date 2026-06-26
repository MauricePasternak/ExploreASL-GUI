import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useVisualizationStore } from "../../stores/visualizationStore";
import AxisAssignment from "./AxisAssignment";

afterEach(cleanup);

function renderComponent() {
  return render(
    <MantineProvider>
      <AxisAssignment />
    </MantineProvider>,
  );
}

describe("AxisAssignment", () => {
  beforeEach(() => {
    useVisualizationStore.setState({
      inspection: null,
      columnTypes: {},
      axisAssignment: { x: null, y: null, colorBy: null },
    });
  });

  it("renders nothing when inspection is null", () => {
    const { container } = renderComponent();
    expect(container.querySelector("[data-testid='axis-assignment']")).toBeNull();
  });

  it("renders selects when inspection is provided", () => {
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "age",
            originalName: "age",
            source: "qcbf",
            units: "years",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
          {
            name: "group",
            originalName: "group",
            source: "qcbf",
            units: "",
            inferredType: "nominal",
            levels: ["A", "B"],
            isIdentifier: false,
          },
          {
            name: "score",
            originalName: "score",
            source: "qcbf",
            units: "",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
        ],
        rowCount: 10,
        qcbfRowCount: 10,
        qcbfHash: "abc",
        externalHash: null,
      },
      columnTypes: {
        age: "continuous",
        group: "nominal",
        score: "continuous",
      },
    });

    renderComponent();
    expect(screen.getByTestId("axis-assignment")).toBeInTheDocument();
    expect(screen.getByTestId("x-axis-select")).toBeInTheDocument();
    expect(screen.getByTestId("y-axis-select")).toBeInTheDocument();
    expect(screen.getByTestId("color-by-select")).toBeInTheDocument();
  });

  it("filters excluded columns from all selects", () => {
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "age",
            originalName: "age",
            source: "qcbf",
            units: "years",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
          {
            name: "id",
            originalName: "id",
            source: "qcbf",
            units: "",
            inferredType: "nominal",
            levels: [],
            isIdentifier: true,
          },
          {
            name: "group",
            originalName: "group",
            source: "qcbf",
            units: "",
            inferredType: "nominal",
            levels: ["A", "B"],
            isIdentifier: false,
          },
        ],
        rowCount: 10,
        qcbfRowCount: 10,
        qcbfHash: "abc",
        externalHash: null,
      },
      columnTypes: {
        age: "continuous",
        id: "excluded",
        group: "nominal",
      },
    });

    renderComponent();
    expect(screen.getByTestId("axis-assignment")).toBeInTheDocument();
  });

  it("only shows continuous columns in Y-axis select", () => {
    useVisualizationStore.setState({
      inspection: {
        columns: [
          {
            name: "age",
            originalName: "age",
            source: "qcbf",
            units: "years",
            inferredType: "continuous",
            levels: [],
            isIdentifier: false,
          },
          {
            name: "group",
            originalName: "group",
            source: "qcbf",
            units: "",
            inferredType: "nominal",
            levels: ["A", "B"],
            isIdentifier: false,
          },
        ],
        rowCount: 10,
        qcbfRowCount: 10,
        qcbfHash: "abc",
        externalHash: null,
      },
      columnTypes: {
        age: "continuous",
        group: "nominal",
      },
    });

    renderComponent();
    expect(screen.getByTestId("y-axis-select")).toBeInTheDocument();
  });
});
