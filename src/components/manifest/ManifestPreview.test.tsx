import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import ManifestPreview from "./ManifestPreview";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessingStore } from "../../stores/processingStore";
import { useManifestStore } from "../../stores/manifestStore";
import type { SubjectInfo } from "../../schemas/processingSchemas";
import type { MetadataGroup, SubjectRow } from "../../schemas/importSchemas";
import type { ManifestVerdict } from "../../schemas/project";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const groupPcasl: MetadataGroup = {
  id: "g1",
  label: "Group A (PCASL)",
  bidsParams: {
    ArterialSpinLabelingType: "PCASL",
    LabelingDuration: 1800,
    PostLabelingDelay: 2000,
    BackgroundSuppression: true,
    BolusCutOffFlag: true,
    BolusCutOffDelayTime: 2000,
  } as any,
};

const groupPasl: MetadataGroup = {
  id: "g2",
  label: "Group B (PASL)",
  bidsParams: {
    ArterialSpinLabelingType: "PASL",
    LabelingDuration: 1000,
    PostLabelingDelay: 1500,
  } as any,
};

const groupNoFlag: MetadataGroup = {
  id: "g3",
  label: "Group C (No Bolus)",
  bidsParams: {
    ArterialSpinLabelingType: "PCASL",
    LabelingDuration: 1500,
    BolusCutOffFlag: false,
    BolusCutOffDelayTime: 800,
  } as any,
};

const subjectRow1: SubjectRow = { id: "SUB/01", subject: "SUB", session: "01", groupId: "g1" };
const subjectRow2: SubjectRow = { id: "SUB2/01", subject: "SUB2", session: "01", groupId: "g1" };
const subjectRow3: SubjectRow = { id: "SUB3/01", subject: "SUB3", session: "01", groupId: "g2" };
const subjectRow4: SubjectRow = { id: "SUB4/01", subject: "SUB4", session: "01", groupId: "g3" };

const subj1: SubjectInfo = {
  subjectSession: "SUB_01",
  subject: "SUB",
  session: "01",
  hasStructural: true,
  hasASL: true,
  aslRuns: ["01", "02"],
};
const subj2: SubjectInfo = {
  subjectSession: "SUB2_01",
  subject: "SUB2",
  session: "01",
  hasStructural: true,
  hasASL: true,
  aslRuns: ["01"],
};
const subj3: SubjectInfo = {
  subjectSession: "SUB3_01",
  subject: "SUB3",
  session: "01",
  hasStructural: true,
  hasASL: true,
  aslRuns: [],
};
const subj4: SubjectInfo = {
  subjectSession: "SUB4_01",
  subject: "SUB4",
  session: "01",
  hasStructural: true,
  hasASL: true,
  aslRuns: ["01"],
};
const ungroupedSubj: SubjectInfo = {
  subjectSession: "SUB_X_01",
  subject: "SUB-X",
  session: "01",
  hasStructural: true,
  hasASL: true,
  aslRuns: ["01"],
};

// ---------------------------------------------------------------------------
// Shared mutable state (reset in afterEach)
// ---------------------------------------------------------------------------

let mockMetadataGroups: MetadataGroup[] = [];
let mockSubjectRows: SubjectRow[] = [];
let mockAvailableSubjects: SubjectInfo[] = [];
let mockVerdicts: Record<string, ManifestVerdict> = {};
let mockVersions: { exploreASL?: string; matlab?: string; gui?: string } = {};

function buildProjectState() {
  return {
    version: "0.1.0" as const,
    projectMeta: {
      id: "project-1",
      name: "Brain Study",
      rootPath: "/test/project",
      createdAt: "2026-05-03T00:00:00.000Z",
      lastOpened: "2026-05-03T00:00:00.000Z",
      currentPhase: "manifest" as const,
    },
    mappingState: {
      metadataGroups: mockMetadataGroups,
      subjectRows: mockSubjectRows,
    },
    uiState: {
      manifest: {
        verdicts: mockVerdicts,
        lastRunVersions: mockVersions,
        lastPopulationRunMtime: null,
      },
    },
    exploreAslConfig: {
      sourcestructure: {},
      studyPar: {},
      dataPar: {},
    },
  };
}

