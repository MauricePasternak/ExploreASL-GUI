import { beforeEach, describe, expect, it } from "vitest";

import { useProjectStore } from "./projectStore";
import { useDataParStore } from "./dataParStore";

beforeEach(() => {
  useProjectStore.setState({ project: null, isDirty: false, loaded: false });
  useDataParStore.getState().resetDataPar();
});

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------
describe("dataParStore initial state", () => {
  it("starts with empty dataPar", () => {
    expect(useDataParStore.getState().dataPar).toEqual({});
  });

  it("starts with showAdvanced false", () => {
    expect(useDataParStore.getState().showAdvanced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setDataParField
// ---------------------------------------------------------------------------
describe("dataParStore setDataParField", () => {
  it("sets a boolean field", () => {
    useDataParStore.getState().setDataParField("bTopUp", true);
    expect(useDataParStore.getState().dataPar.bTopUp).toBe(true);
  });

  it("sets a number field", () => {
    useDataParStore.getState().setDataParField("Quality", 1);
    expect(useDataParStore.getState().dataPar.Quality).toBe(1);
  });

  it("sets a string enum field", () => {
    useDataParStore.getState().setDataParField("M0", "UseControlAsM0");
    expect(useDataParStore.getState().dataPar.M0).toBe("UseControlAsM0");
  });

  it("sets a numeric M0 value", () => {
    useDataParStore.getState().setDataParField("M0", 0.5);
    expect(useDataParStore.getState().dataPar.M0).toBe(0.5);
  });

  it("overwrites an existing field", () => {
    useDataParStore.getState().setDataParField("bTopUp", true);
    useDataParStore.getState().setDataParField("bTopUp", false);
    expect(useDataParStore.getState().dataPar.bTopUp).toBe(false);
  });

  it("preserves other fields when setting one", () => {
    useDataParStore.getState().setDataParField("bTopUp", true);
    useDataParStore.getState().setDataParField("Quality", 1);
    const dp = useDataParStore.getState().dataPar;
    expect(dp.bTopUp).toBe(true);
    expect(dp.Quality).toBe(1);
  });

  it("sets an array field", () => {
    useDataParStore.getState().setDataParField("Atlases", ["TotalGM", "DeepWM"]);
    expect(useDataParStore.getState().dataPar.Atlases).toEqual(["TotalGM", "DeepWM"]);
  });

  it("sets a tuple field", () => {
    useDataParStore.getState().setDataParField("PVCNativeSpaceKernel", [5, 5, 5]);
    expect(useDataParStore.getState().dataPar.PVCNativeSpaceKernel).toEqual([5, 5, 5]);
  });
});

// ---------------------------------------------------------------------------
// clearDataParField
// ---------------------------------------------------------------------------
describe("dataParStore clearDataParField", () => {
  it("sets a field to undefined", () => {
    useDataParStore.getState().setDataParField("bTopUp", true);
    useDataParStore.getState().clearDataParField("bTopUp");
    expect(useDataParStore.getState().dataPar.bTopUp).toBeUndefined();
  });

  it("does not affect other fields", () => {
    useDataParStore.getState().setDataParField("bTopUp", true);
    useDataParStore.getState().setDataParField("Quality", 1);
    useDataParStore.getState().clearDataParField("bTopUp");
    expect(useDataParStore.getState().dataPar.Quality).toBe(1);
  });

  it("clearing an already-undefined field is a no-op", () => {
    useDataParStore.getState().clearDataParField("bTopUp");
    expect(useDataParStore.getState().dataPar.bTopUp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setShowAdvanced
// ---------------------------------------------------------------------------
describe("dataParStore setShowAdvanced", () => {
  it("sets showAdvanced to true", () => {
    useDataParStore.getState().setShowAdvanced(true);
    expect(useDataParStore.getState().showAdvanced).toBe(true);
  });

  it("sets showAdvanced to false", () => {
    useDataParStore.getState().setShowAdvanced(true);
    useDataParStore.getState().setShowAdvanced(false);
    expect(useDataParStore.getState().showAdvanced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadDataPar
// ---------------------------------------------------------------------------
describe("dataParStore loadDataPar", () => {
  it("replaces dataPar state", () => {
    useDataParStore.getState().setDataParField("bTopUp", true);
    useDataParStore.getState().loadDataPar({ Quality: 2, Lambda: 0.9 });
    const dp = useDataParStore.getState().dataPar;
    expect(dp.bTopUp).toBeUndefined();
    expect(dp.Quality).toBe(2);
    expect(dp.Lambda).toBe(0.9);
  });

  it("loads empty object clearing all fields", () => {
    useDataParStore.getState().setDataParField("bTopUp", true);
    useDataParStore.getState().loadDataPar({});
    expect(useDataParStore.getState().dataPar).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// resetDataPar
// ---------------------------------------------------------------------------
describe("dataParStore resetDataPar", () => {
  it("clears dataPar to empty object", () => {
    useDataParStore.getState().setDataParField("bTopUp", true);
    useDataParStore.getState().setDataParField("Quality", 1);
    useDataParStore.getState().resetDataPar();
    expect(useDataParStore.getState().dataPar).toEqual({});
  });

  it("resets showAdvanced to false", () => {
    useDataParStore.getState().setShowAdvanced(true);
    useDataParStore.getState().resetDataPar();
    expect(useDataParStore.getState().showAdvanced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// saveToProject
// ---------------------------------------------------------------------------
describe("dataParStore saveToProject", () => {
  it("syncs dataPar into project exploreAslConfig.dataPar", async () => {
    await useProjectStore.getState().createProject("/tmp/test", "Test");
    useDataParStore.getState().setDataParField("bTopUp", true);
    useDataParStore.getState().setDataParField("Quality", 1);

    useDataParStore.getState().saveToProject();

    const project = useProjectStore.getState().project;
    expect(project?.exploreAslConfig.dataPar).toMatchObject({
      bTopUp: true,
      Quality: 1,
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("syncs showAdvanced into project uiState.showAdvancedParameters", async () => {
    await useProjectStore.getState().createProject("/tmp/test2", "Test2");
    useDataParStore.getState().setShowAdvanced(true);

    useDataParStore.getState().saveToProject();

    const project = useProjectStore.getState().project;
    expect(project?.uiState).toMatchObject({
      showAdvancedParameters: true,
    });
  });

  it("is a no-op when no project is loaded", () => {
    useDataParStore.getState().setDataParField("bTopUp", true);
    // Should not throw
    useDataParStore.getState().saveToProject();
    expect(useProjectStore.getState().project).toBeNull();
  });

  it("merges with existing exploreAslConfig fields", async () => {
    await useProjectStore.getState().createProject("/tmp/test3", "Test3");
    useDataParStore.getState().setDataParField("bTopUp", true);

    useDataParStore.getState().saveToProject();

    const project = useProjectStore.getState().project;
    expect(project?.exploreAslConfig.sourcestructure).toBeDefined();
    expect(project?.exploreAslConfig.studyPar).toBeDefined();
    expect(project?.exploreAslConfig.dataPar).toMatchObject({ bTopUp: true });
  });
});
