import { beforeEach, describe, expect, it } from "vitest";

import { ProjectFileSchema, type ProjectFile } from "../schemas/project";
import { __resetProjectRevisionForTests, useProjectStore } from "./projectStore";

const REVIEWER_1 = "11111111-1111-4111-8111-111111111111";
const REVIEWER_2 = "22222222-2222-4222-8222-222222222222";
const REVIEWER_3 = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-08-08T12:00:00.000Z";

interface ManifestActions {
  addReviewer: () => void;
  removeReviewer: (id: string) => void;
  renameReviewer: (id: string, label: string) => void;
  setActiveReviewerId: (id: string) => void;
  setManifestVerdict: (
    subjectSession: string,
    status: "pass" | "fail",
    opts?: {
      reason?: "motion" | "coverage" | "dropout" | "artifact" | "registration" | "other";
      notes?: string;
      setAt?: number;
    },
    reviewerId?: string,
  ) => void;
  removeManifestVerdict: (subjectSession: string, reviewerId?: string) => void;
  setResolvedVerdict: (
    subjectSession: string,
    status: "pass" | "fail",
    opts?: {
      reason?: "motion" | "coverage" | "dropout" | "artifact" | "registration" | "other";
      notes?: string;
      setAt?: number;
    },
  ) => void;
  removeResolvedVerdict: (subjectSession: string) => void;
}

function store(): ManifestActions {
  return useProjectStore.getState() as unknown as ManifestActions;
}

function setProject(manifest: unknown = {}, populationMtime?: number) {
  const project: ProjectFile = ProjectFileSchema.parse({
    version: "0.1.0",
    projectMeta: {
      id: "project-id",
      name: "Manifest project",
      rootPath: "/project",
      createdAt: CREATED_AT,
      lastOpened: CREATED_AT,
      currentPhase: "manifest",
      dataSource: "dicom",
    },
    uiState: {
      manifest,
      ...(populationMtime === undefined
        ? {}
        : {
            processing: {
              population: { lastRun: { profileId: "profile", Mtime: populationMtime } },
            },
          }),
    },
    mappingState: {},
    dataPar: {},
  });

  useProjectStore.setState({ project, isDirty: false, loaded: true });
}

function reviewers() {
  return [
    { id: REVIEWER_1, label: "Reviewer 1", createdAt: CREATED_AT },
    { id: REVIEWER_2, label: "Reviewer 2", createdAt: CREATED_AT },
  ];
}

