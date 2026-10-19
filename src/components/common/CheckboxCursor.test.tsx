import { describe, it, expect } from "vitest";
import { theme } from "../../app/theme";
import fs from "node:fs";
import path from "node:path";

describe("Checkbox cursor configuration", () => {
  it("configures theme with cursorType: 'pointer'", () => {
    expect(theme.cursorType).toBe("pointer");
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
