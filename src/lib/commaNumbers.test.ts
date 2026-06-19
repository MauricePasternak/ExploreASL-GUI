import { describe, expect, it } from "vitest";

import {
  formatNumberArray,
  formatNumberOrArray,
  parseCommaSeparatedNumbers,
  parseNumberOrArray,
} from "./commaNumbers";

describe("commaNumbers", () => {
  describe("formatNumberOrArray", () => {
    it("formats undefined as empty string", () => {
      expect(formatNumberOrArray(undefined)).toBe("");
    });

    it("formats a single number", () => {
      expect(formatNumberOrArray(1.8)).toBe("1.8");
    });

    it("formats an array as comma-separated", () => {
      expect(formatNumberOrArray([1.8, 2.0])).toBe("1.8, 2");
    });
  });

  describe("formatNumberArray", () => {
    it("formats undefined as empty", () => {
      expect(formatNumberArray(undefined)).toBe("");
    });

    it("formats array values", () => {
      expect(formatNumberArray([1, 2, 3])).toBe("1, 2, 3");
    });
  });

  describe("parseCommaSeparatedNumbers", () => {
    it("returns undefined for empty input", () => {
      expect(parseCommaSeparatedNumbers("")).toEqual({ ok: true, value: undefined });
    });

    it("parses comma-separated values", () => {
      expect(parseCommaSeparatedNumbers("1.5, 2, 3")).toEqual({
        ok: true,
        value: [1.5, 2, 3],
      });
    });

    it("rejects invalid tokens", () => {
      expect(parseCommaSeparatedNumbers("1, bad, 3")).toEqual({
        ok: false,
        error: 'Invalid number: "bad"',
      });
    });
  });

  describe("parseNumberOrArray", () => {
    it("returns undefined for empty input", () => {
      expect(parseNumberOrArray("")).toEqual({ ok: true, value: undefined });
    });

    it("parses a single number", () => {
      expect(parseNumberOrArray("1.8")).toEqual({ ok: true, value: 1.8 });
    });

    it("parses comma-separated values as array", () => {
      expect(parseNumberOrArray("1.8, 2.0")).toEqual({
        ok: true,
        value: [1.8, 2],
      });
    });

    it("collapses single-element comma list to scalar", () => {
      expect(parseNumberOrArray("1.8,")).toEqual({ ok: true, value: 1.8 });
    });
  });
});
