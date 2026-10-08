import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useVisualizationStore } from "../../stores/visualizationStore";
import AxisAssignment from "./AxisAssignment";
import { useProjectStore } from "../../stores/projectStore";
import { projectView } from "../../schemas/project";
import { projectFixture } from "../../test/projectFixtures";

afterEach(cleanup);

function renderComponent() {
  return render(
    <MantineProvider env="test">
      <AxisAssignment />
    </MantineProvider>,
  );
}

describe("AxisAssignment", () => {
  beforeEach(() => {
    useProjectStore.setState({
      project: projectView(
        projectFixture("project-1", "Project", "/project", { uiState: { dataVis: {} } }),
      ),
    });
    useVisualizationStore.setState({
      inspection: null,
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
    });

    renderComponent();
    expect(screen.getByTestId("axis-assignment")).toBeInTheDocument();
    expect(screen.getByTestId("x-axis-select")).toBeInTheDocument();
    expect(screen.getByTestId("y-axis-select")).toBeInTheDocument();
    expect(screen.getByTestId("color-by-select")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("y-axis-select"));
    expect(screen.queryByRole("option", { name: /group/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /age/ })).toBeInTheDocument();
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
    });
    Object.assign(useProjectStore.getState().project!.uiState.dataVis!, {
      columnTypes: { id: "excluded" },
    });

    renderComponent();
    fireEvent.click(screen.getByTestId("x-axis-select"));
    expect(screen.queryByRole("option", { name: /id/ })).not.toBeInTheDocument();
  });
});
