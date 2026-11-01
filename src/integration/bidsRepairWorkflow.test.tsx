/**
 * Existing-project repair workflow integration layer.
 *
 * Desktop WebDriver is not a supported CI layer. This Vitest test mounts the
 * real repair UI and processing store against a stateful IPC fake operating on
 * a Node temporary filesystem. Native setup transaction unit tests cover the
 * journal; this layer proves renderer/store/native-contract sequencing.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TestMantineProvider as MantineProvider } from "../test/render";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile, lstat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import ControlButtons from "../components/processing/ControlButtons";
import { projectFixture } from "../test/projectFixtures";
import { useGlobalStore } from "../stores/globalStore";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import { seedValidProfileGate } from "../test/landingProfileGate";
import { processingSnapshot } from "../test/processingFixtures";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";

type Snapshot = Record<string, { type: string; size: number; hash?: string }>;

async function snapshot(root: string): Promise<Snapshot> {
  const result: Snapshot = {};
  async function visit(path: string): Promise<void> {
    const stat = await lstat(path);
    const key = relative(root, path).replace(/\\/g, "/");
    if (key) {
      result[key] = {
        type: stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "file",
        size: stat.size,
        ...(stat.isFile()
          ? {
              hash: createHash("sha256")
                .update(await readFile(path))
                .digest("hex"),
            }
          : {}),
      };
    }
    if (stat.isDirectory()) for (const child of await readdir(path)) await visit(join(path, child));
  }
  await visit(root);
  return result;
}

function changed(before: Snapshot, after: Snapshot) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]))
    .sort();
}

describe("existing BIDS project repair and retry integration", () => {
  let root = "";
  let projectBytes = "";
  let reviewedPlan: ReturnType<typeof repairPlan> | null = null;
  let runCalls = 0;

  function repairPlan(rootPath: string) {
    return {
      planId: "repair-plan",
      rootPath,
      mode: "repair" as const,
      operations: [
        {
          path: ".bidsignore",
          operation: "update" as const,
          textPreview: "derivatives/\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n",
        },
        {
          path: "rawdata/",
          operation: "create" as const,
          textPreview: null,
        },
      ],
      warnings: [],
      conflicts: [],
      projectSummary: null,
      preservesReadme: true,
      temporaryArtifacts: [],
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    seedValidProfileGate();
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProcessingStore.setState(useProcessingStore.getInitialState(), true);
    root = await mkdtemp(join(tmpdir(), "easl-existing-repair-"));
    await writeFile(join(root, "README.md"), "user README\r\n");
    await writeFile(join(root, "unrelated.bin"), "keep\0bytes");
    await writeFile(join(root, ".bidsignore"), "derivatives/\r\n");
    const profile = useGlobalStore.getState().settings.executionProfiles[0]!;
    const persisted = projectFixture("11111111-1111-4111-8111-111111111111", "Current BIDS", root, {
      mappingState: { sourceDataPath: "." },
      uiState: {
        import: { bidsReviewConfirmed: true, mostRecentConfig: null },
        processing: {
          config: {
            subjects: ["sub-01_01"],
            modules: ["asl"],
            selectedProfileId: profile.id,
            workers: 1,
          },
        },
      },
    });
    persisted.document.projectMeta.dataSource = "bids";
    persisted.document.projectMeta.currentPhase = "processing";
    persisted.allowedPhases = ["import", "parameters", "processing"];
    const settled = structuredClone(persisted);
    settled.acceptedRevision = settled.persistedRevision = 1;
    settled.document.uiState.processing!.currentPhase = "failed";
    projectBytes = JSON.stringify(persisted.document);
    await writeFile(join(root, "project.easl"), projectBytes);

    // Static native acceptance; no renderer configuration parser or writer.
    useProjectStore.getState().acceptSnapshot(persisted);
    activateProjectLease("11111111-1111-4111-8111-111111111111", root);
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
    });
    runCalls = 0;
    reviewedPlan = null;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "scan_bids_sidecars") return { groups: [], skipped: [] };
      if (command === "reserve_processing_run")
        return {
          kind: "current",
          snapshot: processingSnapshot({
            projectRoot: root,
            runId: "12345678-1234-4234-8234-123456789011",
          }),
        };
      if (command === "run_pipeline") {
        runCalls++;
        return runCalls === 1
          ? processingSnapshot({
              projectRoot: root,
              runId: "12345678-1234-4234-8234-123456789011",
              lifecycle: "failed",
              revision: 2,
              terminalResult: "failed",
              terminalRevision: 2,
              availableAction: "acknowledge",
              error: { code: "bidsCompatibility", message: "Review BIDS setup before processing." },
              terminalSummary: {
                result: "failed",
                executionCommitted: false,
                populationCompleted: false,
                profileId: profile.id,
                exploreAslVersion: null,
              },
            })
          : processingSnapshot({
              projectRoot: root,
              runId: "12345678-1234-4234-8234-123456789011",
              lifecycle: "running",
              revision: 3,
            });
      }
      if (command === "attach_run")
        return processingSnapshot({
          projectRoot: root,
          runId: "12345678-1234-4234-8234-123456789011",
          lifecycle: "preparing",
        });
      if (command === "reconcile_processing_result") return settled;
      if (command === "save_project" || command === "get_project_snapshot")
        return runCalls ? settled : persisted;
      if (command === "preflight_bids_setup_repair") {
        reviewedPlan = repairPlan(root);
        return reviewedPlan;
      }
      if (command === "commit_bids_project_mutations") {
        if (!reviewedPlan) throw new Error("unknown repair plan");
        await writeFile(join(root, ".bidsignore"), reviewedPlan.operations[0].textPreview!);
        await mkdir(join(root, "rawdata"));
        return {
          outcome: "committed",
          projectPath: null,
          projectDocument: null,
          candidateId: null,
          directorySyncSupported: true,
        };
      }
      throw new Error(`Unexpected command ${command}`);
    });
  });

  afterEach(async () => {
    cleanup();
    useProjectStore.getState().cancelAutosave();
    resetProjectLifecycleForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("keeps current open/review read-only, requires reviewed repair, then retries without another source mutation", async () => {
    const openedBefore = await snapshot(root);
    await invoke("scan_bids_sidecars", { rootPath: root });
    expect(await snapshot(root)).toEqual(openedBefore);

    render(
      <MantineProvider env="test">
        <ControlButtons />
      </MantineProvider>,
    );
    await useProcessingStore
      .getState()
      .startProcessing()
      .catch(() => {});
    await screen.findByTestId("bids-compatibility-error-text");
    expect(runCalls).toBe(1);
    expect(await snapshot(root)).toEqual(openedBefore);

    fireEvent.click(screen.getByTestId("bids-repair-preflight-btn"));
    await screen.findByTestId("bids-repair-operation--bidsignore");
    const displayed = reviewedPlan!;
    expect(await snapshot(root)).toEqual(openedBefore);
    fireEvent.click(screen.getByTestId("bids-repair-cancel-btn"));
    expect(await snapshot(root)).toEqual(openedBefore);

    fireEvent.click(screen.getByTestId("bids-repair-preflight-btn"));
    await screen.findByTestId("bids-repair-confirm-btn");
    fireEvent.click(screen.getByTestId("bids-repair-confirm-btn"));
    await waitFor(() =>
      expect(screen.queryByTestId("bids-repair-confirm-btn")).not.toBeInTheDocument(),
    );
    const afterRepair = await snapshot(root);
    expect(changed(openedBefore, afterRepair)).toEqual([".bidsignore", "rawdata"]);
    expect(await readFile(join(root, "project.easl"), "utf8")).toBe(projectBytes);
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("user README\r\n");
    expect(await readdir(join(root, "rawdata"))).toEqual([]);
    for (const operation of displayed.operations) {
      if (operation.textPreview) {
        expect(await readFile(join(root, operation.path), "utf8")).toBe(operation.textPreview);
      }
    }

    await useProcessingStore
      .getState()
      .startProcessing()
      .catch(() => {});
    await waitFor(() => expect(runCalls).toBe(2));
    expect(await snapshot(root)).toEqual(afterRepair);
  });
});
