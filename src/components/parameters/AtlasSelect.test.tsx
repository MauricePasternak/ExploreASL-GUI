import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AtlasSelect } from "./AtlasSelect";

vi.mock("@mantine/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mantine/core")>();
  return {
    ...original,
    MultiSelect: vi.fn(({ value, onChange, placeholder }) => (
      <input
        data-testid="mock-multiselect"
        value={value.join(",")}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val ? val.split(",") : []);
        }}
        placeholder={placeholder}
      />
    )),
  };
});

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

    expect(screen.getByTestId("mock-multiselect")).toBeInTheDocument();
  });

  it("shows paired rows for selected atlases", () => {
    renderWithMantine(
      <AtlasSelect
        atlases={["Total"]}
        tissueMasking={["GM"]}
        tissueThreshold={[0.7]}
        onAtlasesChange={() => {}}
        onTissueMaskingChange={() => {}}
        onTissueThresholdChange={() => {}}
      />,
    );

    expect(screen.getAllByText(/whole brain grey and white/i).length).toBeGreaterThan(0);
  });

  it("adds default masking and threshold when atlas is added", () => {
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

    const select = screen.getByTestId("mock-multiselect");

    // Add AAL3v1
    fireEvent.change(select, { target: { value: "AAL3v1" } });

    expect(onAtlasesChange).toHaveBeenCalledWith(["AAL3v1"]);
    expect(onTissueMaskingChange).toHaveBeenCalledWith(["GM"]); // Default to GM for other atlases
    expect(onTissueThresholdChange).toHaveBeenCalledWith([0.7]); // Default threshold to 0.7
  });

  it("adds WM masking default when DeepWM is added", () => {
    const onAtlasesChange = vi.fn();
    const onTissueMaskingChange = vi.fn();
    const onTissueThresholdChange = vi.fn();

    renderWithMantine(
      <AtlasSelect
        atlases={["Total"]}
        tissueMasking={["GM"]}
        tissueThreshold={[0.7]}
        onAtlasesChange={onAtlasesChange}
        onTissueMaskingChange={onTissueMaskingChange}
        onTissueThresholdChange={onTissueThresholdChange}
      />,
    );

    const select = screen.getByTestId("mock-multiselect");

    // Add DeepWM alongside Total
    fireEvent.change(select, { target: { value: "Total,DeepWM" } });

    expect(onAtlasesChange).toHaveBeenCalledWith(["Total", "DeepWM"]);
    expect(onTissueMaskingChange).toHaveBeenCalledWith(["GM", "WM"]); // DeepWM gets WM
    expect(onTissueThresholdChange).toHaveBeenCalledWith([0.7, 0.7]);
  });

  it("removes corresponding entries when atlas is removed", () => {
    const onAtlasesChange = vi.fn();
    const onTissueMaskingChange = vi.fn();
    const onTissueThresholdChange = vi.fn();

    renderWithMantine(
      <AtlasSelect
        atlases={["Total", "DeepWM"]}
        tissueMasking={["GM", "WM"]}
        tissueThreshold={[0.7, 0.7]}
        onAtlasesChange={onAtlasesChange}
        onTissueMaskingChange={onTissueMaskingChange}
        onTissueThresholdChange={onTissueThresholdChange}
      />,
    );

    const select = screen.getByTestId("mock-multiselect");

    // Remove DeepWM
    fireEvent.change(select, { target: { value: "Total" } });

    expect(onAtlasesChange).toHaveBeenCalledWith(["Total"]);
    expect(onTissueMaskingChange).toHaveBeenCalledWith(["GM"]);
    expect(onTissueThresholdChange).toHaveBeenCalledWith([0.7]);
  });
});
