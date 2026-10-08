import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "./projectStore";
import { projectFixture } from "../test/projectFixtures";
import { projectView } from "../schemas/project";

afterEach(() => vi.restoreAllMocks());

describe("projectStore reviewer manifest clients", () => {
  it("submits registered review actions without mutating the accepted cache locally", async () => {
    useProjectStore.setState({ project: projectView(projectFixture()) });
    const state = useProjectStore.getState();
    const submit = vi.spyOn(state, "submitEdit").mockResolvedValue();
    const before = state.project;
    await state.addReviewer();
    await state.removeReviewer("reviewer");
    await state.renameReviewer("reviewer", "Reader");
    await state.setActiveReviewerId("reviewer");
    await state.setManifestVerdict("sub-01_01", "pass");
    await state.setManifestVerdict(
      "sub-01_01",
      "fail",
      { reason: "motion", notes: "blur" },
      "reviewer",
    );
    await state.removeManifestVerdict("sub-01_01", "reviewer");
    await state.setResolvedVerdict("sub-01_01", "pass");
    await state.removeResolvedVerdict("sub-01_01");
    expect(submit.mock.calls.map(([edit]) => edit)).toEqual([
      { kind: "addReviewer" },
      { kind: "removeReviewer", id: "reviewer" },
      { kind: "renameReviewer", id: "reviewer", label: "Reader" },
      { kind: "activeReviewer", id: "reviewer" },
      {
        kind: "verdict",
        subjectSession: "sub-01_01",
        reviewerId: null,
        value: { status: "pass", setAt: 0 },
      },
      {
        kind: "verdict",
        subjectSession: "sub-01_01",
        reviewerId: "reviewer",
        value: { status: "fail", reason: "motion", notes: "blur", setAt: 0 },
      },
      { kind: "verdict", subjectSession: "sub-01_01", reviewerId: "reviewer", value: null },
      { kind: "resolution", subjectSession: "sub-01_01", value: { status: "pass", setAt: 0 } },
      { kind: "resolution", subjectSession: "sub-01_01", value: null },
    ]);
    expect(useProjectStore.getState().project).toBe(before);
  });
});
