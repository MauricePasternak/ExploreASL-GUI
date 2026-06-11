import { describe, expect, it } from "vitest";

import { mapModuleName } from "./processingEvents";

describe("mapModuleName", () => {
  it("maps xASL_module_Structural to structural", () => {
    expect(mapModuleName("xASL_module_Structural")).toBe("structural");
  });

  it("maps xASL_module_ASL to asl", () => {
    expect(mapModuleName("xASL_module_ASL")).toBe("asl");
  });

  it("maps xASL_module_Population to population", () => {
    expect(mapModuleName("xASL_module_Population")).toBe("population");
  });

  it("returns structural for lowercase structural", () => {
    expect(mapModuleName("structural")).toBe("structural");
  });

  it("returns asl for lowercase asl", () => {
    expect(mapModuleName("asl")).toBe("asl");
  });

  it("returns population for lowercase population", () => {
    expect(mapModuleName("population")).toBe("population");
  });

  it("returns undefined for unknown module name", () => {
    expect(mapModuleName("unknown_module")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(mapModuleName("")).toBeUndefined();
  });
});