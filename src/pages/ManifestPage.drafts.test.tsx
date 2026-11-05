import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TestMantineProvider } from "../test/render";
import { projectFixture } from "../test/projectFixtures";
import { projectView } from "../schemas/project";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { useManifestStore } from "../stores/manifestStore";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import ManifestPage from "./ManifestPage";

vi.mock("../components/manifest/ManifestPreview", () => ({
  default: () => <div data-testid="manifest-preview">Preview</div>,
}));

function renderReview(disagreement = false) {
  const snapshot = projectFixture("project-1", "Draft review", "/project");
  const manifest = snapshot.document.uiState.manifest;
  const first = manifest.reviewers[0];
  const second = { ...first, id: "22222222-2222-4222-8222-222222222222", label: "Reviewer 2" };
  manifest.reviewers.push(second);
  manifest.verdicts = {
    [first.id]: { "sub-01_01": { status: "pass", setAt: 1 } },
    [second.id]: {
      "sub-01_01": disagreement
        ? { status: "fail", reason: "motion", setAt: 1 }
        : { status: "pass", setAt: 1 },
    },
  };
  manifest.resolvedVerdicts = disagreement ? { "sub-01_01": { status: "pass", setAt: 1 } } : {};
  useProjectStore.setState({ project: projectView(snapshot), loaded: true, draftErrors: {} });
  activateProjectLease("project-1", "/project");
  useProcessingStore.setState({
    availableSubjects: [
      {
        subjectSession: "sub-01_01",
        subject: "01",
        session: "01",
        hasStructural: true,
        hasASL: true,
        aslRuns: [],
      },
    ],
    subjectStatuses: [],
  });
  useManifestStore.setState({
    qcLoaded: true,
    qcData: {
      "sub-01_01": { coverage: null, spatialCov: null, motion: [], motionExclusionPct: null },
    },
    step: disagreement ? 1 : 0,
  });
  vi.spyOn(useManifestStore.getState(), "loadQcData").mockResolvedValue();
  vi.spyOn(useManifestStore.getState(), "loadDataPar").mockResolvedValue();
  vi.spyOn(useManifestStore.getState(), "loadPriorModulesMtimes").mockResolvedValue();
  vi.spyOn(useProcessingStore.getState(), "scanAvailableSubjects").mockResolvedValue();
  vi.spyOn(useProcessingStore.getState(), "loadLockFileStatus").mockResolvedValue();
  vi.mocked(invoke).mockResolvedValue([]);
  render(
    <TestMantineProvider>
      <ManifestPage />
    </TestMantineProvider>,
  );
  return { snapshot, first, second };
}

afterEach(() => {
  cleanup();
  useProjectStore.getState().cancelAutosave();
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
  resetProjectLifecycleForTests();
  useManifestStore.getState().resetManifest();
  useProcessingStore.setState({ availableSubjects: [], subjectStatuses: [] });
  useProjectStore.setState({ project: null, loaded: false, draftErrors: {} });
});

it.each(["notes", "Fail"])(
  "retains reviewer %s and save/Next guards across real tab and step unmounts and filters",
  async (kind) => {
    const user = userEvent.setup();
    const { snapshot, first, second } = renderReview();
    expect(screen.getByTestId("next-button")).toBeEnabled();
    const draft = "🧠".repeat(501);
    if (kind === "notes")
      fireEvent.change(screen.getByTestId("verdict-notes-sub-01_01"), { target: { value: draft } });
    else
      await user.click(
        within(screen.getByTestId("verdict-control-sub-01_01")).getByRole("radio", {
          name: "Fail",
        }),
      );
    const error = kind === "notes" ? "Complete pending notes" : "Complete pending Fail verdicts";
    await expect(useProjectStore.getState().flushEdits()).rejects.toThrow(error);
    snapshot.document.uiState.manifest.activeReviewerId = second.id;
    vi.mocked(invoke).mockResolvedValueOnce({ ...structuredClone(snapshot), acceptedRevision: 1 });
    await user.click(screen.getByTestId(`reviewer-tab-${second.id}`));
    expect(screen.getByTestId("verdict-notes-sub-01_01")).toHaveValue("");
    expect(screen.getByTestId("next-button")).toBeDisabled();
    snapshot.document.uiState.manifest.activeReviewerId = first.id;
    vi.mocked(invoke).mockResolvedValueOnce({ ...structuredClone(snapshot), acceptedRevision: 2 });
    await user.click(screen.getByTestId(`reviewer-tab-${first.id}`));
    if (kind === "notes") expect(screen.getByTestId("verdict-notes-sub-01_01")).toHaveValue(draft);
    else expect(screen.getByTestId("verdict-reason-sub-01_01")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("qc-search"), { target: { value: "hidden" } });
    expect(screen.queryByTestId("verdict-notes-sub-01_01")).not.toBeInTheDocument();
    expect(screen.getByTestId("next-button")).toBeDisabled();
    act(() => useManifestStore.getState().setStep(1));
    expect(screen.getByTestId("manifest-preview")).toBeInTheDocument();
    await expect(useProjectStore.getState().flushEdits()).rejects.toThrow(error);
    act(() => useManifestStore.getState().setStep(0));
    if (kind === "notes") expect(screen.getByTestId("verdict-notes-sub-01_01")).toHaveValue(draft);
    else expect(screen.getByTestId("verdict-reason-sub-01_01")).toBeInTheDocument();
    expect(screen.getByTestId("next-button")).toBeDisabled();
  },
);

it("retains pending Fail resolution across Back/Next and reconciles changed original ratings", async () => {
  const user = userEvent.setup();
  const { snapshot, first } = renderReview(true);
  expect(screen.getByTestId("resolution-next-button")).toBeEnabled();
  await user.click(
    within(screen.getByTestId("final-verdict-sub-01_01")).getByRole("radio", { name: "Fail" }),
  );
  await expect(useProjectStore.getState().flushEdits()).rejects.toThrow(
    "Complete pending Fail resolutions",
  );
  expect(screen.getByTestId("resolution-next-button")).toBeDisabled();
  await user.click(screen.getByTestId("resolution-back-button"));
  await expect(useProjectStore.getState().flushEdits()).rejects.toThrow(
    "Complete pending Fail resolutions",
  );
  await user.click(screen.getByTestId("next-button"));
  expect(screen.getByTestId("final-reason-sub-01_01")).toBeInTheDocument();
  expect(screen.getByTestId("resolution-next-button")).toBeDisabled();
  const changed = structuredClone(snapshot);
  changed.document.uiState.manifest.verdicts[first.id]["sub-01_01"].setAt = 2;
  changed.document.uiState.manifest.resolvedVerdicts = {};
  act(() => useProjectStore.setState({ project: projectView(changed) }));
  await waitFor(() =>
    expect(useProjectStore.getState().draftErrors["manifest:resolution"]).toBeUndefined(),
  );
  expect(screen.queryByTestId("final-reason-sub-01_01")).not.toBeInTheDocument();
});
