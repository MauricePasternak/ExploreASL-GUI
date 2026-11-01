import { TestMantineProvider as MantineProvider } from "../../test/render";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as reportViewer from "../../lib/reportViewer";
import ReportViewerModal from "./ReportViewerModal";

// Mock reportViewer API module
vi.mock("../../lib/reportViewer", () => ({
  fetchReportImage: vi.fn(),
  fetchSubjectReports: vi.fn(),
  fetchSubjectQC: vi.fn(),
}));

describe("ReportViewerModal", () => {
  let nextUrl = 0;
  const mockCreateObjectURL = vi.fn((_blob: Blob) => `blob:test-url-${nextUrl++}`);
  const mockRevokeObjectURL = vi.fn();

  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.URL.createObjectURL = mockCreateObjectURL as any;
    window.URL.revokeObjectURL = mockRevokeObjectURL;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    nextUrl = 0;
    vi.spyOn(reportViewer, "fetchSubjectQC").mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  const renderModal = (props: any) => {
    return render(<ReportViewerModal {...props} />, { wrapper: MantineProvider });
  };

  it("does not render when closed", () => {
    renderModal({
      opened: false,
      onClose: vi.fn(),
      projectRoot: "/mock-project",
      subjectSession: "sub-001Philips_01",
      module: "structural",
    });

    expect(screen.queryByTestId("report-heading")).not.toBeInTheDocument();
    expect(reportViewer.fetchReportImage).not.toHaveBeenCalled();
  });

  it.each([{ projectRoot: undefined }, { subjectSession: "" }])(
    "does not fetch images with missing report inputs: %j",
    async (missingInput) => {
      renderModal({
        opened: true,
        onClose: vi.fn(),
        projectRoot: "/mock-project",
        subjectSession: "sub-001Philips_01",
        module: "structural",
        ...missingInput,
      });

      expect(reportViewer.fetchReportImage).not.toHaveBeenCalled();
      expect(screen.queryByTestId("axial-loading")).not.toBeInTheDocument();
    },
  );

  it("renders structural report correctly", async () => {
    const fetchSpy = vi
      .spyOn(reportViewer, "fetchReportImage")
      .mockResolvedValue(new Uint8Array([1, 2, 3]));

    renderModal({
      opened: true,
      onClose: vi.fn(),
      projectRoot: "/mock-project",
      subjectSession: "sub-001Philips_01",
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
      "Registration to standard space and white matter segmentation for Subject 001Philips Session 01",
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
      "sub-001Philips_01",
      "structural",
      undefined,
      "axial",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/mock-project",
      "sub-001Philips_01",
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
      subjectSession: "sub-001Philips_01",
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
      "ASL-Structural Registration for Subject 001Philips Session 01 [Run 1]",
    );
    expect(screen.getByTestId("m0-asl-heading")).toHaveTextContent(
      "M0-ASL Registration for Subject 001Philips Session 01 [Run 1]",
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
      "sub-001Philips_01",
      "asl",
      "1",
      "axial",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/mock-project",
      "sub-001Philips_01",
      "asl",
      "1",
      "coronal",
    );
    expect(fetchSpy).toHaveBeenCalledWith("/mock-project", "sub-001Philips_01", "m0", "1", "axial");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/mock-project",
      "sub-001Philips_01",
      "m0",
      "1",
      "coronal",
    );

    const previousUrls = mockCreateObjectURL.mock.results.map(({ value }) => value);
    fireEvent.error(screen.getByTestId("asl-axial-image"));
    expect(screen.getByTestId("asl-axial-error")).toBeInTheDocument();

    // Click on the select input to open the dropdown
    fireEvent.click(select);

    // Click on the option "Run 2"
    const option2 = screen.getByText("Run 2");
    fireEvent.click(option2);

    // Expect cleanup of previous blob URLs and new fetches for Run 2
    await waitFor(() => {
      for (const prefix of ["asl-axial", "asl-coronal", "m0-axial", "m0-coronal"]) {
        expect(screen.getByTestId(`${prefix}-image`)).toBeInTheDocument();
        expect(screen.queryByTestId(`${prefix}-error`)).not.toBeInTheDocument();
      }
      expect(fetchSpy).toHaveBeenCalledWith(
        "/mock-project",
        "sub-001Philips_01",
        "asl",
        "2",
        "axial",
      );
    });
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(8);
    expect(mockRevokeObjectURL.mock.calls).toEqual(previousUrls.map((url) => [url]));
  });

  it.each([
    { change: "project", changedProps: { projectRoot: "/other-project" } },
    { change: "subject/session", changedProps: { subjectSession: "sub-002Philips_02" } },
    { change: "module", changedProps: { module: "structural" as const } },
    { change: "run", changedProps: { runs: ["2"] } },
    { change: "close", changedProps: { opened: false } },
    { change: "unmount", changedProps: null },
  ])("cleans up URLs and ignores stale results after $change", async ({ changedProps }) => {
    const pending: {
      resolve: (bytes: Uint8Array) => void;
      reject: (error: Error) => void;
    }[] = [];
    vi.spyOn(reportViewer, "fetchReportImage").mockImplementation(
      () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    );
    const props = {
      opened: true,
      onClose: vi.fn(),
      projectRoot: "/mock-project",
      subjectSession: "sub-001Philips_01",
      module: "asl" as const,
      runs: ["1", "2"],
    };
    const { rerender, unmount } = renderModal(props);
    expect(pending).toHaveLength(4);

    // One image has a URL; three requests remain in flight when the report changes.
    await act(async () => pending[0].resolve(new Uint8Array([1])));
    expect(screen.getByTestId("asl-axial-image")).toBeInTheDocument();
    const firstUrl = mockCreateObjectURL.mock.results[0].value;

    if (changedProps) {
      rerender(<ReportViewerModal {...props} {...changedProps} />);
    } else {
      unmount();
    }
    const replacementImages =
      !changedProps || changedProps.opened === false
        ? 0
        : changedProps.module === "structural"
          ? 2
          : 4;
    expect(pending).toHaveLength(4 + replacementImages);
    expect(mockRevokeObjectURL.mock.calls).toEqual([[firstUrl]]);

    await act(async () => {
      pending[1].resolve(new Uint8Array([2]));
      pending[2].reject(new Error("Stale image failure"));
      pending[3].resolve(new Uint8Array([3]));
    });
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    for (const prefix of [
      "axial",
      "coronal",
      "asl-axial",
      "asl-coronal",
      "m0-axial",
      "m0-coronal",
    ]) {
      expect(screen.queryByTestId(`${prefix}-image`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`${prefix}-error`)).not.toBeInTheDocument();
    }

    // Only the replacement report may create URLs, and each URL must be revoked once.
    await act(async () => {
      pending.slice(4).forEach(({ resolve }) => resolve(new Uint8Array([4])));
    });
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1 + replacementImages);
    expect(screen.queryAllByRole("img")).toHaveLength(replacementImages);
    unmount();
    expect(mockRevokeObjectURL.mock.calls).toEqual(
      mockCreateObjectURL.mock.results.map(({ value }) => [value]),
    );
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
      subjectSession: "sub-001Philips_01",
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
      subjectSession: "sub-001Philips_01",
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

  it("renders quality control metrics table correctly", async () => {
    vi.spyOn(reportViewer, "fetchReportImage").mockResolvedValue(new Uint8Array([1, 2, 3]));
    const qcSpy = vi.spyOn(reportViewer, "fetchSubjectQC").mockResolvedValue([
      {
        key: "T1w_GM_ICV_Ratio",
        value: "0.437",
      },
      { key: "T1w_GM_vol_mL", value: "640" },
    ]);

    renderModal({
      opened: true,
      onClose: vi.fn(),
      projectRoot: "/mock-project",
      subjectSession: "sub-001Philips_01",
      module: "structural",
    });

    expect(screen.getByTestId("qc-metrics-heading")).toHaveTextContent("Quality Control Metrics");

    await waitFor(() => {
      expect(screen.getByTestId("qc-metrics-table")).toBeInTheDocument();
    });

    expect(screen.getByTestId("qc-label-T1w_GM_ICV_Ratio")).toHaveTextContent(
      "Ratio of Gray Matter vs Intra-cortical Volume",
    );
    expect(screen.getByTestId("qc-value-T1w_GM_ICV_Ratio")).toHaveTextContent("0.437");

    expect(screen.getByTestId("qc-label-T1w_GM_vol_mL")).toHaveTextContent(
      "Gray Matter Volume (mL)",
    );
    expect(screen.getByTestId("qc-value-T1w_GM_vol_mL")).toHaveTextContent("640");

    expect(qcSpy).toHaveBeenCalledWith(
      "/mock-project",
      "sub-001Philips_01",
      "structural",
      undefined,
    );
  });

  it("handles quality control metrics load error", async () => {
    vi.spyOn(reportViewer, "fetchReportImage").mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.spyOn(reportViewer, "fetchSubjectQC").mockRejectedValue(new Error("QC Load Failed"));

    renderModal({
      opened: true,
      onClose: vi.fn(),
      projectRoot: "/mock-project",
      subjectSession: "sub-001Philips_01",
      module: "structural",
    });

    await waitFor(() => {
      expect(screen.getByTestId("qc-metrics-error")).toHaveTextContent(
        "Failed to load Quality Control metrics.",
      );
    });
  });
});
