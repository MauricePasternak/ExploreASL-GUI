import { describe, expect, it } from "vitest";

import { aslRunsEqual, normalizeAslRunId, toExploreAslSessionLabel } from "./aslRun";

describe("normalizeAslRunId", () => {
  it("strips leading zeros from numeric BIDS run labels", () => {
    expect(normalizeAslRunId("01")).toBe("1");
    expect(normalizeAslRunId("02")).toBe("2");
    expect(normalizeAslRunId("001")).toBe("1");
  });

  it("preserves unpadded numeric runs", () => {
    expect(normalizeAslRunId("1")).toBe("1");
    expect(normalizeAslRunId("12")).toBe("12");
  });

  it("strips ASL_ prefix then normalizes", () => {
    expect(normalizeAslRunId("ASL_01")).toBe("1");
    expect(normalizeAslRunId("ASL_1")).toBe("1");
    expect(normalizeAslRunId("asl_2")).toBe("2");
  });

  it("defaults absent / empty / non-numeric to 1 (ExploreASL xASL_str2num behavior)", () => {
    expect(normalizeAslRunId(undefined)).toBe("1");
    expect(normalizeAslRunId(null)).toBe("1");
    expect(normalizeAslRunId("")).toBe("1");
    expect(normalizeAslRunId("   ")).toBe("1");
    expect(normalizeAslRunId("pre")).toBe("1");
    expect(normalizeAslRunId("0")).toBe("1");
  });
});

describe("aslRunsEqual", () => {
  it("treats padded and unpadded forms as equal", () => {
    expect(aslRunsEqual("01", "1")).toBe(true);
    expect(aslRunsEqual("ASL_01", "1")).toBe(true);
    expect(aslRunsEqual("02", "2")).toBe(true);
  });

  it("distinguishes different runs", () => {
    expect(aslRunsEqual("1", "2")).toBe(false);
    expect(aslRunsEqual("01", "02")).toBe(false);
  });

  it("treats both missing as equal", () => {
    expect(aslRunsEqual(undefined, undefined)).toBe(true);
    expect(aslRunsEqual(undefined, "1")).toBe(false);
  });
});

describe("toExploreAslSessionLabel", () => {
  it("formats canonical ExploreASL session labels", () => {
    expect(toExploreAslSessionLabel("01")).toBe("ASL_1");
    expect(toExploreAslSessionLabel("1")).toBe("ASL_1");
    expect(toExploreAslSessionLabel("ASL_2")).toBe("ASL_2");
  });
});
