import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useProcessingStore } from "../stores/processingStore";
import { __resetProjectRevisionForTests, useProjectStore } from "../stores/projectStore";
import { useProcessingSync } from "./useProcessingSync";

const SAVE_PROJECT = vi.fn().mockResolvedValue(undefined);
const SYNC_PROCESSING_STATE = vi.fn();

vi.mock("../stores/projectStore", async () => {
  const actual =
    await vi.importActual<typeof import("../stores/projectStore")>("../stores/projectStore");
  return {
    ...actual,
    useProjectStore: {
      ...actual.useProjectStore,
      getState: () => ({
        ...actual.useProjectStore.getState(),
        syncProcessingState: SYNC_PROCESSING_STATE,
        saveProject: SAVE_PROJECT,
      }),
    },
  };
});

const PROJECT = {
  version: "0.1.0",
  projectMeta: {
    id: "proc-test",
    name: "Proc Test",
    rootPath: "/tmp/proc-test",
    createdAt: new Date().toISOString(),
    lastOpened: new Date().toISOString(),
    currentPhase: "processing" as const,
    dataSource: "dicom" as const,
  },
  uiState: {
    processing: {
      config: {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        selectedProfileId: "p1",
        workers: 1,
      },
      currentPhase: "idle",
    },
  },
  mappingState: {},
  dataPar: {},
};

describe("useProcessingSync", () => {
  let hookResult: { unmount: () => void } | null = null;

  afterEach(() => {
    if (hookResult) {
      hookResult.unmount();
      hookResult = null;
    }
  });

  beforeEach(() => {
    __resetProjectRevisionForTests();
    SYNC_PROCESSING_STATE.mockClear();
    SAVE_PROJECT.mockClear();

    useProjectStore.setState({
      project: PROJECT as any,
      isDirty: false,
      loaded: true,
    });
    useProcessingStore.setState({
      processingPhase: "idle",
      config: null,
      availableSubjects: [],
      subjectStatuses: [],
      workerPids: [],
      pendingRawdataWarning: null,
      profileError: null,
      preparingMessage: null,
    });
  });

  it("does NOT call syncProcessingState when only subjectStatuses changes", () => {
    hookResult = renderHook(() => useProcessingSync());

    SYNC_PROCESSING_STATE.mockClear();

    act(() => {
      useProcessingStore.setState({
        subjectStatuses: [
          {
            subjectSession: "sub-001_01",
            module: "structural",
            run: undefined,
            status: "incomplete",
            completedSteps: ["060_Segment_T1w"],
            locked: true,
          },
        ],
      });
    });

    expect(SYNC_PROCESSING_STATE).not.toHaveBeenCalled();
  });

  it("calls syncProcessingState when processingPhase changes", () => {
    hookResult = renderHook(() => useProcessingSync());

    SYNC_PROCESSING_STATE.mockClear();

    act(() => {
      useProcessingStore.setState({ processingPhase: "running" });
    });

    expect(SYNC_PROCESSING_STATE).toHaveBeenCalledTimes(1);
  });

  it("calls syncProcessingState when config changes", () => {
    hookResult = renderHook(() => useProcessingSync());

    SYNC_PROCESSING_STATE.mockClear();

    act(() => {
      useProcessingStore.getState().setConfig({
        subjects: ["sub-001_01"],
        modules: ["structural"],
        selectedProfileId: "p1",
        workers: 1,
      });
    });

    expect(SYNC_PROCESSING_STATE).toHaveBeenCalled();
  });
});
