import { describe, expect, it } from "vitest";

import {
  LockFileEventSchema,
  modulesToBProcess,
  ProcessConfigSchema,
  ProcessingPhaseSchema,
  SubjectInfoSchema,
  SubjectModuleStatusSchema,
} from "./processingSchemas";

// ---------------------------------------------------------------------------
// ProcessConfigSchema
// ---------------------------------------------------------------------------
describe("ProcessConfigSchema", () => {
  const validConfig = {
    subjects: ["sub-01", "sub-02"],
    modules: ["structural", "asl"] as const,
    matlabPath: "/usr/local/MATLAB/R2023b",
    exploreAslPath: "/opt/ExploreASL",
    workers: 4,
    subjectRegexp: "^sub-.*$",
  };

  it("accepts valid config", () => {
    const result = ProcessConfigSchema.parse(validConfig);
    expect(result).toEqual(validConfig);
  });

  it("accepts all three modules", () => {
    const result = ProcessConfigSchema.parse({
      ...validConfig,
      modules: ["structural", "asl", "population"],
    });
    expect(result.modules).toEqual(["structural", "asl", "population"]);
  });

  it("rejects empty modules array", () => {
    expect(() =>
      ProcessConfigSchema.parse({ ...validConfig, modules: [] }),
    ).toThrow();
  });

  it("rejects invalid module name", () => {
    expect(() =>
      ProcessConfigSchema.parse({ ...validConfig, modules: ["invalid"] }),
    ).toThrow();
  });

  it("rejects workers < 1", () => {
    expect(() =>
      ProcessConfigSchema.parse({ ...validConfig, workers: 0 }),
    ).toThrow();
  });

  it("rejects non-integer workers", () => {
    expect(() =>
      ProcessConfigSchema.parse({ ...validConfig, workers: 1.5 }),
    ).toThrow();
  });

  it("accepts empty subjects array", () => {
    const result = ProcessConfigSchema.parse({ ...validConfig, subjects: [] });
    expect(result.subjects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SubjectModuleStatusSchema
// ---------------------------------------------------------------------------
describe("SubjectModuleStatusSchema", () => {
  const validStatus = {
    subjectSession: "sub-01/01",
    module: "asl" as const,
    status: "pending" as const,
    completedSteps: [],
    locked: false,
  };

  it("accepts valid status", () => {
    const result = SubjectModuleStatusSchema.parse(validStatus);
    expect(result).toEqual(validStatus);
  });

  it("accepts status with optional run", () => {
    const data = { ...validStatus, run: "01" };
    const result = SubjectModuleStatusSchema.parse(data);
    expect(result.run).toBe("01");
  });

  it("accepts incomplete status with completed steps", () => {
    const data = {
      ...validStatus,
      status: "incomplete" as const,
      completedSteps: ["Step1", "Step2"],
    };
    const result = SubjectModuleStatusSchema.parse(data);
    expect(result.completedSteps).toEqual(["Step1", "Step2"]);
  });

  it("accepts complete status", () => {
    const data = { ...validStatus, status: "complete" as const, locked: true };
    const result = SubjectModuleStatusSchema.parse(data);
    expect(result.status).toBe("complete");
    expect(result.locked).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(() =>
      SubjectModuleStatusSchema.parse({ ...validStatus, status: "invalid" }),
    ).toThrow();
  });

  it("rejects invalid module", () => {
    expect(() =>
      SubjectModuleStatusSchema.parse({ ...validStatus, module: "invalid" }),
    ).toThrow();
  });

  it("accepts empty subjectSession for population module", () => {
    const data = {
      subjectSession: "",
      module: "population" as const,
      status: "pending" as const,
      completedSteps: [],
      locked: false,
    };
    const result = SubjectModuleStatusSchema.parse(data);
    expect(result.subjectSession).toBe("");
  });

  it("accepts undefined subjectSession for population module (Rust sends undefined)", () => {
    const data = {
      module: "population" as const,
      status: "pending" as const,
      completedSteps: [],
      locked: false,
    };
    const result = SubjectModuleStatusSchema.parse(data);
    expect(result.subjectSession).toBe("");
  });

  it("defaults subjectSession to empty string when omitted", () => {
    const data = {
      module: "population" as const,
      status: "complete" as const,
      completedSteps: ["Population"],
      locked: false,
    };
    const result = SubjectModuleStatusSchema.parse(data);
    expect(result.subjectSession).toBe("");
  });
});

// ---------------------------------------------------------------------------
// ProcessingPhaseSchema
// ---------------------------------------------------------------------------
describe("ProcessingPhaseSchema", () => {
  it.each(["idle", "preparing", "running", "completed", "failed", "cancelled"] as const)(
    "accepts valid phase: %s",
    (phase) => {
      expect(ProcessingPhaseSchema.parse(phase)).toBe(phase);
    },
  );

  it("rejects invalid phase", () => {
    expect(() => ProcessingPhaseSchema.parse("invalid")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SubjectInfoSchema
// ---------------------------------------------------------------------------
describe("SubjectInfoSchema", () => {
  const validInfo = {
    subjectSession: "sub-01/01",
    subject: "sub-01",
    session: "01",
    hasStructural: true,
    hasASL: true,
  };

  it("accepts valid subject info and applies default for aslRuns", () => {
    const result = SubjectInfoSchema.parse(validInfo);
    expect(result).toEqual({ ...validInfo, aslRuns: [] });
  });

  it("accepts subject with custom aslRuns", () => {
    const data = { ...validInfo, aslRuns: ["1", "2"] };
    const result = SubjectInfoSchema.parse(data);
    expect(result.aslRuns).toEqual(["1", "2"]);
  });

  it("accepts subject with no structural or ASL", () => {
    const data = { ...validInfo, hasStructural: false, hasASL: false };
    const result = SubjectInfoSchema.parse(data);
    expect(result.hasStructural).toBe(false);
    expect(result.hasASL).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LockFileEventSchema
// ---------------------------------------------------------------------------
describe("LockFileEventSchema", () => {
  it("accepts StatusFileCreated event", () => {
    const data = {
      type: "StatusFileCreated" as const,
      module: "asl",
      subjectSession: "sub-01/01",
      stepCode: "Quantification",
    };
    const result = LockFileEventSchema.parse(data);
    expect(result).toEqual(data);
  });

  it("accepts StatusFileCreated event with optional run", () => {
    const data = {
      type: "StatusFileCreated" as const,
      module: "structural",
      subjectSession: "sub-01/01",
      stepCode: "Segmentation",
      run: "02",
    };
    const result = LockFileEventSchema.parse(data);
    expect(result).toMatchObject({ run: "02" });
  });

  it("accepts LockCreated event", () => {
    const data = {
      type: "LockCreated" as const,
      module: "asl",
      subjectSession: "sub-01/01",
    };
    const result = LockFileEventSchema.parse(data);
    expect(result).toEqual(data);
  });

  it("accepts LockCreated event with optional run", () => {
    const data = {
      type: "LockCreated" as const,
      module: "population",
      subjectSession: "sub-01/01",
      run: "01",
    };
    const result = LockFileEventSchema.parse(data);
    expect(result).toMatchObject({ run: "01" });
  });

  it("rejects unknown event type", () => {
    expect(() =>
      LockFileEventSchema.parse({
        type: "UnknownEvent",
        module: "asl",
        subjectSession: "sub-01/01",
      }),
    ).toThrow();
  });

  it("accepts StatusFileCreated event with undefined subjectSession (Population)", () => {
    const data = {
      type: "StatusFileCreated" as const,
      module: "xASL_module_Population",
      stepCode: "999_ready",
    };
    const result = LockFileEventSchema.parse(data);
    expect(result.subjectSession).toBeUndefined();
  });

  it("accepts LockCreated event with undefined subjectSession (Population)", () => {
    const data = {
      type: "LockCreated" as const,
      module: "xASL_module_Population",
    };
    const result = LockFileEventSchema.parse(data);
    expect(result.subjectSession).toBeUndefined();
  });

  it("rejects missing required fields", () => {
    expect(() =>
      LockFileEventSchema.parse({ type: "LockCreated" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// modulesToBProcess
// ---------------------------------------------------------------------------
describe("modulesToBProcess", () => {
  it("maps structural only", () => {
    expect(modulesToBProcess(["structural"])).toEqual([true, false, false]);
  });

  it("maps asl only", () => {
    expect(modulesToBProcess(["asl"])).toEqual([false, true, false]);
  });

  it("maps population only", () => {
    expect(modulesToBProcess(["population"])).toEqual([false, false, true]);
  });

  it("maps structural + asl", () => {
    expect(modulesToBProcess(["structural", "asl"])).toEqual([true, true, false]);
  });

  it("maps all three modules", () => {
    expect(modulesToBProcess(["structural", "asl", "population"])).toEqual([
      true, true, true,
    ]);
  });

  it("returns all false for empty array", () => {
    expect(modulesToBProcess([])).toEqual([false, false, false]);
  });

  it("ignores unknown module names", () => {
    expect(modulesToBProcess(["unknown", "asl"])).toEqual([false, true, false]);
  });

  it("handles duplicate modules", () => {
    expect(modulesToBProcess(["asl", "asl"])).toEqual([false, true, false]);
  });
});
