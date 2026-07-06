import { describe, it, expect } from "vitest";
import { normalizePulseSequenceType, normalizeManufacturer, sanitizeLabel } from "./normalize";

describe("normalizePulseSequenceType", () => {
  it("maps '3D_SPIRAL' to 'spiral' (spec scenario: ds000240)", () => {
    expect(normalizePulseSequenceType("3D_SPIRAL")).toBe("spiral");
  });

  it("maps 'EPI' to 'EPI'", () => {
    expect(normalizePulseSequenceType("EPI")).toBe("EPI");
  });

  it("maps lowercase 'epi' to 'EPI'", () => {
    expect(normalizePulseSequenceType("epi")).toBe("EPI");
  });

  it("maps variants of EPI (gre-epi, mb-epi, ep2d, epfid, pepolar, epik) to 'EPI'", () => {
    expect(normalizePulseSequenceType("gre-epi")).toBe("EPI");
    expect(normalizePulseSequenceType("gradient echo epi")).toBe("EPI");
    expect(normalizePulseSequenceType("se-epi")).toBe("EPI");
    expect(normalizePulseSequenceType("spin echo epi")).toBe("EPI");
    expect(normalizePulseSequenceType("mb-epi")).toBe("EPI");
    expect(normalizePulseSequenceType("multiband epi")).toBe("EPI");
    expect(normalizePulseSequenceType("ep2d")).toBe("EPI");
    expect(normalizePulseSequenceType("epfid2d1_64")).toBe("EPI");
    expect(normalizePulseSequenceType("epik")).toBe("EPI");
    expect(normalizePulseSequenceType("pepolar")).toBe("EPI");
  });

  it("maps 'GRASE' to 'GRASE'", () => {
    expect(normalizePulseSequenceType("GRASE")).toBe("GRASE");
  });

  it("maps lowercase 'grase' to 'GRASE'", () => {
    expect(normalizePulseSequenceType("grase")).toBe("GRASE");
  });

  it("maps GRASE variants (3d grase, tgse, 3d tgse) to 'GRASE'", () => {
    expect(normalizePulseSequenceType("3d grase")).toBe("GRASE");
    expect(normalizePulseSequenceType("tgse")).toBe("GRASE");
    expect(normalizePulseSequenceType("3d tgse")).toBe("GRASE");
  });

  it("maps 'spiral' (lowercase) to 'spiral'", () => {
    expect(normalizePulseSequenceType("spiral")).toBe("spiral");
  });

  it("maps spiral variants (3d spiral, fse-spiral) to 'spiral'", () => {
    expect(normalizePulseSequenceType("3d spiral")).toBe("spiral");
    expect(normalizePulseSequenceType("fse-spiral")).toBe("spiral");
  });

  it("maps typo variants using fuzzy matching fallback (e.g. 3D_SPRIAL to spiral)", () => {
    expect(normalizePulseSequenceType("3D_SPRIAL")).toBe("spiral");
    expect(normalizePulseSequenceType("3D_SPIRL")).toBe("spiral");
  });

  it("returns undefined for unrecognized values (spec scenario)", () => {
    expect(normalizePulseSequenceType("unknown_readout")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(normalizePulseSequenceType("")).toBeUndefined();
  });
});

describe("normalizeManufacturer", () => {
  it("maps 'SIEMENS TrioTim' to 'Siemens' (spec scenario)", () => {
    expect(normalizeManufacturer("SIEMENS TrioTim")).toBe("Siemens");
  });

  it("maps 'GE MEDICAL SYSTEMS' to 'GE_product' (spec scenario)", () => {
    expect(normalizeManufacturer("GE MEDICAL SYSTEMS")).toBe("GE_product");
  });

  it("maps 'Philips' to 'Philips' (case-insensitive)", () => {
    expect(normalizeManufacturer("Philips")).toBe("Philips");
    expect(normalizeManufacturer("PHILIPS")).toBe("Philips");
  });

  it("returns undefined for unrecognized manufacturer (spec scenario: Canon)", () => {
    expect(normalizeManufacturer("Canon Medical Systems")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(normalizeManufacturer("")).toBeUndefined();
  });
});

describe("sanitizeLabel", () => {
  it("strips forward slashes", () => {
    expect(sanitizeLabel("foo/bar")).toBe("foobar");
    expect(sanitizeLabel("a/b/c")).toBe("abc");
  });

  it("strips backslashes", () => {
    expect(sanitizeLabel("foo\\bar")).toBe("foobar");
  });

  it("strips semicolons", () => {
    expect(sanitizeLabel("foo;bar")).toBe("foobar");
    expect(sanitizeLabel("a;b;c")).toBe("abc");
  });

  it("strips C0 control chars including newline, tab, CR, NUL", () => {
    expect(sanitizeLabel("foo\nbar")).toBe("foobar");
    expect(sanitizeLabel("foo\rbar")).toBe("foobar");
    expect(sanitizeLabel("foo\tbar")).toBe("foobar");
    expect(sanitizeLabel("foo\x00bar")).toBe("foobar");
    expect(sanitizeLabel("foo\x1Fbar")).toBe("foobar");
  });

  it('strips shell-special characters: < > " ` $ * ? |', () => {
    expect(sanitizeLabel("a<b>c")).toBe("abc");
    expect(sanitizeLabel('a"b"c')).toBe("abc");
    expect(sanitizeLabel("a`b`c")).toBe("abc");
    expect(sanitizeLabel("a$b$c")).toBe("abc");
    expect(sanitizeLabel("a*b*c")).toBe("abc");
    expect(sanitizeLabel("a?b?c")).toBe("abc");
    expect(sanitizeLabel("a|b|c")).toBe("abc");
  });

  it("preserves underscore, hyphen, dot, parentheses", () => {
    expect(sanitizeLabel("Siemens_3T_PCASL_3D_Included")).toBe("Siemens_3T_PCASL_3D_Included");
    expect(sanitizeLabel("foo-bar")).toBe("foo-bar");
    expect(sanitizeLabel("foo.bar")).toBe("foo.bar");
    expect(sanitizeLabel("foo(2)")).toBe("foo(2)");
    expect(sanitizeLabel("Group_(2)")).toBe("Group_(2)");
  });

  it("preserves spaces and alphanumerics (incl. unicode letters)", () => {
    expect(sanitizeLabel("Group A1")).toBe("Group A1");
    // Chinese / Unicode letters allowed — downstream may break but not our concern
    expect(sanitizeLabel("受试者_01")).toBe("受试者_01");
  });

  it("strips mixed offending characters while preserving allowed ones", () => {
    expect(sanitizeLabel("foo/bar\\baz;qux\nx")).toBe("foobarbazquxx");
    expect(sanitizeLabel("a/b<c>d|e;f")).toBe("abcdef");
  });

  it("returns empty string for input consisting solely of blocked characters", () => {
    expect(sanitizeLabel('/\\<>"`$*?|;\n\t')).toBe("");
  });

  it("passes through empty string unchanged", () => {
    expect(sanitizeLabel("")).toBe("");
  });
});
