import type { ProjectSnapshot_Serialize as ProjectSnapshot } from "../generated/bindings";

/** Static IPC replies only. No native edits, validation or persistence emulation. */
export function projectFixture(
  id = "project-1",
  name = "Project",
  rootPath = "/project",
  overrides: Omit<Partial<ProjectSnapshot["document"]>, "uiState"> & {
    uiState?: Omit<Partial<ProjectSnapshot["document"]["uiState"]>, "dataVis"> & {
      dataVis?: Partial<NonNullable<ProjectSnapshot["document"]["uiState"]["dataVis"]>>;
    };
  } = {},
): ProjectSnapshot {
  const reviewer = "11111111-1111-4111-8111-111111111111";
  const { dataVis, ...uiState } = overrides.uiState ?? {};
  return {
    document: {
      schemaVersion: 2,
      projectMeta: {
        id,
        name,
        dataSource: "dicom",
        currentPhase: "import",
        createdAt: "2026-01-01T00:00:00Z",
        lastOpened: "2026-01-01T00:00:00Z",
      },
      mappingState: {},
      dataPar: {},
      ...overrides,
      uiState: {
        manifest: {
          reviewers: [{ id: reviewer, label: "Reviewer 1", createdAt: "2026-01-01T00:00:00Z" }],
          activeReviewerId: reviewer,
          verdicts: { [reviewer]: {} },
          resolvedVerdicts: {},
        },
        ...uiState,
        ...(dataVis && {
          dataVis: {
            qcbfSource: null,
            joinConfig: null,
            identifiers: null,
            xLegendOverride: null,
            yLegendOverride: null,
            ...dataVis,
          },
        }),
      },
    },
    rootPath,
    activationGeneration: 1,
    acceptedRevision: 0,
    persistedRevision: 0,
    recoveredFromBackup: false,
    allowedPhases: ["import", "parameters"],
  };
}
