import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { projectFixture } from "../test/projectFixtures";
import { useProjectStore } from "./projectStore";
import { acceptedDataPar, useDataParStore } from "./dataParStore";

beforeEach(() => {
  resetProjectLifecycleForTests();
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useProjectStore.getState().acceptSnapshot(projectFixture());
  activateProjectLease("project-1", "/project");
  vi.mocked(invoke).mockReset();
  useDataParStore.getState().resetDataPar();
});
afterEach(() => {
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
});

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------
describe("dataParStore initial state", () => {
  it("starts with empty dataPar", () => {
    expect(acceptedDataPar()).toEqual({});
    expect(useDataParStore.getState().drafts).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// setDataParField
// ---------------------------------------------------------------------------
describe("dataParStore setDataParField", () => {
  it("sets an array field and aligns corresponding atlas arrays", async () => {
    const accepted = { ...projectFixture(), acceptedRevision: 1 };
    accepted.document.dataPar = {
      Lambda: 0.9,
      Atlases: ["Total", "DeepWM", "AAL3v1"],
      TissueMasking: ["GM", "WM", "GM"],
      TissueThreshold: [0.7, 0.7, 0.7],
    };
    const before = projectFixture();
    before.document.dataPar = { Lambda: 0.9 };
    useProjectStore.getState().acceptSnapshot(before);
    vi.mocked(invoke).mockResolvedValueOnce(accepted);
    await useDataParStore.getState().setDataParField("Atlases", ["Total", "DeepWM", "AAL3v1"]);
    expect(invoke).toHaveBeenCalledWith(
      "accept_project_edit",
      expect.objectContaining({
        edit: expect.objectContaining({ kind: "parameters", values: accepted.document.dataPar }),
      }),
    );
    expect(acceptedDataPar()).toEqual(accepted.document.dataPar);
    const cleared = { ...projectFixture(), acceptedRevision: 2 };
    cleared.document.dataPar = { Lambda: 0.9 };
    vi.mocked(invoke).mockResolvedValueOnce(cleared);
    await useDataParStore.getState().clearDataParField("Atlases");
    expect(invoke).toHaveBeenLastCalledWith(
      "accept_project_edit",
      expect.objectContaining({
        edit: expect.objectContaining({ values: { Lambda: 0.9 } }),
      }),
    );
    expect(acceptedDataPar()).toEqual({ Lambda: 0.9 });
    expect(useDataParStore.getState().drafts).toEqual({});
  });
});
