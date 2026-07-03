import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import DataParEditor from "../components/parameters/DataParEditor";
import { assembleDataPar } from "../lib/assembleDataPar";
import type { DataParState } from "../schemas/dataParSchema";
import { useDataParStore } from "../stores/dataParStore";
import { useProjectStore } from "../stores/projectStore";

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

function clickSwitchByLabel(container: HTMLElement, pattern: RegExp) {
  const w = within(container);
  const label = w.getAllByText(pattern)[0];
  const switchRoot = label.closest("[data-label-position]");
  if (switchRoot) {
    const body = switchRoot.querySelector(".mantine-Switch-body");
    if (body) {
      fireEvent.click(body);
      return;
    }
  }
  const group = label.closest(".mantine-Group-root");
  if (group) {
    const input = group.querySelector("input[type='checkbox']");
    if (input) {
      fireEvent.click(input);
      return;
    }
  }
  fireEvent.click(label);
}

afterEach(() => cleanup());

beforeEach(() => {
  useDataParStore.setState({
    dataPar: {},
    advancedVisibility: {
      showAdvancedSections: false,
      showAdvancedM0Params: false,
      showAdvancedQuantification: false,
      showAdvancedGeneralSettings: false,
      showAdvancedASLProcessing: false,
      showAdvancedAtlases: false,
    },
  });
  useProjectStore.setState({ project: null, isDirty: false, loaded: false });
});

// ---------------------------------------------------------------------------
// 8.1 — End-to-end parameter flow
// ---------------------------------------------------------------------------

describe("dataPar flow: store ↔ project sync", () => {
  it("setDataParField → saveToProject → project has the value", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "p1",
          name: "Test",
          rootPath: "/tmp",
          createdAt: "",
          lastOpened: "",
          currentPhase: "parameters",
        },
        uiState: {
          datapar: {
            advancedVisibility: {
              showAdvancedSections: false,
              showAdvancedM0Params: false,
              showAdvancedQuantification: false,
              showAdvancedGeneralSettings: false,
              showAdvancedASLProcessing: false,
              showAdvancedAtlases: false,
            },
          },
        },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    useDataParStore.getState().setDataParField("bTopUp", true);
    useDataParStore.getState().setDataParField("Quality", 1);
    useDataParStore.getState().saveToProject();

    const project = useProjectStore.getState().project!;
    expect(project.dataPar).toMatchObject({
      bTopUp: true,
      Quality: 1,
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("multiple fields round-trip through saveToProject", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "p2",
          name: "Test2",
          rootPath: "/tmp",
          createdAt: "",
          lastOpened: "",
          currentPhase: "parameters",
        },
        uiState: {
          datapar: {
            advancedVisibility: {
              showAdvancedSections: false,
              showAdvancedM0Params: false,
              showAdvancedQuantification: false,
              showAdvancedGeneralSettings: false,
              showAdvancedASLProcessing: false,
              showAdvancedAtlases: false,
            },
          },
        },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    const fields: Partial<DataParState> = {
      M0: "UseControlAsM0",
      bTopUp: true,
      Lambda: 0.9,
      Quality: 1,
      Atlases: ["MNI_Structural"],
    };

    const store = useDataParStore.getState();
    for (const [k, v] of Object.entries(fields)) {
      store.setDataParField(k as keyof DataParState, v);
    }
    store.saveToProject();

    const saved = useProjectStore.getState().project!.dataPar;
    expect(saved).toMatchObject(fields);
  });

  it("showAdvancedSections syncs to project uiState.dataParametersAdvancedVisibility", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "p3",
          name: "Test3",
          rootPath: "/tmp",
          createdAt: "",
          lastOpened: "",
          currentPhase: "parameters",
        },
        uiState: {
          datapar: {
            advancedVisibility: {
              showAdvancedSections: false,
              showAdvancedM0Params: false,
              showAdvancedQuantification: false,
              showAdvancedGeneralSettings: false,
              showAdvancedASLProcessing: false,
              showAdvancedAtlases: false,
            },
          },
        },
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    useDataParStore.getState().setAdvancedVisibility({ showAdvancedSections: true });
    useDataParStore.getState().saveToProject();

    expect(
      useProjectStore.getState().project!.uiState.datapar!.advancedVisibility!.showAdvancedSections,
    ).toBe(true);
  });
});

