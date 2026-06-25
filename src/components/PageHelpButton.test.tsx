import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useImportStore } from "../stores/importStore";
import { useVisualizationStore } from "../stores/visualizationStore";
import PageHelpButton from "./PageHelpButton";

const mockNavigate = vi.fn();

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("PageHelpButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useImportStore.getState().resetImport();
  });

  afterEach(() => {
    cleanup();
  });

  const renderComponent = (initialPath: string) => {
    return render(
      <MantineProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/project/:id/:phase" element={<PageHelpButton />} />
            <Route path="/overview" element={<div>Overview Page</div>} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );
  };

  it("does not render when not on a project route", () => {
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<PageHelpButton />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(screen.queryByTestId("page-help-btn")).not.toBeInTheDocument();
  });

  it("renders on project import route and displays step 1 help", async () => {
    useImportStore.setState({ activeStep: 0 });
    renderComponent("/project/proj1/import");

    const helpBtn = screen.getByTestId("page-help-btn");
    expect(helpBtn).toBeInTheDocument();

    // Modal is initially closed
    expect(screen.queryByText("Ingest DICOMs")).not.toBeInTheDocument();

    // Click help button to open modal
    fireEvent.click(helpBtn);

    // Verify step 1 help content is displayed
    await waitFor(() => {
      expect(screen.getByTestId("page-help-modal")).toBeInTheDocument();
      expect(screen.getByText("Ingest DICOMs")).toBeInTheDocument();
      expect(screen.getByText(/Scan a local raw data directory/i)).toBeInTheDocument();
      expect(screen.getByText(/Click 'Select Source Directory'/i)).toBeInTheDocument();
    });
  });

  it("renders step 3 help on import route when activeStep is 2", async () => {
    useImportStore.setState({ activeStep: 2 });
    renderComponent("/project/proj1/import");

    const helpBtn = screen.getByTestId("page-help-btn");
    fireEvent.click(helpBtn);

    await waitFor(() => {
      expect(screen.getByText("Resolve Aliases")).toBeInTheDocument();
      expect(
        screen.getByText(/Map raw scanner labels to standardized BIDS modalities/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Subject Rename: Click to rename subjects/i)).toBeInTheDocument();
    });
  });

  it("renders parameters help when on parameters phase", async () => {
    renderComponent("/project/proj1/parameters");

    const helpBtn = screen.getByTestId("page-help-btn");
    fireEvent.click(helpBtn);

    await waitFor(() => {
      expect(screen.getByText("Configure Pipeline Parameters")).toBeInTheDocument();
      expect(
        screen.getByText(/Fine-tune and customize the processing options/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Navigate through the tabs: Structural, ASL, Population/i),
      ).toBeInTheDocument();
    });
  });

  it("renders processing help when on processing phase", async () => {
    renderComponent("/project/proj1/processing");

    const helpBtn = screen.getByTestId("page-help-btn");
    fireEvent.click(helpBtn);

    await waitFor(() => {
      expect(screen.getByText("Run Processing Pipeline")).toBeInTheDocument();
      expect(
        screen.getByText(/Select subjects and execute the main ExploreASL processing modules/i),
      ).toBeInTheDocument();
    });
  });

  it("navigates to overview page when clicking overview button in modal", async () => {
    useImportStore.setState({ activeStep: 0 });
    renderComponent("/project/proj1/import");

    const helpBtn = screen.getByTestId("page-help-btn");
    fireEvent.click(helpBtn);

    let overviewBtn: HTMLElement | null = null;
    await waitFor(() => {
      overviewBtn = screen.getByTestId("page-help-modal-overview-btn");
      expect(overviewBtn).toBeInTheDocument();
    });

    fireEvent.click(overviewBtn!);

    expect(mockNavigate).toHaveBeenCalledWith("/overview", {
      state: { from: "/project/proj1/import" },
    });
    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText("Ingest DICOMs")).not.toBeInTheDocument();
    });
  });

  it("renders selectData help on visualization route", async () => {
    useVisualizationStore.setState({ stage: "selectData" });
    renderComponent("/project/proj1/visualization");

    const helpBtn = screen.getByTestId("page-help-btn");
    fireEvent.click(helpBtn);

    await waitFor(() => {
      expect(screen.getByText("Select Data Source")).toBeInTheDocument();
      expect(
        screen.getByText(/Choose a qCBF stats file and optionally join external covariates/i),
      ).toBeInTheDocument();
    });
  });

  it("renders columnTypes help on visualization route", async () => {
    useVisualizationStore.setState({ stage: "columnTypes" });
    renderComponent("/project/proj1/visualization");

    const helpBtn = screen.getByTestId("page-help-btn");
    fireEvent.click(helpBtn);

    await waitFor(() => {
      expect(screen.getByText("Assign Column Types")).toBeInTheDocument();
      expect(
        screen.getByText(/Review and adjust the automatically inferred type/i),
      ).toBeInTheDocument();
    });
  });

  it("renders levelOrdering help on visualization route", async () => {
    useVisualizationStore.setState({ stage: "levelOrdering" });
    renderComponent("/project/proj1/visualization");

    const helpBtn = screen.getByTestId("page-help-btn");
    fireEvent.click(helpBtn);

    await waitFor(() => {
      expect(screen.getByText("Order Categorical Levels")).toBeInTheDocument();
      expect(screen.getByText(/Control the display order of categories/i)).toBeInTheDocument();
    });
  });

  it("renders visualize help on visualization route", async () => {
    useVisualizationStore.setState({ stage: "visualize" });
    renderComponent("/project/proj1/visualization");

    const helpBtn = screen.getByTestId("page-help-btn");
    fireEvent.click(helpBtn);

    await waitFor(() => {
      expect(screen.getByText("Explore Data")).toBeInTheDocument();
      expect(
        screen.getByText(/Assign axes, inspect charts, and view qCBF brain images/i),
      ).toBeInTheDocument();
    });
  });
});
