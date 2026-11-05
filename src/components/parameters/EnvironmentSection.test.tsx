import { screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../../test/render";

import { EnvironmentSection } from "./EnvironmentSection";
import type { DataParState } from "../../schemas/dataParSchema";

afterEach(() => cleanup());

const emptyState: DataParState = {};

describe("EnvironmentSection", () => {
  it("does not render AdvancedDivider", () => {
    renderWithMantine(<EnvironmentSection dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.queryByText(/show advanced/i)).toBeNull();
  });

  it("renders auto-detection fields and treats undefined bAutomaticallyDetectFSL as true", () => {
    renderWithMantine(<EnvironmentSection dataPar={emptyState} onFieldChange={() => {}} />);
    expect(screen.getAllByText(/auto-detect fsl/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/auto-detect vaby/i).length).toBeGreaterThan(0);
    const fslInput = document.querySelector('input[role="switch"]');
    expect(fslInput?.getAttribute("data-checked")).toBe("true");
  });

  it("calls onFieldChange when bAutomaticallyDetectFSL toggled", () => {
    const onFieldChange = vi.fn();
    renderWithMantine(<EnvironmentSection dataPar={emptyState} onFieldChange={onFieldChange} />);
    fireEvent.click(screen.getByRole("switch", { name: /auto-detect fsl/i }));
    expect(onFieldChange).toHaveBeenCalledWith("bAutomaticallyDetectFSL", expect.any(Boolean));
  });
});
