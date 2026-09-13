import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { attachRun, reserveProcessingRun } from "../lib/processingEvents";
import {
  processingProfile,
  processingReplay,
  processingSnapshot,
  processingTerminal,
} from "../test/processingFixtures";
import { DEFAULT_PROJECT_FILE } from "../schemas/project";
import { useProjectStore } from "../stores/projectStore";
import { useProcessingStore } from "../stores/processingStore";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const request = {
  requestId: "12345678-1234-4234-8234-123456789010",
  projectId: "project-1",
  selectedModules: ["structural"] as "structural"[],
  selectedSubjectSessions: ["sub-001_01"],
  executionProfile: processingProfile,
  dataPar: {},
  participants: { correction: false, subjectRows: [], metadataGroups: [] },
  workers: 1,
  rerunBids2legacy: false,
};
describe("processing run protocol", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetProjectLifecycleForTests();
    await useProcessingStore.getState().resetProcessing();
    useProjectStore.setState({ project: DEFAULT_PROJECT_FILE("project-1", "Project", "/project") });
    activateProjectLease("project-1", "/project");
  });
  it("distinguishes current reservation from historical replay", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ kind: "current", snapshot: processingSnapshot() })
      .mockResolvedValueOnce({ kind: "historical", replay: processingReplay() });
    expect((await reserveProcessingRun(request, "/project")).kind).toBe("current");
    expect((await reserveProcessingRun(request, "/project")).kind).toBe("historical");
  });
  it("attaches snapshot and rejects stale revision", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      processingSnapshot({ lifecycle: "running", revision: 2 }),
    );
    const snapshot = await attachRun(processingSnapshot().runId);
    useProcessingStore.getState().bindRunSnapshot(snapshot);
    useProcessingStore
      .getState()
      .reconcileRunSnapshot(processingSnapshot({ lifecycle: "preparing", revision: 1 }));
    expect(useProcessingStore.getState().processingPhase).toBe("running");
  });
  it("projects native terminal outcome", () => {
    useProcessingStore.getState().bindRunSnapshot(processingSnapshot({ lifecycle: "running" }));
    useProcessingStore.getState().reconcileRunSnapshot(processingTerminal());
    expect(useProcessingStore.getState()).toMatchObject({
      processingPhase: "completed",
      terminalRunId: processingSnapshot().runId,
    });
  });
});