function renderPreview() {
  useProcessingStore.setState({
    availableSubjects: mockAvailableSubjects,
    subjectStatuses: [],
  });
  useProjectStore.setState({
    project: buildProjectState() as any,
    loaded: true,
  });
  return render(
    <MantineProvider>
      <ManifestPreview />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  mockMetadataGroups = [];
  mockSubjectRows = [];
  mockAvailableSubjects = [];
  mockVerdicts = {};
  mockVersions = {};
  useProjectStore.setState({ project: null, isDirty: false, loaded: false });
  useProcessingStore.setState({ availableSubjects: [], subjectStatuses: [] });
  useManifestStore.setState({ qcData: null, qcLoaded: false, dataPar: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ManifestPreview", () => {
  // 13.1 — renders 4 sections
  it("renders 4 sections when data is present", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1, subjectRow2];
    mockAvailableSubjects = [subj1, subj2];
    mockVerdicts = {
      SUB_01: { status: "pass", setAt: 1 },
      SUB2_01: { status: "fail", reason: "motion", setAt: 1 },
    };
    mockVersions = { exploreASL: "1.0.0", matlab: "R2023b", gui: "0.1.0" };

    renderPreview();

    expect(screen.getByTestId("manifest-preview")).toBeInTheDocument();
    expect(screen.getByTestId("manifest-section-study-parameters")).toBeInTheDocument();
    expect(screen.getByTestId("manifest-section-software-manifest")).toBeInTheDocument();
    expect(screen.getByTestId("manifest-section-qc-summary")).toBeInTheDocument();
    expect(screen.getByTestId("manifest-section-pipeline-summary")).toBeInTheDocument();
  });

  // 13.4 — conditional rows: PCASL shows LabelingDuration, PASL omits
  it("omits LabelingDuration row for PASL groups and shows it for PCASL", () => {
    mockMetadataGroups = [groupPcasl, groupPasl];
    mockSubjectRows = [subjectRow1, subjectRow3];
    mockAvailableSubjects = [subj1, subj3];
    mockVerdicts = {};

    renderPreview();

    // PCASL group should show LabelingDuration
    expect(screen.getByText("Group A (PCASL)")).toBeInTheDocument();
    const pcaslTables = screen.getAllByRole("table");
    const pcaslTable = pcaslTables[0];
    expect(pcaslTable).toHaveTextContent("LabelingDuration");
    expect(pcaslTable).toHaveTextContent("1800");

    // PASL group should NOT show LabelingDuration
    expect(screen.getByText("Group B (PASL)")).toBeInTheDocument();
    const paslTable = pcaslTables[1];
    expect(paslTable).not.toHaveTextContent("LabelingDuration");
  });

  // 13.4b — BolusCutOffDelayTime omitted when BolusCutOffFlag is false
  it("omits BolusCutOffDelayTime when BolusCutOffFlag is false", () => {
    mockMetadataGroups = [groupNoFlag];
    mockSubjectRows = [subjectRow4];
    mockAvailableSubjects = [subj4];
    mockVerdicts = {};

    renderPreview();

    const tables = screen.getAllByRole("table");
    const table = tables[0];
    expect(table).toHaveTextContent("LabelingDuration");
    expect(table).not.toHaveTextContent("BolusCutOffDelayTime");
  });

  // 13.8 — unknown versions render "unknown"
  it("shows unknown for missing version fields", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1];
    mockAvailableSubjects = [subj1];
    mockVerdicts = {};
    mockVersions = {};

    renderPreview();

    expect(screen.getByTestId("version-exploreasl")).toHaveTextContent("unknown");
    expect(screen.getByTestId("version-gui")).toHaveTextContent("unknown");
    expect(screen.getByTestId("version-matlab")).toHaveTextContent("unknown");
  });

  // 13.8b — known versions show values
  it("shows version values when set", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1];
    mockAvailableSubjects = [subj1];
    mockVerdicts = {};
    mockVersions = { exploreASL: "2.0.0", matlab: "R2024a", gui: "1.5.0" };

    renderPreview();

    expect(screen.getByTestId("version-exploreasl")).toHaveTextContent("2.0.0");
    expect(screen.getByTestId("version-gui")).toHaveTextContent("1.5.0");
    expect(screen.getByTestId("version-matlab")).toHaveTextContent("R2024a");
  });

  // 13.6 — Pass/Total from stored verdicts
  it("renders Pass / Total from stored verdicts", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1, subjectRow2];
    mockAvailableSubjects = [subj1, subj2];
    mockVerdicts = {
      SUB_01: { status: "pass", setAt: 1 },
      SUB2_01: { status: "fail", reason: "motion", setAt: 1 },
    };

    renderPreview();

    expect(screen.getByTestId("pass-total-Group A (PCASL)")).toHaveTextContent("1 / 2");
  });

  // 13.6a — Pass/Total when all subjects pass
  it("shows all pass when all have pass verdicts", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1, subjectRow2];
    mockAvailableSubjects = [subj1, subj2];
    mockVerdicts = {
      SUB_01: { status: "pass", setAt: 1 },
      SUB2_01: { status: "pass", setAt: 1 },
    };

    renderPreview();

    expect(screen.getByTestId("pass-total-Group A (PCASL)")).toHaveTextContent("2 / 2");
  });

  // 13.6a — coverage/CoV/motion render "N/A" when QC data is not loaded
  it("renders N/A for QC metrics when QC data is not loaded", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1, subjectRow2];
    mockAvailableSubjects = [subj1, subj2];
    mockVerdicts = {
      SUB_01: { status: "pass", setAt: 1 },
      SUB2_01: { status: "fail", reason: "motion", setAt: 1 },
    };

    useManifestStore.setState({ qcData: null, qcLoaded: false });

    renderPreview();

    expect(screen.getByTestId("Group A (PCASL)-coverage")).toHaveTextContent("N/A");
    expect(screen.getByTestId("Group A (PCASL)-spatialCov")).toHaveTextContent("N/A");
    expect(screen.getByTestId("Group A (PCASL)-motion")).toHaveTextContent("N/A");
    expect(screen.getByTestId("Group A (PCASL)-motionExclusion")).toHaveTextContent("N/A");
  });

  it("renders metric aggregates when QC data is loaded", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1, subjectRow2];
    mockAvailableSubjects = [subj1, subj2];
    mockVerdicts = {
      SUB_01: { status: "pass", setAt: 1 },
      SUB2_01: { status: "pass", setAt: 1 },
    };

    useManifestStore.setState({
      qcData: {
        SUB_01: { coverage: 95, spatialCov: 8, motion: [0.3, 0.4], motionExclusionPct: 5 },
        SUB2_01: { coverage: 90, spatialCov: 9, motion: [0.5], motionExclusionPct: 3 },
      },
      qcLoaded: true,
    });

    renderPreview();

    // coverage: mean of 95, 90 is 92.5; SD is 3.54
    expect(screen.getByTestId("Group A (PCASL)-coverage")).toHaveTextContent("92.50 (3.54)");
    // spatialCov: mean of 8, 9 is 8.5; SD is 0.71
    expect(screen.getByTestId("Group A (PCASL)-spatialCov")).toHaveTextContent("8.50 (0.71)");
    // motion: max for SUB_01 is 0.4, for SUB2_01 is 0.5; mean of 0.4, 0.5 is 0.45; SD is 0.07 (0.0707)
    expect(screen.getByTestId("Group A (PCASL)-motion")).toHaveTextContent("0.45 (0.07)");
    // motionExclusion: mean of 5, 3 is 4; SD is 1.41
    expect(screen.getByTestId("Group A (PCASL)-motionExclusion")).toHaveTextContent("4.00 (1.41)");
  });

  // 13.6d — No Info rows are excluded from Pass/Total and summary paragraph
  it("excludes No Info rows from Pass/Total and pipeline summary count", () => {
    mockMetadataGroups = [groupPcasl];
    const subjectRow4InG1 = { id: "SUB4/01", subject: "SUB4", session: "01", groupId: "g1" };
    mockSubjectRows = [subjectRow1, subjectRow2, subjectRow4InG1];
    mockAvailableSubjects = [subj1, subj2, subj4];

    mockVerdicts = {
      SUB_01: { status: "pass", setAt: 1 },
      SUB2_01: { status: "fail", reason: "motion", setAt: 1 },
      SUB4_01: { status: "pass", setAt: 1 },
    };

    useManifestStore.setState({
      qcData: {
        SUB_01: { coverage: 95, spatialCov: 8, motion: [0.4], motionExclusionPct: 5 },
        SUB2_01: { coverage: 90, spatialCov: 9, motion: [0.5], motionExclusionPct: 3 },
      },
      qcLoaded: true,
    });

    renderPreview();

    expect(screen.getByTestId("pass-total-Group A (PCASL)")).toHaveTextContent("1 / 2");

    const summary = screen.getByTestId("manifest-section-pipeline-summary");
    expect(summary).toHaveTextContent("2 subjects");
  });

  // 13.6c — Fail Reasons breakdown per group
  it("renders Fail Reasons breakdown from stored verdicts", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1, subjectRow2];
    mockAvailableSubjects = [subj1, subj2];
    mockVerdicts = {
      SUB_01: { status: "pass", setAt: 1 },
      SUB2_01: { status: "fail", reason: "motion", setAt: 1 },
    };

    renderPreview();

    const qcSection = screen.getByTestId("manifest-section-qc-summary");
    expect(qcSection).toHaveTextContent("Fail Reasons");
    expect(qcSection).toHaveTextContent("motion: 1");
  });

  // 13.6c — Multiple fail reasons
  it("counts multiple fail reasons correctly", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1, subjectRow2];
    mockAvailableSubjects = [subj1, subj2];
    mockVerdicts = {
      SUB_01: { status: "fail", reason: "motion", setAt: 1 },
      SUB2_01: { status: "fail", reason: "coverage", setAt: 1 },
    };

    renderPreview();

    const qcSection = screen.getByTestId("manifest-section-qc-summary");
    expect(qcSection).toHaveTextContent("motion: 1");
    expect(qcSection).toHaveTextContent("coverage: 1");
  });

  // Empty QC data message
  it("shows empty QC message when no verdicts present", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1];
    mockAvailableSubjects = [subj1];
    mockVerdicts = {};

    renderPreview();

    expect(screen.getByText(/No QC data available/)).toBeInTheDocument();
  });

  // Section 4 pipeline paragraph
  it("renders pipeline summary paragraph with subject and group counts", () => {
    mockMetadataGroups = [groupPcasl, groupPasl];
    mockSubjectRows = [subjectRow1, subjectRow2, subjectRow3];
    mockAvailableSubjects = [subj1, subj2, subj3];
    mockVerdicts = {};
    mockVersions = { exploreASL: "1.0", matlab: "R2023b", gui: "0.1" };

    useManifestStore.setState({
      qcData: {
        SUB_01: { coverage: 95, spatialCov: 8, motion: [0.4], motionExclusionPct: 5 },
        SUB2_01: { coverage: 90, spatialCov: 9, motion: [0.5], motionExclusionPct: 3 },
        SUB3_01: { coverage: 85, spatialCov: 10, motion: [0.6], motionExclusionPct: 2 },
      },
      qcLoaded: true,
    });

    renderPreview();

    const summary = screen.getByTestId("manifest-section-pipeline-summary");
    expect(summary).toHaveTextContent("ExploreASL (version 1.0)");
    expect(summary).toHaveTextContent("MATLAB R2023b");
    expect(summary).toHaveTextContent("3 subjects");
    expect(summary).toHaveTextContent("2 groups");
  });

  // 13.6b — Ungrouped subjects appear in study parameters
  it("shows Ungrouped group for subjects without metadata group", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1];
    mockAvailableSubjects = [subj1, ungroupedSubj];

    renderPreview();

    expect(screen.getByText("Ungrouped")).toBeInTheDocument();
  });

  // 13.10 — live update on re-render with changed store
  it("updates Pass/Total when store verdicts change", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1, subjectRow2];
    mockAvailableSubjects = [subj1, subj2];
    mockVerdicts = {
      SUB_01: { status: "pass", setAt: 1 },
      SUB2_01: { status: "fail", reason: "motion", setAt: 1 },
    };

    const { rerender } = renderPreview();
    expect(screen.getByTestId("pass-total-Group A (PCASL)")).toHaveTextContent("1 / 2");

    // Change verdicts
    mockVerdicts = {
      SUB_01: { status: "pass", setAt: 1 },
      SUB2_01: { status: "pass", setAt: 1 },
    };
    useProjectStore.setState({
      project: buildProjectState() as any,
      loaded: true,
    });

    rerender(
      <MantineProvider>
        <ManifestPreview />
      </MantineProvider>,
    );

    expect(screen.getByTestId("pass-total-Group A (PCASL)")).toHaveTextContent("2 / 2");
  });

  // Empty state — no data at all
  it("renders without crashing when project has no data", () => {
    useProjectStore.setState({ project: null, loaded: false });
    useProcessingStore.setState({ availableSubjects: [], subjectStatuses: [] });

    render(
      <MantineProvider>
        <ManifestPreview />
      </MantineProvider>,
    );

    // Should render empty/missing state without crashing
    expect(screen.getByTestId("manifest-preview")).toBeInTheDocument();
    expect(screen.getByTestId("manifest-section-qc-summary")).toHaveTextContent(
      "No QC data available",
    );
  });

  // 14.1 — Export Markdown invokes save + writeTextFile
  it("clicking Export Markdown invokes save + writeTextFile", async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(save).mockResolvedValue("/tmp/manifest.md");
    vi.mocked(writeTextFile).mockResolvedValue(undefined);

    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1];
    mockAvailableSubjects = [subj1];
    mockVerdicts = { SUB_01: { status: "pass", setAt: 1 } };

    renderPreview();

    const btn = screen.getByTestId("export-markdown-btn");
    await userEvent.click(btn);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "manifest.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      }),
    );
    expect(writeTextFile).toHaveBeenCalledWith("/tmp/manifest.md", expect.any(String));
  });

  // 14.3 — Export HTML invokes save + writeTextFile
  it("clicking Export HTML invokes save + writeTextFile", async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(save).mockResolvedValue("/tmp/manifest.html");
    vi.mocked(writeTextFile).mockResolvedValue(undefined);

    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1];
    mockAvailableSubjects = [subj1];
    mockVerdicts = { SUB_01: { status: "pass", setAt: 1 } };

    renderPreview();

    const btn = screen.getByTestId("export-html-btn");
    await userEvent.click(btn);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "manifest.html",
        filters: [{ name: "HTML", extensions: ["html"] }],
      }),
    );
    expect(writeTextFile).toHaveBeenCalledWith("/tmp/manifest.html", expect.any(String));
  });

  // 14.5 — both export buttons disabled when no verdicts exist
  it("export buttons disabled when no verdicts", () => {
    mockMetadataGroups = [groupPcasl];
    mockSubjectRows = [subjectRow1];
    mockAvailableSubjects = [subj1];
    mockVerdicts = {};

    renderPreview();

    expect(screen.getByTestId("export-markdown-btn")).toBeDisabled();
    expect(screen.getByTestId("export-html-btn")).toBeDisabled();
  });

  // 14.5b — export buttons disabled when project is null
  it("export buttons disabled when project is null", () => {
    useProjectStore.setState({ project: null, loaded: false });
    useProcessingStore.setState({ availableSubjects: [], subjectStatuses: [] });

    render(
      <MantineProvider>
        <ManifestPreview />
      </MantineProvider>,
    );

    expect(screen.getByTestId("export-markdown-btn")).toBeDisabled();
    expect(screen.getByTestId("export-html-btn")).toBeDisabled();
  });
});
