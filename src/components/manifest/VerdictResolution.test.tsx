import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestMantineProvider as MantineProvider } from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockFetchLogContent } = vi.hoisted(() => ({
  mockFetchLogContent: vi.fn(),
}));

vi.mock("../../lib/logViewer", () => ({
  fetchLogContent: mockFetchLogContent,
}));

import { useState } from "react";
import VerdictResolution, { type ResolutionDrafts } from "./VerdictResolution";
import { areDisagreementsResolved } from "./VerdictResolution.helpers";
import { useManifestStore, type ManifestDisagreement } from "../../stores/manifestStore";
import { useProjectStore } from "../../stores/projectStore";
import { projectFixture } from "../../test/projectFixtures";
import { projectView } from "../../schemas/project";
import { invoke } from "@tauri-apps/api/core";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";

mockFetchLogContent.mockRejectedValue(new Error("Failed to load logs"));

const reviewers = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    label: "Reviewer 1",
    createdAt: "2026-08-08T00:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    label: "Reviewer 2",
    createdAt: "2026-08-08T00:00:00.000Z",
  },
];

const disagreements: ManifestDisagreement[] = [
  {
    subjectSession: "sub-01_01",
    verdictsByReviewer: {
      [reviewers[0].id]: { status: "pass", notes: "looks good", setAt: 5 },
      [reviewers[1].id]: { status: "fail", reason: "motion", notes: "blur", setAt: 5 },
    },
  },
  {
    subjectSession: "sub-02_02",
    verdictsByReviewer: {
      [reviewers[0].id]: { status: "fail", reason: "coverage", setAt: 6 },
      [reviewers[1].id]: { status: "pass", setAt: 6 },
    },
  },
];

describe("areDisagreementsResolved", () => {
  it("accepts an empty current disagreement set without resolutions", () => {
    expect(areDisagreementsResolved([], {})).toBe(true);
  });

  it("ignores stale resolutions and requires every current disagreement", () => {
    expect(
      areDisagreementsResolved([disagreements[0]], {
        "sub-stale_01": { status: "pass", setAt: 1 },
      }),
    ).toBe(false);
    expect(
      areDisagreementsResolved([disagreements[0]], {
        "sub-01_01": { status: "pass", setAt: 1 },
        "sub-stale_01": { status: "fail", reason: "motion", setAt: 1 },
      }),
    ).toBe(true);
  });
});

function setState(resolvedVerdicts: Record<string, unknown> | undefined = undefined) {
  useProjectStore.setState({
    project: projectView(
      projectFixture("project-1", "Verdict resolution", "/project", {
        uiState: {
          processing: { population: { lastRun: { profileId: "profile", Mtime: 99 } } },
          manifest: {
            reviewers,
            activeReviewerId: reviewers[0].id,
            verdicts: {},
            resolvedVerdicts: (resolvedVerdicts as any) ?? {},
          },
        },
        mappingState: {},
        dataPar: {},
      }),
    ),
    isDirty: false,
    loaded: true,
  });
  useManifestStore.setState({
    priorModulesMtimes: { "sub-01_01": 10, "sub-02_02": 20 },
    qcData: {
      "sub-01_01": {
        coverage: 78.2,
        spatialCov: 0.42,
        motion: [0.8, 1.3],
        motionExclusionPct: 5,
      },
    },
  });
  activateProjectLease("project-1", "/project");
  return {
    ...projectFixture("project-1", "Verdict resolution", "/project", {
      uiState: { manifest: structuredClone(useProjectStore.getState().project!.uiState.manifest) },
    }),
    acceptedRevision: 1,
  };
}

function ResolutionHarness({ disagreements }: { disagreements: ManifestDisagreement[] }) {
  const draftState = useState<ResolutionDrafts>(() => ({ pendingFails: {}, notes: {} }));
  return <VerdictResolution disagreements={disagreements} draftState={draftState} />;
}

function renderResolution(resolutionDisagreements = disagreements) {
  return render(
    <MantineProvider env="test">
      <ResolutionHarness disagreements={resolutionDisagreements} />
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
  vi.mocked(invoke).mockReset();
  useProjectStore.setState({ project: null, isDirty: false, loaded: false });
  useManifestStore.setState({ priorModulesMtimes: {}, qcData: null });
  vi.restoreAllMocks();
  mockFetchLogContent.mockReset();
  mockFetchLogContent.mockRejectedValue(new Error("Failed to load logs"));
});

