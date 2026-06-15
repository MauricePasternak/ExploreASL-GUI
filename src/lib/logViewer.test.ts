import { describe, expect, it } from "vitest";
import { LogFileInfoSchema, LogContentSchema } from "./logViewer";

describe("LogFileInfoSchema", () => {
  it("parses a structural log entry", () => {
    const input = {
      filename: "xASL_module_Structural_sub-001_01.log",
      module: "structural",
      subjectSession: "sub-001_01",
      run: null,
      hasError: false,
    };
    const result = LogFileInfoSchema.parse(input);
    expect(result.module).toBe("structural");
    expect(result.run).toBeUndefined();
  });

  it("parses an ASL log entry with run", () => {
    const input = {
      filename: "xASL_module_ASL_sub-001_01_ASL_1.log",
      module: "asl",
      subjectSession: "sub-001_01",
      run: "1",
      hasError: true,
    };
    const result = LogFileInfoSchema.parse(input);
    expect(result.module).toBe("asl");
    expect(result.run).toBe("1");
    expect(result.hasError).toBe(true);
  });

  it("rejects invalid module", () => {
    const input = {
      filename: "xASL_module_Population.log",
      module: "population",
      subjectSession: "",
      run: null,
      hasError: false,
    };
    expect(() => LogFileInfoSchema.parse(input)).toThrow();
  });
});

describe("LogContentSchema", () => {
  it("parses log content map", () => {
    const input = {
      "xASL_module_Structural_sub-001_01.log": "Some log content",
    };
    const result = LogContentSchema.parse(input);
    expect(result["xASL_module_Structural_sub-001_01.log"]).toBe("Some log content");
  });
});