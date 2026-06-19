import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DataParEditor from "./DataParEditor";

import { useDataParStore } from "../../stores/dataParStore";
import { useProjectStore } from "../../stores/projectStore";

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
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
  useProjectStore.setState({ project: null });
});

describe("DataParEditor", () => {
  it("renders the editor with title", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    expect(within(container).getByText("ExploreASL Processing Parameters")).toBeTruthy();
  });

  it("renders basic accordion sections", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    expect(w.getAllByText("M0 Configuration").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("Quantification").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("General Settings").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("ASL Processing").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("Atlases").length).toBeGreaterThanOrEqual(1);
  });

  it("does not show Structural section by default", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    expect(within(container).queryByText("Structural")).toBeNull();
  });

  it("does not show Environment section by default", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    expect(within(container).queryByText("Environment")).toBeNull();
  });

  it("shows Structural and Environment when advanced toggle is on", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    const w = within(container);
    const label = w.getAllByText("Show advanced parameters")[0];
    const switchBody = label
      .closest("[data-label-position]")
      ?.querySelector(".mantine-Switch-body");
    fireEvent.click(switchBody!);
    expect(w.getAllByText("Structural").length).toBeGreaterThanOrEqual(1);
    expect(w.getAllByText("Environment").length).toBeGreaterThanOrEqual(1);
  });

  it("renders advanced toggle switch", () => {
    const { container } = renderWithMantine(<DataParEditor />);
    expect(
      within(container).getAllByText("Show advanced parameters").length,
    ).toBeGreaterThanOrEqual(1);
  });
});
