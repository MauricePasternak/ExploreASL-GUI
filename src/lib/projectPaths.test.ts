import { describe, expect, it } from "vitest";

import {
  canonicalInternalSource,
  canonicalRawPath,
  canonicalSourcePath,
  isAbsolutePath,
  normalizeRawPath,
  resolveLogicalSource,
  resolveRawPath,
} from "./projectPaths";

describe("project path contract", () => {
  it("resolves the BIDS dot source against the current project root", () => {
    expect(resolveLogicalSource("/moved/study", ".", "bids")).toBe("/moved/study");
  });

  it("canonicalizes internal DICOM sources with an explicit relative marker", () => {
    expect(canonicalInternalSource("sourcedata/dicom")).toBe("./sourcedata/dicom");
    expect(canonicalInternalSource(".")).toBe(".");
  });

  it("preserves absolute Unix, Windows drive, and UNC source paths", () => {
    expect(resolveLogicalSource("/project", "/media/dicom", "dicom")).toBe("/media/dicom");
    expect(resolveLogicalSource("C:\\project", "D:\\dicom", "dicom")).toBe("D:\\dicom");
    expect(resolveLogicalSource("C:\\project", "\\\\server\\share\\dicom", "dicom")).toBe(
      "\\\\server\\share\\dicom",
    );
    expect(isAbsolutePath("D:\\dicom")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
  });

  it("keeps raw entries relative to their logical source", () => {
    expect(normalizeRawPath("./subject\\session/scan")).toBe("subject/session/scan");
    expect(resolveRawPath("/media/dicom", "subject/session/scan")).toBe(
      "/media/dicom/subject/session/scan",
    );
    expect(resolveRawPath("C:\\dicom", "subject/session/scan")).toBe(
      "C:\\dicom\\subject\\session\\scan",
    );
    expect(canonicalRawPath("/media/dicom/subject/session/scan", "/media/dicom")).toBe(
      "subject/session/scan",
    );
  });

  it("canonicalizes source ownership without changing external paths", () => {
    expect(canonicalSourcePath("/project", "/project/sourcedata", "dicom")).toBe("./sourcedata");
    expect(canonicalSourcePath("/project", "/media/dicom", "dicom")).toBe("/media/dicom");
    expect(canonicalSourcePath("/project", "/old/project", "bids")).toBe(".");
    expect(canonicalSourcePath("C:\\Project", "c:\\project\\source", "dicom")).toBe("./source");
  });

  it.each(["../outside", "subject/../../outside", "/absolute", "C:\\absolute", "\\\\host\\x"])(
    "rejects escaping or absolute raw path %s",
    (path) => {
      expect(() => normalizeRawPath(path)).toThrow(/relative|escape/i);
    },
  );

  it.each(["../outside", "./subject/../../outside"])(
    "rejects project-relative source escape %s",
    (path) => {
      expect(() => resolveLogicalSource("/project", path, "dicom")).toThrow(/escape/i);
    },
  );
});
