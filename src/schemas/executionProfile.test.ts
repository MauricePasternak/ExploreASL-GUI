import { describe, expect, it } from "vitest";

import { ExecutionProfileSchema, MatlabProfileSchema } from "./executionProfile";

const validMatlabProfile = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  label: "MATLAB R2024b",
  type: "matlab" as const,
  matlabPath: "/usr/local/MATLAB/R2024b/bin/matlab",
  exploreAslPath: "/home/user/ExploreASL",
};

describe("MatlabProfileSchema", () => {
  it("parses a valid MATLAB profile", () => {
    const parsed = MatlabProfileSchema.parse(validMatlabProfile);

    expect(parsed.id).toBe(validMatlabProfile.id);
    expect(parsed.label).toBe(validMatlabProfile.label);
    expect(parsed.type).toBe("matlab");
    expect(parsed.matlabPath).toBe(validMatlabProfile.matlabPath);
    expect(parsed.exploreAslPath).toBe(validMatlabProfile.exploreAslPath);
  });

  it("fails when id is missing", () => {
    expect(() =>
      MatlabProfileSchema.parse({
        label: "Test",
        type: "matlab",
        matlabPath: "/path/matlab",
        exploreAslPath: "/path/exploreasl",
      }),
    ).toThrow();
  });

  it("fails when id is not a valid UUID", () => {
    expect(() =>
      MatlabProfileSchema.parse({
        id: "not-a-uuid",
        label: "Test",
        type: "matlab",
        matlabPath: "/path/matlab",
        exploreAslPath: "/path/exploreasl",
      }),
    ).toThrow();
  });

  it("fails when label is empty", () => {
    expect(() =>
      MatlabProfileSchema.parse({
        id: validMatlabProfile.id,
        label: "",
        type: "matlab",
        matlabPath: "/path/matlab",
        exploreAslPath: "/path/exploreasl",
      }),
    ).toThrow();
  });

  it("fails when matlabPath is empty", () => {
    expect(() =>
      MatlabProfileSchema.parse({
        id: validMatlabProfile.id,
        label: "Test",
        type: "matlab",
        matlabPath: "",
        exploreAslPath: "/path/exploreasl",
      }),
    ).toThrow();
  });

  it("fails when exploreAslPath is empty", () => {
    expect(() =>
      MatlabProfileSchema.parse({
        id: validMatlabProfile.id,
        label: "Test",
        type: "matlab",
        matlabPath: "/path/matlab",
        exploreAslPath: "",
      }),
    ).toThrow();
  });

  it("allows exploreAslVersion to be absent", () => {
    const parsed = MatlabProfileSchema.parse(validMatlabProfile);

    expect(parsed.exploreAslVersion).toBeUndefined();
  });

  it("accepts exploreAslVersion when provided", () => {
    const parsed = MatlabProfileSchema.parse({
      ...validMatlabProfile,
      exploreAslVersion: "1.11.0",
    });

    expect(parsed.exploreAslVersion).toBe("1.11.0");
  });
});

describe("ExecutionProfileSchema", () => {
  it("parses a valid MATLAB profile through the discriminated union", () => {
    const parsed = ExecutionProfileSchema.parse(validMatlabProfile);

    expect(parsed.type).toBe("matlab");
    expect(parsed.id).toBe(validMatlabProfile.id);
    expect(parsed.label).toBe(validMatlabProfile.label);
  });

  it("fails when type is unknown", () => {
    expect(() =>
      ExecutionProfileSchema.parse({
        id: validMatlabProfile.id,
        label: "Test",
        type: "docker",
        matlabPath: "/path/matlab",
        exploreAslPath: "/path/exploreasl",
      }),
    ).toThrow();
  });

  it("fails when type is missing", () => {
    expect(() =>
      ExecutionProfileSchema.parse({
        id: validMatlabProfile.id,
        label: "Test",
        matlabPath: "/path/matlab",
        exploreAslPath: "/path/exploreasl",
      }),
    ).toThrow();
  });
});
