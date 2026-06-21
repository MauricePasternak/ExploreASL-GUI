import { describe, it, expect } from "vitest";
import { buildNivoTheme } from "./nivoTheme";

describe("buildNivoTheme", () => {
  it("produces different axis text colors for light and dark", () => {
    const light = buildNivoTheme("light");
    const dark = buildNivoTheme("dark");
    expect(light.axis?.ticks?.text?.fill).not.toBe(dark.axis?.ticks?.text?.fill);
  });

  it("produces different grid colors for light and dark", () => {
    const light = buildNivoTheme("light");
    const dark = buildNivoTheme("dark");
    expect(light.grid?.line?.stroke).not.toBe(dark.grid?.line?.stroke);
  });
});