describe("projectStore reviewer manifest actions", () => {
  beforeEach(() => {
    __resetProjectRevisionForTests();
    useProjectStore.setState({ project: null, isDirty: false, loaded: false });
  });

  it("creates two reviewers and wraps flat verdicts on first add", () => {
    setProject({
      verdicts: { "sub-01_01": { status: "pass", setAt: 17 } },
    });

    store().addReviewer();

    const manifest = useProjectStore.getState().project?.uiState.manifest;
    expect(manifest?.reviewers).toHaveLength(2);
    expect(manifest?.reviewers?.map((reviewer) => reviewer.label)).toEqual([
      "Reviewer 1",
      "Reviewer 2",
    ]);
    for (const reviewer of manifest?.reviewers ?? []) {
      expect(reviewer.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(reviewer.createdAt).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(reviewer.createdAt))).toBe(false);
    }
    expect(manifest?.activeReviewerId).toBe(manifest?.reviewers?.[0].id);
    expect(manifest?.verdicts).toEqual({
      [manifest!.reviewers![0].id]: { "sub-01_01": { status: "pass", setAt: 17 } },
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("preserves an explicit first reviewer while adding and wrapping", () => {
    setProject({
      reviewers: [reviewers()[0]],
      verdicts: { "sub-01_01": { status: "pass", setAt: 17 } },
    });

    store().addReviewer();

    const manifest = useProjectStore.getState().project?.uiState.manifest;
    expect(manifest?.reviewers?.[0]).toEqual(reviewers()[0]);
    expect(manifest?.reviewers?.[1]).toMatchObject({ label: "Reviewer 2" });
    expect(manifest?.verdicts).toEqual({
      [REVIEWER_1]: { "sub-01_01": { status: "pass", setAt: 17 } },
    });
  });

  it("treats an explicit empty registry as single-reviewer mode when adding", () => {
    setProject({
      reviewers: [],
      verdicts: { "sub-01_01": { status: "pass", setAt: 17 } },
    });

    store().addReviewer();

    const manifest = useProjectStore.getState().project?.uiState.manifest;
    expect(manifest?.reviewers).toHaveLength(2);
    expect(manifest?.reviewers?.map((reviewer) => reviewer.label)).toEqual([
      "Reviewer 1",
      "Reviewer 2",
    ]);
    expect(manifest?.activeReviewerId).toBe(manifest?.reviewers?.[0].id);
    expect(manifest?.verdicts).toEqual({
      [manifest!.reviewers![0].id]: { "sub-01_01": { status: "pass", setAt: 17 } },
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("appends a third reviewer and leaves a five-reviewer project untouched", () => {
    setProject({ reviewers: reviewers(), verdicts: { [REVIEWER_1]: {}, [REVIEWER_2]: {} } });

    store().addReviewer();

    expect(useProjectStore.getState().project?.uiState.manifest?.reviewers).toHaveLength(3);
    expect(useProjectStore.getState().project?.uiState.manifest?.reviewers?.[2].label).toBe(
      "Reviewer 3",
    );

    const fiveReviewers = Array.from({ length: 5 }, (_, index) => ({
      id: `${index + 4}${index + 4}${index + 4}${index + 4}${index + 4}${index + 4}${index + 4}${index + 4}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      label: `Reviewer ${index + 1}`,
      createdAt: CREATED_AT,
    }));
    setProject({
      reviewers: fiveReviewers,
      verdicts: Object.fromEntries(fiveReviewers.map((reviewer) => [reviewer.id, {}])),
    });
    const before = useProjectStore.getState();

    store().addReviewer();

    expect(useProjectStore.getState()).toBe(before);
  });

  it("removes reviewer slices immediately, reassigns active reviewer, and unwraps to single mode", () => {
    const reviewer3 = { id: REVIEWER_3, label: "Reviewer 3", createdAt: CREATED_AT };
    setProject({
      reviewers: [...reviewers(), reviewer3],
      activeReviewerId: REVIEWER_2,
      verdicts: {
        [REVIEWER_1]: { "sub-01_01": { status: "pass", setAt: 1 } },
        [REVIEWER_2]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
        [REVIEWER_3]: {},
      },
    });

    store().removeReviewer(REVIEWER_2);

    expect(useProjectStore.getState().project?.uiState.manifest).toMatchObject({
      reviewers: [reviewers()[0], reviewer3],
      activeReviewerId: REVIEWER_1,
      verdicts: { [REVIEWER_1]: { "sub-01_01": { status: "pass", setAt: 1 } }, [REVIEWER_3]: {} },
    });
    expect(useProjectStore.getState().isDirty).toBe(true);

    useProjectStore.setState({ isDirty: false });
    const beforeUnknown = useProjectStore.getState();
    store().removeReviewer("44444444-4444-4444-8444-444444444444");
    expect(useProjectStore.getState()).toBe(beforeUnknown);

    setProject({
      reviewers: reviewers(),
      activeReviewerId: REVIEWER_1,
      verdicts: {
        [REVIEWER_1]: { "sub-01_01": { status: "pass", setAt: 1 } },
        [REVIEWER_2]: { "sub-02_01": { status: "fail", reason: "motion", setAt: 2 } },
      },
      resolvedVerdicts: { "sub-01_01": { status: "pass", setAt: 3 } },
    });

    store().removeReviewer(REVIEWER_1);

    expect(useProjectStore.getState().project?.uiState.manifest).toEqual({
      verdicts: { "sub-02_01": { status: "fail", reason: "motion", setAt: 2 } },
    });
  });

  it("renames only valid known reviewers and tracks the active reviewer", () => {
    setProject({
      reviewers: reviewers(),
      activeReviewerId: REVIEWER_1,
      verdicts: { [REVIEWER_1]: { "sub-01_01": { status: "pass", setAt: 1 } }, [REVIEWER_2]: {} },
    });

    store().renameReviewer(REVIEWER_2, "Second QC reader");

    const manifest = useProjectStore.getState().project?.uiState.manifest;
    expect(manifest?.reviewers?.[1]).toEqual({
      ...reviewers()[1],
      label: "Second QC reader",
    });
    expect(manifest?.activeReviewerId).toBe(REVIEWER_1);
    expect(manifest?.verdicts).toMatchObject({ [REVIEWER_1]: { "sub-01_01": { status: "pass" } } });
    expect(useProjectStore.getState().isDirty).toBe(true);

    useProjectStore.setState({ isDirty: false });
    const beforeInvalid = useProjectStore.getState();
    store().renameReviewer(REVIEWER_2, "");
    store().renameReviewer(REVIEWER_2, "x".repeat(101));
    store().renameReviewer("44444444-4444-4444-8444-444444444444", "Unknown");
    expect(useProjectStore.getState()).toBe(beforeInvalid);

    store().setActiveReviewerId(REVIEWER_2);
    expect(useProjectStore.getState().project?.uiState.manifest?.activeReviewerId).toBe(REVIEWER_2);
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("writes and removes verdicts in the active multi-reviewer slice without crossing slices", () => {
    setProject(
      {
        reviewers: reviewers(),
        activeReviewerId: REVIEWER_1,
        verdicts: {
          [REVIEWER_1]: {},
          [REVIEWER_2]: { "sub-old_01": { status: "pass", setAt: 1 } },
        },
      },
      99,
    );

    store().setManifestVerdict("sub-01_01", "pass", {}, REVIEWER_2);
    store().setManifestVerdict("sub-02_01", "fail", { reason: "motion" });

    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      [REVIEWER_1]: { "sub-02_01": { status: "fail", reason: "motion", setAt: 99 } },
      [REVIEWER_2]: {
        "sub-old_01": { status: "pass", setAt: 1 },
        "sub-01_01": { status: "pass", setAt: 99 },
      },
    });

    store().removeManifestVerdict("sub-01_01", REVIEWER_2);
    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      [REVIEWER_1]: { "sub-02_01": { status: "fail", reason: "motion", setAt: 99 } },
      [REVIEWER_2]: { "sub-old_01": { status: "pass", setAt: 1 } },
    });

    useProjectStore.setState({ isDirty: false });
    const beforeUnknown = useProjectStore.getState();
    store().setManifestVerdict("sub-03_01", "pass", {}, "44444444-4444-4444-8444-444444444444");
    store().removeManifestVerdict("sub-old_01", "44444444-4444-4444-8444-444444444444");
    expect(useProjectStore.getState()).toBe(beforeUnknown);
  });

  it("keeps single-reviewer verdicts flat and rejects invalid verdicts without mutation", () => {
    setProject({}, 42);

    store().setManifestVerdict("sub-01_01", "pass", {}, REVIEWER_1);
    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      "sub-01_01": { status: "pass", setAt: 42 },
    });

    useProjectStore.setState({ isDirty: false });
    const beforeInvalid = useProjectStore.getState();
    expect(() => store().setManifestVerdict("sub-02_01", "fail", {})).toThrow(/reason is required/);
    expect(useProjectStore.getState()).toBe(beforeInvalid);

    store().removeManifestVerdict("sub-01_01", REVIEWER_1);
    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({});
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("allows pass verdicts without an empty options object", () => {
    setProject({}, 42);

    store().setManifestVerdict("sub-01_01", "pass");

    expect(useProjectStore.getState().project?.uiState.manifest?.verdicts).toEqual({
      "sub-01_01": { status: "pass", setAt: 42 },
    });
  });

  it("sets and removes validated resolved verdicts with dirty tracking", () => {
    setProject(
      {
        reviewers: reviewers(),
        activeReviewerId: REVIEWER_1,
        verdicts: { [REVIEWER_1]: {}, [REVIEWER_2]: {} },
      },
      17,
    );

    store().setResolvedVerdict("sub-01_01", "fail", { reason: "artifact", notes: "blur" });
    expect(useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts).toEqual({
      "sub-01_01": { status: "fail", reason: "artifact", notes: "blur", setAt: 17 },
    });
    expect(useProjectStore.getState().isDirty).toBe(true);

    useProjectStore.setState({ isDirty: false });
    const beforeInvalid = useProjectStore.getState();
    expect(() => store().setResolvedVerdict("sub-02_01", "fail", {})).toThrow(/reason is required/);
    expect(useProjectStore.getState()).toBe(beforeInvalid);

    store().removeResolvedVerdict("sub-01_01");
    expect(useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts).toEqual({});
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("clears a resolution when a reviewer changes its subject-session verdict", () => {
    setProject({
      reviewers: reviewers(),
      activeReviewerId: REVIEWER_1,
      verdicts: {
        [REVIEWER_1]: { "sub-01_01": { status: "pass", setAt: 1 } },
        [REVIEWER_2]: { "sub-01_01": { status: "fail", reason: "motion", setAt: 1 } },
      },
      resolvedVerdicts: { "sub-01_01": { status: "pass", setAt: 1 } },
    });

    store().setManifestVerdict("sub-01_01", "fail", { reason: "coverage" }, REVIEWER_1);

    expect(useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts).toEqual({});
  });

  it("allows pass resolutions without an empty options object", () => {
    setProject({}, 17);

    store().setResolvedVerdict("sub-01_01", "pass");

    expect(useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts).toEqual({
      "sub-01_01": { status: "pass", setAt: 17 },
    });
  });
});