describe("VerdictResolution", () => {
  it.each(["newer draft", "expired lease"])(
    "retains controlled notes after an ACK with %s",
    async (change) => {
      setState({ "sub-01_01": { status: "pass", setAt: 1 } });
      renderResolution();
      let acknowledge!: () => void;
      const submit = vi.spyOn(useProjectStore.getState(), "setResolvedVerdict").mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            acknowledge = resolve;
          }),
      );
      const notes = screen.getByTestId("final-notes-sub-01_01");
      fireEvent.change(notes, { target: { value: "submitted" } });
      fireEvent.blur(notes);
      if (change === "newer draft") fireEvent.change(notes, { target: { value: "newer" } });
      else activateProjectLease("project-1", "/project");
      await act(async () => acknowledge());
      expect(notes).toHaveValue(change === "newer draft" ? "newer" : "submitted");
      expect(screen.getByTestId("resolution-draft-status")).toHaveTextContent("1 pending notes");
      submit.mockRestore();
    },
  );

  it("renders an identifiable empty state", () => {
    setState();

    renderResolution([]);

    expect(screen.getByTestId("verdict-resolution")).toBeInTheDocument();
    expect(screen.getByTestId("verdict-resolution-empty")).toHaveTextContent(
      "No disagreements require resolution",
    );
  });

  it("renders every disagreement with parsed subject/session and reviewer verdict details", () => {
    setState();

    renderResolution();

    expect(screen.getByTestId("resolution-subject-sub-01_01")).toHaveTextContent("sub-01");
    expect(screen.getByTestId("resolution-session-sub-01_01")).toHaveTextContent("01");
    expect(screen.getByTestId(`reviewer-verdict-${reviewers[0].id}-sub-01_01`)).toHaveTextContent(
      "✅ Pass",
    );
    expect(screen.getByTestId(`reviewer-verdict-${reviewers[1].id}-sub-01_01`)).toHaveTextContent(
      "❌ Failmotion",
    );
    expect(screen.getByTestId("resolution-subject-sub-02_02")).toBeInTheDocument();
    expect(screen.getAllByTestId(/resolution-subject-/)).toHaveLength(2);
    expect(screen.getByTestId("resolution-remaining")).toHaveTextContent(
      "2 disagreements remaining",
    );
  });

  it("renders table headers and row-scoped verdict controls and actions", () => {
    setState();

    renderResolution();

    const table = within(screen.getByRole("table"));
    expect(table.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Subject",
      "Session",
      "Reviewer 1",
      "Reviewer 2",
      "Final Verdict",
      "Actions",
    ]);
    expect(table.getAllByRole("row")).toHaveLength(3);
    const row = within(table.getByRole("row", { name: /sub-01/ }));
    expect(row.getByRole("radio", { name: "Pass" })).toBeInTheDocument();
    expect(row.getByRole("radio", { name: "Fail" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "View images for sub-01_01" })).toBeEnabled();
    expect(row.getByRole("button", { name: "View QC metrics for sub-01_01" })).toBeEnabled();
    expect(row.getByRole("button", { name: "View logs for sub-01_01" })).toBeEnabled();
  });

  it("keeps fail pending until a controlled reason is selected and writes pass resolutions", async () => {
    const user = userEvent.setup();
    const reply = setState();
    const setResolvedVerdict = vi.spyOn(useProjectStore.getState(), "setResolvedVerdict");

    renderResolution();

    await user.click(
      screen.getByTestId("final-verdict-sub-01_01").querySelector("input[value='fail']")!,
    );
    expect(screen.getByTestId("final-reason-sub-01_01")).toBeInTheDocument();
    expect(setResolvedVerdict).not.toHaveBeenCalled();
    reply.document.uiState.manifest.resolvedVerdicts["sub-01_01"] = {
      status: "fail",
      reason: "motion",
      setAt: 10,
    };
    vi.mocked(invoke).mockResolvedValueOnce(structuredClone(reply));

    await user.click(screen.getByTestId("final-reason-sub-01_01"));
    await user.click(screen.getByRole("option", { name: "Motion", hidden: true }));
    expect(setResolvedVerdict).toHaveBeenCalledWith("sub-01_01", "fail", {
      reason: "motion",
      notes: undefined,
    });

    reply.acceptedRevision = 2;
    reply.document.uiState.manifest.resolvedVerdicts["sub-02_02"] = { status: "pass", setAt: 20 };
    vi.mocked(invoke).mockResolvedValueOnce(reply);
    await user.click(
      screen.getByTestId("final-verdict-sub-02_02").querySelector("input[value='pass']")!,
    );
    expect(
      useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts?.["sub-02_02"],
    ).toMatchObject({ status: "pass", setAt: 20 });
  });

  it("displays existing resolutions and permits overwriting them", async () => {
    const user = userEvent.setup();
    const reply = setState({
      "sub-01_01": { status: "pass", notes: "prior", setAt: 1 },
    });
    reply.document.uiState.manifest.resolvedVerdicts["sub-01_01"] = {
      status: "fail",
      reason: "artifact",
      notes: "prior",
      setAt: 10,
    };
    vi.mocked(invoke).mockResolvedValueOnce(reply);

    renderResolution();

    expect(screen.getByTestId("resolution-state-sub-01_01")).toHaveTextContent("Resolved");
    await user.click(
      screen.getByTestId("final-verdict-sub-01_01").querySelector("input[value='fail']")!,
    );
    await user.click(screen.getByTestId("final-reason-sub-01_01"));
    await user.click(screen.getByRole("option", { name: "Artifact", hidden: true }));

    expect(
      useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts?.["sub-01_01"],
    ).toMatchObject({ status: "fail", reason: "artifact", setAt: 10 });
  });

  it("preserves accepted pass while a replacement fail draft lacks its required reason", async () => {
    const user = userEvent.setup();
    setState({ "sub-01_01": { status: "pass", notes: "prior", setAt: 1 } });

    renderResolution();
    await user.click(
      screen.getByTestId("final-verdict-sub-01_01").querySelector("input[value='fail']")!,
    );

    expect(
      useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts?.["sub-01_01"],
    ).toEqual({ status: "pass", notes: "prior", setAt: 1 });
    expect(screen.getByTestId("resolution-draft-status")).toHaveTextContent(
      "1 pending Fail drafts",
    );
    expect(screen.getByTestId("resolution-state-sub-01_01")).toHaveTextContent("Pending");
    expect(screen.getByTestId("final-reason-sub-01_01")).toHaveAccessibleName(
      "Failure reason for sub-01_01",
    );
    expect(screen.getByText("Reason required")).toBeInTheDocument();
  });

  it("bulk-copies each reviewer verdict only into unresolved rows and derives completion", async () => {
    const user = userEvent.setup();
    const reply = setState({
      "sub-01_01": { status: "pass", notes: "manual", setAt: 1 },
    });
    reply.document.uiState.manifest.resolvedVerdicts["sub-02_02"] = { status: "pass", setAt: 20 };
    vi.mocked(invoke).mockResolvedValueOnce(reply);

    renderResolution();

    await user.click(screen.getByTestId(`bulk-resolve-${reviewers[1].id}`));

    const resolved = useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts;
    expect(resolved?.["sub-01_01"]).toMatchObject({ status: "pass", notes: "manual", setAt: 1 });
    expect(resolved?.["sub-02_02"]).toEqual({ status: "pass", setAt: 20 });
    expect(screen.getByTestId("resolution-remaining")).toHaveTextContent(
      "All disagreements resolved",
    );
    expect(areDisagreementsResolved(disagreements, resolved)).toBe(true);
  });

  it("opens existing viewers and presents QC metrics with unavailable values", async () => {
    const user = userEvent.setup();
    setState();

    renderResolution();

    await user.click(screen.getByTestId("view-qc-metrics-sub-01_01"));
    const metrics = await screen.findByTestId("resolution-qc-metrics-sub-01_01");
    expect(within(metrics).getByText("78.2%")).toBeInTheDocument();
    expect(within(metrics).getByText("0.42")).toBeInTheDocument();
    expect(within(metrics).getByText("1.3 mm RMS")).toBeInTheDocument();
    expect(within(metrics).getByText("5%")).toBeInTheDocument();

    await user.click(screen.getByTestId("view-qc-metrics-sub-02_02"));
    expect(await screen.findByTestId("resolution-qc-metrics-sub-02_02")).toHaveTextContent(
      "Unavailable",
    );

    await user.click(screen.getByTestId("view-logs-sub-01_01"));
    expect(await screen.findByTestId("log-viewer-modal")).toBeInTheDocument();
    expect(await screen.findByTestId("log-error-alert")).toBeInTheDocument();
    await user.click(within(screen.getByTestId("log-viewer-modal")).getByRole("button"));

    await user.click(screen.getByTestId("view-images-sub-01_01"));
    expect(screen.getByTestId("report-viewer-modal")).toBeInTheDocument();
    expect(await screen.findByTestId("asl-struct-heading")).toHaveTextContent(
      "Subject 01 Session 01",
    );
  });

  it("keeps the latest subject log content when earlier log loading finishes late", async () => {
    const user = userEvent.setup();
    let resolveFirst: (content: Record<string, string>) => void;
    let resolveSecond: (content: Record<string, string>) => void;
    mockFetchLogContent
      .mockImplementationOnce(
        () =>
          new Promise<Record<string, string>>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Record<string, string>>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    setState();

    renderResolution();
    await user.click(screen.getByTestId("view-logs-sub-01_01"));
    await user.click(screen.getByTestId("view-logs-sub-02_02"));
    resolveSecond!({ "sub-02_ASL_1.log": "current log" });

    await screen.findByText("current log");
    resolveFirst!({ "sub-01_ASL_1.log": "stale log" });

    await waitFor(() => expect(screen.queryByText("stale log")).not.toBeInTheDocument());
    expect(screen.getByText("current log")).toBeInTheDocument();
  });
});
