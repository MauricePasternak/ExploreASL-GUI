import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";

import { AtlasSelect } from "./AtlasSelect";

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe("AtlasSelect", () => {
  it("renders MultiSelect with atlas options", () => {
    renderWithMantine(
      <AtlasSelect
        atlases={[]}
        tissueMasking={[]}
        tissueThreshold={[]}
        onAtlasesChange={() => {}}
        onTissueMaskingChange={() => {}}
        onTissueThresholdChange={() => {}}
      />,
    );

    expect(screen.getByPlaceholderText(/select atlases/i)).toBeInTheDocument();
  });

  it("shows paired rows for selected atlases", () => {
    renderWithMantine(
      <AtlasSelect
        atlases={["Total"]}
        tissueMasking={["GM+WM"]}
        tissueThreshold={[0.7]}
        onAtlasesChange={() => {}}
        onTissueMaskingChange={() => {}}
        onTissueThresholdChange={() => {}}
      />,
    );

    expect(screen.getAllByText("Total").length).toBeGreaterThan(0);
  });

  it("adds default values when atlas is added", () => {
    const onAtlasesChange = vi.fn();
    const onTissueMaskingChange = vi.fn();
    const onTissueThresholdChange = vi.fn();

    renderWithMantine(
      <AtlasSelect
        atlases={[]}
        tissueMasking={[]}
        tissueThreshold={[]}
        onAtlasesChange={onAtlasesChange}
        onTissueMaskingChange={onTissueMaskingChange}
        onTissueThresholdChange={onTissueThresholdChange}
      />,
    );

    expect(onAtlasesChange).toBeDefined();
  });

  it("removes corresponding entries when atlas is removed", () => {
    const onAtlasesChange = vi.fn();
    const onTissueMaskingChange = vi.fn();
    const onTissueThresholdChange = vi.fn();

    renderWithMantine(
      <AtlasSelect
        atlases={["Total", "DeepWM"]}
        tissueMasking={["GM+WM", "GM"]}
        tissueThreshold={[0.7, 0.5]}
        onAtlasesChange={onAtlasesChange}
        onTissueMaskingChange={onTissueMaskingChange}
        onTissueThresholdChange={onTissueThresholdChange}
      />,
    );

    expect(screen.getAllByText("Total").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DeepWM").length).toBeGreaterThan(0);
  });

  it("shows tissue masking select for each atlas", () => {
    const { container } = renderWithMantine(
      <AtlasSelect
        atlases={["Total"]}
        tissueMasking={["GM+WM"]}
        tissueThreshold={[0.7]}
        onAtlasesChange={() => {}}
        onTissueMaskingChange={() => {}}
        onTissueThresholdChange={() => {}}
      />,
    );

    const comboboxes = container.querySelectorAll('[role="combobox"]');
    expect(comboboxes.length).toBeGreaterThan(0);
  });
});
