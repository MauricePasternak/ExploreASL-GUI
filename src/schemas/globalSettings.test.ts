import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, GlobalSettingsSchema } from "./globalSettings";

describe("GlobalSettingsSchema", () => {
  it("provides defaults for an empty settings object", () => {
    const parsed = GlobalSettingsSchema.parse({});

    expect(parsed).toEqual(DEFAULT_SETTINGS);
  });

  it("provides underscore and hyphen as the default tokenizer delimiters", () => {
    const parsed = GlobalSettingsSchema.parse({});

    expect(parsed.tokenSubDelimiters).toEqual(["_", "-"]);
    expect(parsed).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults import staging preservation to false", () => {
    const parsed = GlobalSettingsSchema.parse({});

    expect(parsed.import.preserveStagingDir).toBe(false);
    expect(parsed).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects whitespace-only tokenizer delimiters", () => {
    expect(() =>
      GlobalSettingsSchema.parse({
        tokenSubDelimiters: [" "],
      }),
    ).toThrow();
  });

  it("rejects duplicate tokenizer delimiter arrays", () => {
    expect(() =>
      GlobalSettingsSchema.parse({
        tokenSubDelimiters: ["_", "_"],
      }),
    ).toThrow();
  });

  it("rejects empty tokenizer delimiter arrays", () => {
    expect(() =>
      GlobalSettingsSchema.parse({
        tokenSubDelimiters: [],
      }),
    ).toThrow();
  });

  // Task Group 2: execution profiles replace MATLAB fields
  it("defaults executionProfiles to empty array", () => {
    const parsed = GlobalSettingsSchema.parse({});

    expect(parsed.executionProfiles).toEqual([]);
  });

  it("accepts valid executionProfiles array", () => {
    const parsed = GlobalSettingsSchema.parse({
      executionProfiles: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "matlab",
          label: "MATLAB R2023b",
          matlabPath: "/usr/local/MATLAB/R2023b",
          exploreAslPath: "/opt/ExploreASL",
          exploreAslVersion: "1.0.0",
        },
      ],
    });

    expect(parsed.executionProfiles).toHaveLength(1);
    expect(parsed.executionProfiles[0].label).toBe("MATLAB R2023b");
  });

  it("rejects invalid execution profile entry", () => {
    expect(() =>
      GlobalSettingsSchema.parse({
        executionProfiles: [{ type: "matlab", label: "", matlabPath: "" }],
      }),
    ).toThrow();
  });

  it("strips unknown legacy fields", () => {
    const parsed = GlobalSettingsSchema.parse({
      matlabInstallations: [{ id: "m", label: "L", path: "/p", version: "" }],
      exploreAslPath: "/old/path",
      exploreAslVersion: "0.9.0",
    });

    expect(Reflect.get(parsed, "matlabInstallations")).toBeUndefined();
    expect(Reflect.get(parsed, "exploreAslPath")).toBeUndefined();
    expect(Reflect.get(parsed, "exploreAslVersion")).toBeUndefined();
  });
});
