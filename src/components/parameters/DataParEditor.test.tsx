import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { projectFixture } from "../../test/projectFixtures";
import { activateProjectLease, resetProjectLifecycleForTests } from "../../lib/projectLifecycle";
import DataParEditor from "./DataParEditor";
import { renderWithMantine } from "../../test/render";

import { useDataParStore } from "../../stores/dataParStore";
import { useProjectStore } from "../../stores/projectStore";

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

describe("DataParEditor", () => {
  it("renders the title, basic sections, and advanced toggle without advanced sections", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    expect(w.getByText("ExploreASL Processing Parameters")).toBeTruthy();
    expect(w.getAllByText("M0 Configuration").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("Quantification").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("General Settings").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("ASL Processing").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("Atlases").length).toBeGreaterThanOrEqual(1);
    expect(w.queryByText("Structural")).toBeNull();
    expect(w.queryByText("Environment")).toBeNull();
    expect(w.getAllByText("Show advanced parameter sections").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Structural and Environment when advanced toggle is on", async () => {
    const accepted = { ...projectFixture(), acceptedRevision: 1 };
    accepted.document.uiState.datapar = {
      advancedVisibility: {
        showAdvancedSections: true,
        showAdvancedM0Params: false,
        showAdvancedQuantification: false,
        showAdvancedGeneralSettings: false,
        showAdvancedASLProcessing: false,
        showAdvancedAtlases: false,
      },
    };
    vi.mocked(invoke).mockResolvedValueOnce(accepted);
    const { container } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    const label = w.getAllByText("Show advanced parameter sections")[0];
    const switchBody = label
      .closest("[data-label-position]")
      ?.querySelector(".mantine-Switch-body");
    fireEvent.click(switchBody!);
    await vi.waitFor(() => expect(w.queryAllByText("Structural").length).toBeGreaterThan(0));
    expect(w.getAllByText("Structural").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("Environment").length).toBeGreaterThanOrEqual(1);
    vi.mocked(invoke).mockResolvedValueOnce({ ...projectFixture(), acceptedRevision: 2 });
    fireEvent.click(switchBody!);
    await vi.waitFor(() => expect(w.queryByText("Structural")).toBeNull());
    expect(w.queryByText("Environment")).toBeNull();
  });
});
