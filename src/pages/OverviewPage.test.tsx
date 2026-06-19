import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router";
import OverviewPage from "./OverviewPage";

const mockNavigate = vi.fn();

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("OverviewPage", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders the overview page and all 4 major workflow headings", () => {
    render(
      <MantineProvider>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    // Verify main page title
    expect(screen.getByTestId("overview-title")).toBeInTheDocument();
    expect(screen.getByText(/ExploreASL GUI Overview/i)).toBeInTheDocument();

    // Verify nomenclature transition alert/callout
    expect(screen.getByTestId("nomenclature-callout")).toBeInTheDocument();

    // Verify major headings (H1 structure represented by Titles)
    expect(screen.getByRole("heading", { name: /Project Management/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /1. Import from DICOM/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /2. Define Data Parameters/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /3. Process Images & Population Module/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /4. Interactive Dataset Visualization/i }),
    ).toBeInTheDocument();

    // Verify accordions/sub-steps are present in the DOM
    expect(screen.getByTestId("project-management-accordion")).toBeInTheDocument();
    expect(screen.getByTestId("project-structure-title")).toBeInTheDocument();
    expect(screen.getByTestId("import-accordion")).toBeInTheDocument();
    expect(screen.getByTestId("parameters-accordion")).toBeInTheDocument();
    expect(screen.getByTestId("processing-accordion")).toBeInTheDocument();
    expect(screen.getByTestId("visualization-accordion")).toBeInTheDocument();
  });

  it("handles navigation back to home", () => {
    render(
      <MantineProvider>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    const backBtn = screen.getByTestId("overview-back-btn");
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
