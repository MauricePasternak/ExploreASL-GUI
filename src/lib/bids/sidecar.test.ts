import { describe, it, expect } from "vitest";
import { summarizeAslContext } from "./sidecar";

// ── summarizeAslContext ──────────────────────────────────────────────────────

describe("summarizeAslContext", () => {
  it("returns empty string for undefined", () => {
    expect(summarizeAslContext(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(summarizeAslContext("")).toBe("");
  });

  it("run-length encodes adjacent identical tokens and uses ' x{count}' format", () => {
    expect(summarizeAslContext("m0scan,m0scan,label,label")).toBe("m0scan x2, label x2");
  });

  it("condenses alternating label-control or control-label pairs", () => {
    expect(summarizeAslContext("m0scan,label,control,m0scan")).toBe(
      "m0scan, label-control pair, m0scan",
    );
  });

  it("handles single token (omitting count suffix for count 1)", () => {
    expect(summarizeAslContext("m0scan")).toBe("m0scan");
  });

  it("handles tokens with surrounding whitespace", () => {
    expect(summarizeAslContext("m0scan , m0scan , label")).toBe("m0scan x2, label");
  });

  it("condenses label-control repeated 40 times", () => {
    const raw = Array(40).fill("label,control").join(",");
    expect(summarizeAslContext(raw)).toBe("label-control pair x40");
  });

  it("condenses control-label repeated 40 times", () => {
    const raw = Array(40).fill("control,label").join(",");
    expect(summarizeAslContext(raw)).toBe("control-label pair x40");
  });

  it("handles the user's specific example with mixed types", () => {
    const raw =
      "control, label, control, label, m0scan, m0scan, label, control, label, control, deltam";
    expect(summarizeAslContext(raw)).toBe(
      "control-label pair x2, m0scan x2, label-control pair x2, deltam",
    );
  });

  it("handles trailing unpaired alternating token", () => {
    expect(summarizeAslContext("control, label, control, label, control")).toBe(
      "control-label pair x2, control",
    );
  });

  it("handles block design without pairing (only adjacent run-length encoding)", () => {
    expect(summarizeAslContext("label, label, control, control")).toBe("label x2, control x2");
  });

  it("handles arbitrary other tokens without breaking them", () => {
    expect(summarizeAslContext("foo, bar, control, label, baz, baz")).toBe(
      "foo, bar, control-label pair, baz x2",
    );
  });

  it("handles complex interspersed sequence", () => {
    expect(summarizeAslContext("m0scan, m0scan, control, label, m0scan, label, control")).toBe(
      "m0scan x2, control-label pair, m0scan, label-control pair",
    );
  });
});
