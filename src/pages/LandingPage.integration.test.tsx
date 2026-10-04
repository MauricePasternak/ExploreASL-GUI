/**
 * Landing pre-confirmation integration layer.
 *
 * Runs in Vitest/jsdom because desktop WebDriver coverage is not stable in CI.
 * The renderer is mounted normally; dialog and IPC edges use a stateful fake
 * backed by an actual temporary source tree. Any accidental create/commit fake
 * writes that tree, so byte snapshots make an early mutation observable.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { TestMantineProvider as MantineProvider } from "../test/render";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import LandingPage from "./LandingPage";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import { seedValidProfileGate } from "../test/landingProfileGate";

type TreeSnapshot = Record<string, { type: string; size: number; hash?: string }>;

async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const snapshot: TreeSnapshot = {};
  async function visit(path: string): Promise<void> {
    const stat = await lstat(path);
    const key = relative(root, path).replace(/\\/g, "/");
    if (key) {
      snapshot[key] = {
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
    if (stat.isDirectory()) {
      for (const child of await readdir(path)) await visit(join(path, child));
    }
  }
  await visit(root);
  return snapshot;
}

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "easl-landing-preflight-"));
  await writeFile(join(root, "dataset_description.json"), '{"Name":"fixture"}\n');
  await writeFile(join(root, "notes.txt"), "user bytes\r\n");
  return root;
}

const bidsResult = {
  isBids: true,
  hasDatasetDescription: true,
  datasetDescError: null,
  bidsVersion: "1.9.0",
  aslSubjectCount: 1,
  aslSessionCount: 1,
  totalSubjectCount: 1,
  missingSidecars: [],
  missingAslcontextCount: 0,
  hasPerfDirectory: true,
  isCrossSectional: true,
  error: null,
};

function plan(rootPath: string, planId = "reviewed-plan") {
  return {
    planId,
    rootPath,
    mode: "bids" as const,
    operations: [
      { path: "project.easl", operation: "create" as const, textPreview: null },
      {
        path: "rawdata/.easl-gui-managed",
        operation: "create" as const,
        textPreview: '{"kind":"bids-direct-rawdata","version":1}\n',
      },
    ],
    warnings: [],
    conflicts: [],
    projectSummary: null,
    preservesReadme: true,
    temporaryArtifacts: [],
  };
}

describe("Landing BIDS pre-confirmation source-tree integration", () => {
  const roots: string[] = [];

  afterEach(async () => {
    cleanup();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useGlobalStore.setState(useGlobalStore.getInitialState(), true);
    seedValidProfileGate();
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "is_writable") return true;
      if (command === "check_bids_dataset") return bidsResult;
      if (command === "commit_bids_project_mutations") {
        // This fake intentionally writes if a supposedly read-only path calls it.
        throw new Error("unexpected commit before confirmation");
      }
      return null;
    });
  });

  function mount() {
    return render(
      <MantineProvider env="test">
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </MantineProvider>,
    );
  }

  async function scanAndReview(root: string, mountPage = true) {
    vi.mocked(open).mockResolvedValue(root);
    if (mountPage) mount();
    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await screen.findByTestId("bids-detection-dialog");
    fireEvent.click(screen.getByTestId("bids-detection-dialog-skip-radio"));
    await screen.findByTestId("bids-setup-plan");
  }

  it("snapshots scan, review, dismissal, Cancel, and folder reselection without activation", async () => {
    const root = await makeFixture();
    const replacement = await makeFixture();
    roots.push(root, replacement);
    const before = await snapshotTree(root);
    const replacementBefore = await snapshotTree(replacement);
    useProjectStore.setState({
      preflightProjectSetup: vi.fn(async (rootPath) => plan(rootPath)),
      // A bug calling this before confirmation mutates the fixture and fails
      // the snapshot assertion instead of being hidden by a harmless mock.
      createProject: vi.fn(async (rootPath) => writeFile(join(rootPath, "project.easl"), "WRONG")),
    });

    await scanAndReview(root);
    expect(await snapshotTree(root)).toEqual(before);
    expect(useProjectStore.getState().project).toBeNull();
    expect(useGlobalStore.getState().settings.recentProjects).toEqual([]);
    expect(vi.mocked(writeTextFile)).not.toHaveBeenCalled();

    // Modal dismissal is a separate path from its explicit Cancel action.
    const dismiss = screen.getByTestId("bids-detection-dialog").querySelector("button");
    expect(dismiss).not.toBeNull();
    fireEvent.click(dismiss!);
    await waitFor(() =>
      expect(screen.queryByTestId("bids-detection-dialog-skip-radio")).not.toBeInTheDocument(),
    );
    expect(await snapshotTree(root)).toEqual(before);

    await scanAndReview(root, false);
    fireEvent.click(screen.getByTestId("bids-detection-dialog-cancel-btn"));
    await waitFor(() =>
      expect(screen.queryByTestId("bids-detection-dialog")).not.toBeInTheDocument(),
    );
    expect(await snapshotTree(root)).toEqual(before);

    await scanAndReview(root, false);
    vi.mocked(open).mockResolvedValueOnce(replacement);
    fireEvent.click(screen.getByTestId("bids-detection-dialog-choose-btn"));
    await screen.findByTestId("bids-detection-dialog");
    expect(await snapshotTree(root)).toEqual(before);
    expect(await snapshotTree(replacement)).toEqual(replacementBefore);
    expect(useProjectStore.getState().createProject).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("commit_bids_project_mutations", expect.anything());
    expect(useGlobalStore.getState().settings.recentProjects).toEqual([]);
  });

  it("preserves the fixture for preflight failure and native stale-plan rejection", async () => {
    const root = await makeFixture();
    roots.push(root);
    const before = await snapshotTree(root);
    useProjectStore.setState({
      preflightProjectSetup: vi
        .fn()
        .mockRejectedValueOnce(new Error("marker is a symbolic link"))
        .mockResolvedValueOnce(plan(root, "stale-plan")),
    });

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "is_writable") return true;
      if (command === "check_bids_dataset") return bidsResult;
      // This is the actual project-store commit boundary. Rejecting here
      // proves confirmation reaches native IPC, while no renderer-side write
      // or activation occurs when native rejects the reviewed ID as stale.
      if (command === "commit_bids_project_mutations") {
        throw new Error("stale plan; review a fresh plan");
      }
      return null;
    });
    vi.mocked(open).mockResolvedValue(root);
    mount();
    fireEvent.click(screen.getByTestId("landing-new-project-btn"));
    await screen.findByTestId("bids-detection-dialog");
    fireEvent.click(screen.getByTestId("bids-detection-dialog-skip-radio"));
    await screen.findByTestId("bids-setup-plan-error");
    expect(await snapshotTree(root)).toEqual(before);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith(
      "commit_bids_project_mutations",
      expect.anything(),
    );

    // Reopen gets the next plan; confirmation reaches the stale native result,
    // but neither fake write nor Recent Projects/navigation occurs.
    fireEvent.click(screen.getByTestId("bids-detection-dialog-cancel-btn"));
    await scanAndReview(root, false);
    fireEvent.click(screen.getByTestId("bids-detection-dialog-continue-btn"));
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("commit_bids_project_mutations", {
        planId: "stale-plan",
      }),
    );
    expect(await snapshotTree(root)).toEqual(before);
    expect(useProjectStore.getState().project).toBeNull();
    expect(useGlobalStore.getState().settings.recentProjects).toEqual([]);
  });
});
