import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { Checkbox } from "@mantine/core";
import { theme } from "../../app/theme";
import { renderWithMantine } from "../../test/render";
import fs from "node:fs";
import path from "node:path";

describe("Checkbox cursor configuration", () => {
  afterEach(() => {
    cleanup();
  });

  it("configures theme with cursorType: 'pointer'", () => {
    expect(theme.cursorType).toBe("pointer");
  });

  it("renders checkbox with input under MantineProvider", () => {
    renderWithMantine(<Checkbox label="Test Checkbox" data-testid="test-checkbox" />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toHaveClass("mantine-Checkbox-input");
  });

  it("ensures App.css does not apply text cursor to checkboxes and sets pointer cursor", () => {
    const cssPath = path.resolve(__dirname, "../../App.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // Ensure text cursor rules explicitly exclude checkboxes
    expect(cssContent).toMatch(/:not\(\s*\[type="checkbox"\]/);

    // Ensure pointer cursor is set for checkboxes
    expect(cssContent).toContain(".mantine-Checkbox-input");
    expect(cssContent).toContain("cursor: pointer");
  });
});