describe("dataPar flow: advanced toggle shows/hides sections", () => {
  it("Structural and Environment hidden by default", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    expect(w.queryByText("Structural")).toBeNull();
    expect(w.queryByText("Environment")).toBeNull();
  });

  it("Structural and Environment visible after toggle", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    clickSwitchByLabel(container, /Show advanced parameter sections/i);
    const w = within(container);
    expect(w.getAllByText("Structural").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("Environment").length).toBeGreaterThanOrEqual(1);
  });

  it("Structural and Environment hidden after toggle off", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    clickSwitchByLabel(container, /Show advanced parameter sections/i);
    clickSwitchByLabel(container, /Show advanced parameter sections/i);
    const w = within(container);
    expect(w.queryByText("Structural")).toBeNull();
    expect(w.queryByText("Environment")).toBeNull();
  });

  it("showAdvancedSections state updates in store on toggle", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    expect(useDataParStore.getState().advancedVisibility.showAdvancedSections).toBe(false);
    clickSwitchByLabel(container, /Show advanced parameter sections/i);
    expect(useDataParStore.getState().advancedVisibility.showAdvancedSections).toBe(true);
  });
});

describe("dataPar flow: M0 conditional logic", () => {
  it("BackgroundSuppressionPulseTime hidden when M0 is not UseControlAsM0", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    // Default M0 is not set — pulse time should be hidden
    expect(w.queryAllByText(/background suppression pulse time/i).length).toBe(0);
  });

  it("BackgroundSuppressionPulseTime appears when UseControlAsM0 selected and pulses > 0", () => {
    useDataParStore.getState().setDataParField("M0", "UseControlAsM0");
    useDataParStore.getState().setDataParField("BackgroundSuppressionNumberPulses", 4);
    const { container } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    expect(w.getAllByText(/background suppression pulse time/i).length).toBeGreaterThanOrEqual(1);
  });

  it("BackgroundSuppressionPulseTime hidden when pulses = 0 even with UseControlAsM0", () => {
    useDataParStore.getState().setDataParField("M0", "UseControlAsM0");
    useDataParStore.getState().setDataParField("BackgroundSuppressionNumberPulses", 0);
    const { container } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    expect(w.queryAllByText(/background suppression pulse time/i).length).toBe(0);
  });
});

describe("dataPar flow: PVC conditional logic", () => {
  it("PVC toggle renders in ASL Processing section", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    expect(w.getAllByText(/partial volume correction/i).length).toBeGreaterThanOrEqual(1);
  });

  it("bPVCNativeSpace field is set in store via toggle", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    clickSwitchByLabel(container, /partial volume correction/i);
    expect(useDataParStore.getState().dataPar.bPVCNativeSpace).toBeDefined();
  });
});

describe("dataPar flow: assembly from filled state", () => {
  it("assembles correct nested JSON after setting fields in store", () => {
    useDataParStore.getState().setDataParField("M0", "separate_scan");
    useDataParStore.getState().setDataParField("Lambda", 0.9);
    useDataParStore.getState().setDataParField("bTopUp", true);
    useDataParStore.getState().setDataParField("Quality", 1);
    useDataParStore.getState().setDataParField("Atlases", ["MNI_Structural"]);
    useDataParStore.getState().setDataParField("bRunLongReg", true);
    useDataParStore.getState().setDataParField("bAutomaticallyDetectFSL", true);

    const result = assembleDataPar(useDataParStore.getState().dataPar);

    expect(result.x.Q?.M0).toBe("separate_scan");
    expect(result.x.Q?.Lambda).toBe(0.9);
    expect(result.x.modules?.asl?.bTopUp).toBe(true);
    expect(result.x.settings?.Quality).toBe(1);
    expect(result.x.S?.Atlases).toEqual(["MNI_Structural"]);
    expect(result.x.modules?.structural?.bRunLongReg).toBe(true);
    expect(result.x.bAutomaticallyDetectFSL).toBe(true);
  });

  it("assembles empty sections when only some fields set", () => {
    useDataParStore.getState().setDataParField("Quality", 1);
    const result = assembleDataPar(useDataParStore.getState().dataPar);

    expect(result.x.Q).toBeUndefined();
    expect(result.x.modules).toBeUndefined();
    expect(result.x.S).toBeUndefined();
    expect(result.x.external).toBeUndefined();
    expect(result.x.settings).toEqual({ Quality: 1 });
  });
});

describe("dataPar flow: loadDataPar → assemble round-trip", () => {
  it("loading state then assembling produces same JSON", () => {
    const state: DataParState = {
      M0: "UseControlAsM0",
      bTopUp: true,
      Quality: 1,
      Lambda: 0.9,
      Atlases: ["TotalGM"],
      bAutomaticallyDetectFSL: false,
    };

    useDataParStore.getState().loadDataPar(state);
    const assembled = assembleDataPar(useDataParStore.getState().dataPar);

    expect(assembled.x.Q?.M0).toBe("UseControlAsM0");
    expect(assembled.x.modules?.asl?.bTopUp).toBe(true);
    expect(assembled.x.settings?.Quality).toBe(1);
    expect(assembled.x.Q?.Lambda).toBe(0.9);
    expect(assembled.x.S?.Atlases).toEqual(["TotalGM"]);
    expect(assembled.x.bAutomaticallyDetectFSL).toBe(false);
  });
});
