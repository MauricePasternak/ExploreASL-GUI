import { screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../test/render";

import { StructuralSection } from "./StructuralSection";
import type { DataParState } from "../../schemas/dataParSchema";

afterEach(() => cleanup());

const emptyState: DataParState = {};

describe("StructuralSection", () => {
  it("does not render AdvancedDivider", () => {
    renderWithMantine(<StructuralSection dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.queryByText(/show advanced/i)).toBeNull();
  });

  it("renders structural fields and calls onFieldChange when bRunLongReg toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(<StructuralSection dataPar={emptyState} onFieldChange={onFieldChange} />);
    expect(screen.getAllByText(/longitudinal registration/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/dartel/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/wmh segmentation/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/spm12 segmentation/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/hammers atlas/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/fix resolution/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("switch", { name: /longitudinal registration/i }));
    expect(onFieldChange).toHaveBeenCalledWith("bRunLongReg", expect.any(Number));
  });
});
