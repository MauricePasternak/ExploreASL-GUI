import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import ReviewerTabs from "./ReviewerTabs";
import { useProjectStore } from "../../stores/projectStore";

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

function setManifest(manifest: Record<string, unknown>) {
  useProjectStore.setState({
    project: {
      version: "0.1.0",
      projectMeta: {
        id: "project-1",
        name: "Reviewer tabs",
        rootPath: "/project",
        createdAt: "2026-08-08T00:00:00.000Z",
        lastOpened: "2026-08-08T00:00:00.000Z",
        currentPhase: "manifest",
        dataSource: "dicom",
      },
      uiState: { manifest },
      mappingState: {},
      dataPar: {},
    } as any,
    isDirty: false,
    loaded: true,
  });
}

function renderTabs(eligibleSubjectSessions = ["sub-01_01", "sub-02_01"]) {
  return render(
    <MantineProvider>
      <ReviewerTabs eligibleSubjectSessions={eligibleSubjectSessions}>
        {(reviewerId, addControl) => (
          <div data-testid="reviewer-content">
            {reviewerId ?? "single"}
            {addControl}
          </div>
        )}
      </ReviewerTabs>
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  useProjectStore.setState({ project: null, isDirty: false, loaded: false });
});

describe("ReviewerTabs", () => {
  it("renders single-reviewer children without tabs and provides Add Reviewer", async () => {
    const user = userEvent.setup();
    setManifest({ verdicts: {} });

    renderTabs();

    expect(screen.queryByTestId("reviewer-tabs")).not.toBeInTheDocument();
    expect(screen.getByTestId("reviewer-content")).toHaveTextContent("single");
    await user.click(screen.getByTestId("add-reviewer"));
    expect(useProjectStore.getState().project?.uiState.manifest?.reviewers).toHaveLength(2);
  });

  it("renders active multi-reviewer tabs and selects the clicked reviewer", async () => {
    const user = userEvent.setup();
    setManifest({ reviewers, activeReviewerId: reviewers[0].id, verdicts: {} });

    renderTabs();

    expect(screen.getByTestId("reviewer-tabs")).toBeInTheDocument();
    expect(screen.getByTestId(`reviewer-tab-${reviewers[0].id}`)).toHaveTextContent("Reviewer 1");
    expect(screen.getByTestId(`reviewer-tab-${reviewers[1].id}`)).toHaveTextContent("Reviewer 2");
    expect(screen.getByTestId("reviewer-content")).toHaveTextContent(reviewers[0].id);

    await user.click(screen.getByTestId(`reviewer-tab-${reviewers[1].id}`));

    expect(useProjectStore.getState().project?.uiState.manifest?.activeReviewerId).toBe(
      reviewers[1].id,
    );
    expect(screen.getByTestId("reviewer-content")).toHaveTextContent(reviewers[1].id);
  });

  it("keeps removal controls separate from tab buttons", () => {
    setManifest({ reviewers, activeReviewerId: reviewers[0].id, verdicts: {} });

    renderTabs();

    for (const reviewer of reviewers) {
      const tab = screen.getByTestId(`reviewer-tab-${reviewer.id}`);
      const remove = screen.getByTestId(`remove-reviewer-${reviewer.id}`);
      expect(tab).not.toContainElement(remove);
    }
  });

  it("groups each reviewer tab with its labelled removal control and confirms that reviewer removal", async () => {
    const user = userEvent.setup();
    setManifest({
      reviewers,
      activeReviewerId: reviewers[0].id,
      verdicts: {
        [reviewers[1].id]: { "sub-01_01": { status: "pass", setAt: 1 } },
      },
    });

    renderTabs();

    for (const reviewer of reviewers) {
      const group = screen.getByTestId(`reviewer-tab-group-${reviewer.id}`);
      const tab = within(group).getByRole("tab", { name: new RegExp(reviewer.label) });
      const remove = within(group).getByRole("button", {
        name: `Remove ${reviewer.label}`,
      });

      expect(group).toContainElement(tab);
      expect(group).toContainElement(remove);
      expect(tab).not.toContainElement(remove);
    }

    await user.click(
      within(screen.getByTestId(`reviewer-tab-group-${reviewers[1].id}`)).getByRole("button", {
        name: "Remove Reviewer 2",
      }),
    );
    await user.click(await screen.findByTestId("confirm-remove-reviewer"));

    const manifest = useProjectStore.getState().project?.uiState.manifest;
    expect(manifest?.reviewers).toBeUndefined();
    const verdicts = (manifest?.verdicts ?? {}) as Record<string, unknown>;
    expect(verdicts[reviewers[1].id]).toBeUndefined();
  });

  it("falls back to the first reviewer when the stored active ID is no longer registered", () => {
    setManifest({
      reviewers,
      activeReviewerId: "33333333-3333-4333-8333-333333333333",
      verdicts: {},
    });

    renderTabs();

    expect(screen.getByTestId("reviewer-content")).toHaveTextContent(reviewers[0].id);
    expect(useProjectStore.getState().project?.uiState.manifest?.activeReviewerId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("updates completion badges from eligible subjects and active reviewer verdict slices", async () => {
    setManifest({
      reviewers,
      activeReviewerId: reviewers[0].id,
      verdicts: {
        [reviewers[0].id]: {
          "sub-01_01": { status: "pass", setAt: 1 },
          "no-info": { status: "fail", reason: "other", setAt: 1 },
        },
        [reviewers[1].id]: {
          "sub-02_01": { status: "fail", reason: "other", setAt: 1 },
        },
      },
    });

    const view = renderTabs();

    expect(screen.getByTestId(`reviewer-completion-${reviewers[0].id}`)).toHaveTextContent("1/2");
    expect(screen.getByTestId(`reviewer-completion-${reviewers[1].id}`)).toHaveTextContent("1/2");

    useProjectStore
      .getState()
      .setManifestVerdict("sub-02_01", "pass", { setAt: 1 }, reviewers[0].id);
    await waitFor(() =>
      expect(screen.getByTestId(`reviewer-completion-${reviewers[0].id}`)).toHaveTextContent("2/2"),
    );

    view.rerender(
      <MantineProvider>
        <ReviewerTabs eligibleSubjectSessions={["sub-01_01"]}>
          {(reviewerId) => <div data-testid="reviewer-content">{reviewerId ?? "single"}</div>}
        </ReviewerTabs>
      </MantineProvider>,
    );
    expect(screen.getByTestId(`reviewer-completion-${reviewers[0].id}`)).toHaveTextContent("1/1");
  });

  it("reports multi-review readiness only when every reviewer completes every eligible subject", async () => {
    const onMultiReviewerReady = vi.fn();
    setManifest({
      reviewers,
      activeReviewerId: reviewers[0].id,
      verdicts: {
        [reviewers[0].id]: { "sub-01_01": { status: "pass", setAt: 1 } },
        [reviewers[1].id]: {},
      },
    });

    render(
      <MantineProvider>
        <ReviewerTabs
          eligibleSubjectSessions={["sub-01_01"]}
          onMultiReviewerReady={onMultiReviewerReady}
        >
          {(reviewerId) => <div data-testid="reviewer-content">{reviewerId}</div>}
        </ReviewerTabs>
      </MantineProvider>,
    );

    expect(onMultiReviewerReady).toHaveBeenLastCalledWith(false);

    useProjectStore
      .getState()
      .setManifestVerdict("sub-01_01", "pass", { setAt: 1 }, reviewers[1].id);

    await waitFor(() => expect(onMultiReviewerReady).toHaveBeenLastCalledWith(true));
  });

  it("adds reviewers and disables the persistent control at the reviewer cap", async () => {
    const user = userEvent.setup();
    const cappedReviewers = Array.from({ length: 5 }, (_, index) => ({
      id: `reviewer-${index + 1}`,
      label: `Reviewer ${index + 1}`,
      createdAt: "2026-08-08T00:00:00.000Z",
    }));
    setManifest({
      reviewers: cappedReviewers,
      activeReviewerId: cappedReviewers[0].id,
      verdicts: {},
    });

    renderTabs();

    const addButton = screen.getByTestId("add-reviewer");
    expect(addButton).toBeDisabled();
    await user.hover(addButton.parentElement!);
    expect(await screen.findByText("Maximum of 5 reviewers reached")).toBeInTheDocument();
  });

  it("removes an empty reviewer slice immediately and returns two reviewers to single mode", async () => {
    const user = userEvent.setup();
    setManifest({
      reviewers,
      activeReviewerId: reviewers[0].id,
      verdicts: { [reviewers[0].id]: {} },
    });

    renderTabs();
    await user.click(screen.getByTestId(`remove-reviewer-${reviewers[1].id}`));

    const manifest = useProjectStore.getState().project?.uiState.manifest;
    expect(manifest?.reviewers).toBeUndefined();
    expect(manifest?.verdicts).toEqual({});
    expect(screen.queryByTestId("reviewer-tabs")).not.toBeInTheDocument();
    expect(screen.queryByTestId(`remove-reviewer-${reviewers[0].id}`)).not.toBeInTheDocument();
  });

  it("keeps a nonempty reviewer slice when removal is cancelled", async () => {
    const user = userEvent.setup();
    setManifest({
      reviewers,
      activeReviewerId: reviewers[0].id,
      verdicts: {
        [reviewers[1].id]: { "sub-01_01": { status: "pass", setAt: 1 } },
      },
    });

    renderTabs();
    await user.click(screen.getByTestId(`remove-reviewer-${reviewers[1].id}`));
    expect(await screen.findByText(/permanently delete/i)).toBeInTheDocument();
    await user.click(screen.getByTestId("cancel-remove-reviewer"));

    const manifest = useProjectStore.getState().project?.uiState.manifest;
    expect(manifest?.reviewers).toHaveLength(2);
    const verdicts = (manifest?.verdicts ?? {}) as Record<string, unknown>;
    expect(verdicts[reviewers[1].id]).toBeDefined();
  });

  it("removes a nonempty reviewer slice only after confirmation", async () => {
    const user = userEvent.setup();
    setManifest({
      reviewers,
      activeReviewerId: reviewers[0].id,
      verdicts: {
        [reviewers[1].id]: { "sub-01_01": { status: "pass", setAt: 1 } },
      },
    });

    renderTabs();
    await user.click(screen.getByTestId(`remove-reviewer-${reviewers[1].id}`));
    await user.click(await screen.findByTestId("confirm-remove-reviewer"));

    const manifest = useProjectStore.getState().project?.uiState.manifest;
    expect(manifest?.reviewers).toBeUndefined();
    const verdicts = (manifest?.verdicts ?? {}) as Record<string, unknown>;
    expect(verdicts[reviewers[1].id]).toBeUndefined();
  });
});
