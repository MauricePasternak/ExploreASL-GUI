import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  GlobalSettingsSchema,
} from "./globalSettings";

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

  it("rejects invalid matlab installation entries", () => {
    expect(() =>
      GlobalSettingsSchema.parse({
        matlabInstallations: [{ id: "matlab-1", label: "", path: "", version: "" }],
      }),
    ).toThrow(/required/i);
  });

});

