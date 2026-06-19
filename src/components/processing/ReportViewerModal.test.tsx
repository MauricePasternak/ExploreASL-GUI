import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import ReportViewerModal from "./ReportViewerModal";
import * as reportViewer from "../../lib/reportViewer";

// Mock reportViewer API module
vi.mock("../../lib/reportViewer", () => ({
  fetchReportImage: vi.fn(),
  fetchSubjectReports: vi.fn(),
}));

describe("ReportViewerModal", () => {
  const mockCreateObjectURL = vi.fn((_blob: Blob) => "blob:test-url");
  const mockRevokeObjectURL = vi.fn();

  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.URL.createObjectURL = mockCreateObjectURL as any;
    window.URL.revokeObjectURL = mockRevokeObjectURL;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderModal = (props: any) => {
    return render(
      <MantineProvider>
        <ReportViewerModal {...props} />
      </MantineProvider>,
    );
  };

  it("does not render when closed", () => {
    renderModal({
      opened: false,
      onClose: vi.fn(),
      projectRoot: "/mock-project",
      subjectSession: "sub-C9ORF007Philips_01",
      module: "structural",
    });

    expect(screen.queryByTestId("report-heading")).not.toBeInTheDocument();
  });

  it("renders structural report correctly", async () => {
    const fetchSpy = vi
      .spyOn(reportViewer, "fetchReportImage")
      .mockResolvedValue(new Uint8Array([1, 2, 3]));

    renderModal({
      opened: true,
      onClose: vi.fn(),
      projectRoot: "/mock-project",
      subjectSession: "sub-C9ORF007Philips_01",
      module: "structural",
    });

    // Check loading indicator shows up for axial and coronal views
    expect(screen.getByTestId("axial-loading")).toBeInTheDocument();
    expect(screen.getByTestId("coronal-loading")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId("axial-loading")).not.toBeInTheDocument();
      expect(screen.queryByTestId("coronal-loading")).not.toBeInTheDocument();
    });

    // Verify title and heading text
    expect(screen.getByTestId("report-heading")).toHaveTextContent(
      "Registration to standard space and white matter segmentation for Subject C9ORF007Philips Session 01",
    );

    // Verify descriptions
    expect(screen.getByTestId("report-description")).toHaveTextContent(
      "This report displays the registration of the structural T1w image to standard space",
    );

    // Verify images rendered
    expect(screen.getByTestId("axial-image")).toBeInTheDocument();
    expect(screen.getByTestId("coronal-image")).toBeInTheDocument();

    // Verify correct files fetched from Rust backend (viewType axial and coronal, run is undefined)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/mock-project",
      "sub-C9ORF007Philips_01",
      "structural",
      undefined,
      "axial",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/mock-project",
      "sub-C9ORF007Philips_01",
      "structural",
      undefined,
      "coronal",
    );

    expect(mockCreateObjectURL).toHaveBeenCalledTimes(2);
  });

  it("renders ASL report with run selector when multi-run, including M0-ASL section", async () => {
    const fetchSpy = vi
      .spyOn(reportViewer, "fetchReportImage")
      .mockResolvedValue(new Uint8Array([4, 5, 6]));

    renderModal({
      opened: true,
      onClose: vi.fn(),
      projectRoot: "/mock-project",
      subjectSession: "sub-C9ORF007Philips_01",
      module: "asl",
      runs: ["1", "2"],
    });

    // Wait for all 4 images to load (asl-axial, asl-coronal, m0-axial, m0-coronal)
    await waitFor(() => {
      expect(screen.queryByTestId("asl-axial-loading")).not.toBeInTheDocument();
      expect(screen.queryByTestId("asl-coronal-loading")).not.toBeInTheDocument();
      expect(screen.queryByTestId("m0-axial-loading")).not.toBeInTheDocument();
      expect(screen.queryByTestId("m0-coronal-loading")).not.toBeInTheDocument();
    });

    // Verify headings
    expect(screen.getByTestId("asl-struct-heading")).toHaveTextContent(
      "ASL-Structural Registration for Subject C9ORF007Philips Session 01 [Run 1]",
    );
    expect(screen.getByTestId("m0-asl-heading")).toHaveTextContent(
      "M0-ASL Registration for Subject C9ORF007Philips Session 01 [Run 1]",
    );

    // Verify all 4 images are displayed
    expect(screen.getByTestId("asl-axial-image")).toBeInTheDocument();
    expect(screen.getByTestId("asl-coronal-image")).toBeInTheDocument();
    expect(screen.getByTestId("m0-axial-image")).toBeInTheDocument();
    expect(screen.getByTestId("m0-coronal-image")).toBeInTheDocument();

    // Verify run Select is present
    const select = screen.getByTestId("report-run-select");
    expect(select).toBeInTheDocument();

    // Expect initial fetches for Run 1
    expect(fetchSpy).toHaveBeenCalledWith(
      "/mock-project",
      "sub-C9ORF007Philips_01",
      "asl",
      "1",
      "axial",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/mock-project",
      "sub-C9ORF007Philips_01",
      "asl",
      "1",
      "coronal",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/mock-project",
      "sub-C9ORF007Philips_01",
      "m0",
      "1",
      "axial",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/mock-project",
      "sub-C9ORF007Philips_01",
      "m0",
      "1",
      "coronal",
    );

    // Click on the select input to open the dropdown
    fireEvent.click(select);

    // Click on the option "Run 2"
    const option2 = screen.getByText("Run 2");
    fireEvent.click(option2);

    // Expect cleanup of previous blob URLs and new fetches for Run 2
    await waitFor(() => {
      expect(mockRevokeObjectURL).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(
        "/mock-project",
        "sub-C9ORF007Philips_01",
        "asl",
        "2",
        "axial",
      );
    });
  });

  it("handles partial fetch failures robustly (e.g. M0 missing but ASL succeeds)", async () => {
    // Mock ASL succeeds, M0 fails
    vi.spyOn(reportViewer, "fetchReportImage").mockImplementation(
      async (_projectRoot, _subjectSession, module, _run, _view) => {
        if (module === "m0") {
          throw new Error("M0 image missing");
        }
        return new Uint8Array([7, 8, 9]);
      },
    );

    renderModal({
      opened: true,
      onClose: vi.fn(),
      projectRoot: "/mock-project",
      subjectSession: "sub-C9ORF007Philips_01",
      module: "asl",
      runs: ["1"],
    });

    // Wait for load completion
    await waitFor(() => {
      expect(screen.queryByTestId("asl-axial-loading")).not.toBeInTheDocument();
      expect(screen.queryByTestId("asl-coronal-loading")).not.toBeInTheDocument();
      expect(screen.queryByTestId("m0-axial-loading")).not.toBeInTheDocument();
      expect(screen.queryByTestId("m0-coronal-loading")).not.toBeInTheDocument();
    });

    // ASL images should be rendered
    expect(screen.getByTestId("asl-axial-image")).toBeInTheDocument();
    expect(screen.getByTestId("asl-coronal-image")).toBeInTheDocument();

    // M0 images should not be rendered, instead showing error states
    expect(screen.queryByTestId("m0-axial-image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("m0-coronal-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("m0-axial-error")).toHaveTextContent(
      "M0-ASL axial registration image not found.",
    );
    expect(screen.getByTestId("m0-coronal-error")).toHaveTextContent(
      "M0-ASL coronal registration image not found.",
    );
  });

  it("handles corrupted images / browser decode failures gracefully", async () => {
    vi.spyOn(reportViewer, "fetchReportImage").mockResolvedValue(new Uint8Array([1, 2, 3]));

    renderModal({
      opened: true,
      onClose: vi.fn(),
      projectRoot: "/mock-project",
      subjectSession: "sub-C9ORF007Philips_01",
      module: "structural",
    });

    await waitFor(() => {
      expect(screen.queryByTestId("axial-loading")).not.toBeInTheDocument();
    });

    const img = screen.getByTestId("axial-image");
    expect(img).toBeInTheDocument();

    // Trigger image decoding error
    fireEvent.error(img);

    await waitFor(() => {
      expect(screen.queryByTestId("axial-image")).not.toBeInTheDocument();
      expect(screen.getByTestId("axial-error")).toHaveTextContent(
        "Structural axial registration image not found.",
      );
    });
  });
});
