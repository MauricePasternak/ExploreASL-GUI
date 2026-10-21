import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { appLogDir } from "@tauri-apps/api/path";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestMantineProvider as MantineProvider } from "../test/render";
import { MemoryRouter } from "react-router";
import OverviewPage from "./OverviewPage";

const mockNavigate = vi.fn();

vi.mock("@tauri-apps/api/path", () => ({
  appLogDir: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("OverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEV", false);
    vi.mocked(appLogDir).mockResolvedValue("/os/application/logs/exploreasl");
    vi.mocked(writeText).mockResolvedValue();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  it("renders the overview page and all 4 major workflow headings", () => {
    render(
      <MantineProvider env="test">
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
    expect(screen.getByRole("heading", { name: /1. Dataset Import/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /2. Define Data Parameters/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /3. Process Images & Population Module/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /4. Interactive Dataset Visualization/i }),
    ).toBeInTheDocument();

    // Verify tabs are present in the DOM
    expect(screen.getByTestId("import-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("tab-dicom")).toBeInTheDocument();
    expect(screen.getByTestId("tab-bids")).toBeInTheDocument();
    expect(screen.getByTestId("bids-direct-panel")).toBeInTheDocument();

    // Verify accordions/sub-steps are present in the DOM
    expect(screen.getByTestId("project-management-accordion")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /What is a "Project"/i }));
    expect(screen.getByTestId("project-structure-title")).toBeInTheDocument();
    expect(screen.getByTestId("import-accordion")).toBeInTheDocument();
    expect(screen.getByTestId("parameters-accordion")).toBeInTheDocument();
    expect(screen.getByTestId("processing-accordion")).toBeInTheDocument();
    expect(screen.getByTestId("visualization-accordion")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Capturing State Snapshots \(Ctrl\+Shift\+D\)/i }),
    ).toBeInTheDocument();
  });

  it.each([false, true])("resolves and copies appLogDir with frontend DEV=%s", async (dev) => {
    const directory = "/os/application/logs/exploreasl";
    vi.stubEnv("DEV", dev);
    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Accessing Log Files/i }));

    await waitFor(() => {
      expect(screen.getByTestId("active-log-directory")).toHaveTextContent(directory);
    });
    expect(screen.getByTestId("active-log-directory")).toHaveTextContent(
      `Application log directory: ${directory}`,
    );
    expect(appLogDir).toHaveBeenCalledOnce();
    expect(screen.getByTestId("diagnostic-privacy-warning")).toHaveTextContent(
      /sensitive study data, subject identifiers, and local file paths/i,
    );
    expect(screen.getByTestId("log-capture-description")).toHaveTextContent(
      /Files rotate at 5 MiB, retaining up to five archived files plus the active file/i,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy log directory" }));

    expect(await screen.findByRole("button", { name: "Log directory copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(directory);
  });

  it("shows and logs directory resolution failures without enabling copy", async () => {
    const error = new Error("Log directory unavailable");
    vi.mocked(appLogDir).mockRejectedValueOnce(error);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Accessing Log Files/i }));

    expect(await screen.findByTestId("log-directory-error")).toHaveTextContent(
      "Could not resolve the log directory: Error: Log directory unavailable",
    );
    expect(screen.getByRole("button", { name: "Copy log directory" })).toBeDisabled();
    expect(writeText).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith("Failed to resolve log directory:", error);
  });

  it("shows and logs clipboard failures, then allows retry", async () => {
    const error = new Error("Clipboard denied");
    vi.mocked(writeText).mockRejectedValueOnce(error);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Accessing Log Files/i }));
    const copyButton = screen.getByRole("button", { name: "Copy log directory" });
    await waitFor(() => expect(copyButton).toBeEnabled());
    fireEvent.click(copyButton);

    expect(await screen.findByTestId("log-directory-error")).toHaveTextContent(
      "Could not copy the log directory. Copy the path manually: Error: Clipboard denied",
    );
    expect(screen.getByTestId("active-log-directory")).toHaveTextContent(
      "/os/application/logs/exploreasl",
    );
    expect(errorLog).toHaveBeenCalledWith("Failed to copy log directory:", error);

    fireEvent.click(copyButton);
    expect(await screen.findByRole("button", { name: "Log directory copied" })).toBeInTheDocument();
    expect(screen.queryByTestId("log-directory-error")).not.toBeInTheDocument();
  });

  it("handles navigation back to home", () => {
    render(
      <MantineProvider env="test">
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

  it("handles navigation back to previous project page when state.from is present", () => {
    render(
      <MantineProvider env="test">
        <MemoryRouter
          initialEntries={[{ pathname: "/overview", state: { from: "/project/proj1/import" } }]}
        >
          <OverviewPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    const backBtn = screen.getByTestId("overview-back-btn");
    expect(backBtn).toBeInTheDocument();
    expect(backBtn).toHaveTextContent("Back to Project");
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/project/proj1/import");
  });

  it("shows 'Back to Home' when navigating from home page with state.from='/'", () => {
    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={[{ pathname: "/overview", state: { from: "/" } }]}>
          <OverviewPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    const backBtn = screen.getByTestId("overview-back-btn");
    expect(backBtn).toBeInTheDocument();
    expect(backBtn).toHaveTextContent("Back to Home");
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
