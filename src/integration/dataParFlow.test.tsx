import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { projectFixture } from "../test/projectFixtures";
import { PARAMETER_SWITCH_DEFAULTS } from "../generated/bindings";
import { renderWithMantine } from "../test/render";

import DataParEditor from "../components/parameters/DataParEditor";
import { assembleDataPar } from "../lib/assembleDataPar";
import type { DataParState } from "../schemas/dataParSchema";
import {
  acceptedDataPar,
  DEFAULT_ADVANCED_VISIBILITY,
  useDataParStore,
} from "../stores/dataParStore";
import { useProjectStore } from "../stores/projectStore";

afterEach(() => {
  cleanup();
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
});

beforeEach(() => {
  useDataParStore.getState().resetDataPar();
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useProjectStore.getState().acceptSnapshot(projectFixture());
  activateProjectLease("project-1", "/project");
  vi.mocked(invoke).mockReset();
});

// ---------------------------------------------------------------------------
// 8.1 — End-to-end parameter flow
// ---------------------------------------------------------------------------

describe("native accepted parameter flow", () => {
  it("submits Quality zero before immediate phase navigation and preserves scientific output", async () => {
    const fields: DataParState = {
      M0: "UseControlAsM0",
      bTopUp: true,
      Lambda: 0.9,
      Atlases: ["MNI_Structural"],
      WMHsegmAlg: "LGA",
      bRunLongReg: 1,
      nCompartments: 2,
      bRegisterM02ASL: 0,
      ExternalQuantificationSmoothGaussianMM: [5.5, 5, 1.5],
      bAutomaticallyDetectFSL: false,
      SpikeRemovalAbsoluteThreshold: 0,
    };
    const before = projectFixture();
    before.document.dataPar = fields;
    useProjectStore.getState().acceptSnapshot(before);
    const pvc = { ...projectFixture(), acceptedRevision: 1 };
    pvc.document.dataPar = { ...PARAMETER_SWITCH_DEFAULTS, ...fields };
    const accepted = { ...projectFixture(), acceptedRevision: 2 };
    accepted.document.dataPar = { ...pvc.document.dataPar, Quality: 0 };
    const navigated = {
      ...accepted,
      acceptedRevision: 3,
      document: {
        ...accepted.document,
        projectMeta: { ...accepted.document.projectMeta, currentPhase: "processing" as const },
      },
    };
    vi.mocked(invoke)
      .mockResolvedValueOnce(pvc)
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce(navigated)
      .mockResolvedValueOnce({ ...navigated, persistedRevision: 3 });
    const { container, unmount } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    fireEvent.click(w.getByRole("button", { name: "ASL Processing" }));
    expect(w.getByTestId("field-bPVCNativeSpace")).not.toBeChecked();
    expect(acceptedDataPar().bPVCNativeSpace).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(w.getByTestId("datapar-confirm-switches"));
    await vi.waitFor(() => expect(acceptedDataPar().bPVCNativeSpace).toBe(0));
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      "accept_project_edit",
      expect.objectContaining({
        edit: expect.objectContaining({
          kind: "parameters",
          values: { ...PARAMETER_SWITCH_DEFAULTS, ...fields },
        }),
      }),
    );
    expect(w.queryByTestId("datapar-switch-confirmation")).not.toBeInTheDocument();
    fireEvent.click(w.getByRole("button", { name: "General Settings" }));
    fireEvent.click(w.getByTestId("field-Quality"));
    fireEvent.click(w.getByRole("option", { name: "Low quality (fast try-out)" }));
    const navigation = useProjectStore
      .getState()
      .setPhase("processing")
      .then(() => useProjectStore.getState().saveProject());
    unmount();
    await navigation;
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "accept_project_edit",
      "accept_project_edit",
      "accept_project_edit",
      "save_project",
    ]);
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "accept_project_edit",
      expect.objectContaining({
        edit: expect.objectContaining({
          kind: "parameters",
          values: { ...PARAMETER_SWITCH_DEFAULTS, ...fields, Quality: 0 },
        }),
      }),
    );
    expect(useProjectStore.getState().isDirty).toBe(false);
    expect(acceptedDataPar()).toEqual({ ...PARAMETER_SWITCH_DEFAULTS, ...fields, Quality: 0 });
    expect(assembleDataPar(acceptedDataPar()).x).toMatchObject({
      WMHsegmAlg: "LGA",
      modules: {
        bRunLongReg: 1,
        asl: {
          bRegisterM02ASL: 0,
          bTopUp: true,
          ExternalQuantificationSmoothGaussianMM: [5.5, 5, 1.5],
          SpikeRemovalAbsoluteThreshold: 0,
        },
      },
      Q: { M0: "UseControlAsM0", Lambda: 0.9, nCompartments: 2 },
      S: { Atlases: ["MNI_Structural"] },
      settings: { Quality: 0 },
      external: { bAutomaticallyDetectFSL: false },
    });
    expect(
      assembleDataPar(acceptedDataPar()).x.modules?.asl?.SpikeRemovalThreshold,
    ).toBeUndefined();
  });

  it("keeps rejected unfinished input visible and blocks Save until corrected", async () => {
    const before = projectFixture();
    before.document.uiState.datapar = {
      advancedVisibility: { ...DEFAULT_ADVANCED_VISIBILITY, showAdvancedQuantification: true },
    };
    useProjectStore.getState().acceptSnapshot(before);
    // Tauri rejects malformed typed arguments before the native command runs.
    vi.mocked(invoke).mockRejectedValueOnce(
      'invalid args `edit` for command `accept_project_edit`: invalid type: string "-", expected f64',
    );
    const editError =
      "Your project changes could not be applied. They have not been saved. Try the action again. If the problem continues, report it with the application log.";
    const { container } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    fireEvent.click(w.getByRole("button", { name: "Quantification" }));
    fireEvent.change(w.getByTestId("field-Lambda"), { target: { value: "-" } });
    await vi.waitFor(() =>
      expect(w.getByTestId("datapar-draft-error")).toHaveTextContent(editError),
    );
    expect(useDataParStore.getState().drafts).toEqual({ Lambda: "-" });
    expect(w.getByTestId("datapar-draft-error")).toHaveTextContent(editError);
    expect(acceptedDataPar()).toEqual({});
    expect(w.getByTestId("field-Lambda")).toHaveValue("-");
    await expect(useProjectStore.getState().saveProject()).rejects.toThrow(editError);
    expect(invoke).toHaveBeenCalledTimes(1);
    const corrected = { ...projectFixture(), acceptedRevision: 1 };
    corrected.document.dataPar = { Lambda: 0.9 };
    corrected.document.uiState.datapar = before.document.uiState.datapar;
    vi.mocked(invoke)
      .mockResolvedValueOnce(corrected)
      .mockResolvedValueOnce({ ...corrected, persistedRevision: 1 });
    fireEvent.change(w.getByTestId("field-Lambda"), { target: { value: "0.9" } });
    await useProjectStore.getState().saveProject();
    expect(invoke).toHaveBeenLastCalledWith("save_project", {
      generation: before.activationGeneration,
    });
    expect(acceptedDataPar()).toEqual({ Lambda: 0.9 });
    expect(useProjectStore.getState().isDirty).toBe(false);
    expect(useDataParStore.getState().drafts).toEqual({});
    expect(w.queryByTestId("datapar-draft-error")).toBeNull();
    expect(w.getByTestId("field-Lambda")).toHaveValue("0.9");
  });
});
