import { describe, it, expect } from "vitest";
import {
  isBidsFilename,
  parseBidsEntities,
  isAslSuffix,
  isM0Suffix,
  isSubjectDir,
  isSessionDir,
} from "./path";

describe("isBidsFilename", () => {
  it("matches sub-only nifti", () => {
    expect(isBidsFilename("sub-01_T1w.nii")).toBe(true);
  });

  it("matches sub+ses json", () => {
    expect(isBidsFilename("sub-01_ses-02_asl.json")).toBe(true);
  });

  it("matches .nii.gz", () => {
    expect(isBidsFilename("sub-01_T1w.nii.gz")).toBe(true);
  });

  it("matches with run, ses, and task entities (BIDS alphabetical order)", () => {
    expect(isBidsFilename("sub-01_run-01_ses-01_task-rest_bold.nii.gz")).toBe(true);
  });

  it("matches m0scan sidecar", () => {
    expect(isBidsFilename("sub-01_ses-01_m0scan.json")).toBe(true);
  });

  it("rejects non-BIDS filename", () => {
    expect(isBidsFilename("README.md")).toBe(false);
  });

  it("rejects filename without sub- prefix", () => {
    expect(isBidsFilename("01_T1w.nii")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isBidsFilename("")).toBe(false);
  });
});

describe("parseBidsEntities", () => {
  it("parses sub-only", () => {
    const result = parseBidsEntities("sub-01_T1w.nii.gz");
    expect(result.sub).toBe("01");
    expect(result.suffix).toBe("T1w");
    expect(result.ses).toBeUndefined();
  });

  it("parses sub+ses", () => {
    const result = parseBidsEntities("sub-01_ses-02_asl.json");
    expect(result.sub).toBe("01");
    expect(result.ses).toBe("02");
    expect(result.suffix).toBe("asl");
  });

  it("parses run and ses entities (BIDS alphabetical order)", () => {
    const result = parseBidsEntities("sub-01_run-03_ses-01_asl.nii.gz");
    expect(result.sub).toBe("01");
    expect(result.ses).toBe("01");
    expect(result.run).toBe("03");
    expect(result.suffix).toBe("asl");
  });

  it("parses ses before run (common ExploreASL/BIDS ordering)", () => {
    const result = parseBidsEntities("sub-01_ses-01_run-1_asl.nii.gz");
    expect(result.sub).toBe("01");
    expect(result.ses).toBe("01");
    expect(result.run).toBe("1");
    expect(result.suffix).toBe("asl");
  });

  it("parses ses before run for json sidecar", () => {
    const result = parseBidsEntities("sub-01_ses-01_run-1_asl.json");
    expect(result.sub).toBe("01");
    expect(result.ses).toBe("01");
    expect(result.run).toBe("1");
    expect(result.suffix).toBe("asl");
  });

  it("parses acq and task entities", () => {
    const result = parseBidsEntities("sub-01_acq-pcasl_task-rest_asl.json");
    expect(result.sub).toBe("01");
    expect(result.acq).toBe("pcasl");
    expect(result.task).toBe("rest");
    expect(result.suffix).toBe("asl");
  });

  it("parses m0scan suffix", () => {
    const result = parseBidsEntities("sub-01_ses-01_m0scan.nii.gz");
    expect(result.sub).toBe("01");
    expect(result.ses).toBe("01");
    expect(result.suffix).toBe("m0scan");
  });

  it("returns empty object for non-BIDS filename", () => {
    const result = parseBidsEntities("README.md");
    expect(result).toEqual({});
  });
});

describe("isAslSuffix", () => {
  it("matches asl nifti", () => {
    expect(isAslSuffix("sub-01_asl.nii")).toBe(true);
  });

  it("matches asl nifti.gz", () => {
    expect(isAslSuffix("sub-01_asl.nii.gz")).toBe(true);
  });

  it("matches asl json", () => {
    expect(isAslSuffix("sub-01_asl.json")).toBe(true);
  });

  it("rejects non-asl suffix", () => {
    expect(isAslSuffix("sub-01_T1w.nii")).toBe(false);
  });

  it("rejects m0scan", () => {
    expect(isAslSuffix("sub-01_m0scan.nii.gz")).toBe(false);
  });
});

describe("isM0Suffix", () => {
  it("matches m0scan nifti", () => {
    expect(isM0Suffix("sub-01_m0scan.nii")).toBe(true);
  });

  it("matches m0scan nifti.gz", () => {
    expect(isM0Suffix("sub-01_m0scan.nii.gz")).toBe(true);
  });

  it("matches m0scan json", () => {
    expect(isM0Suffix("sub-01_m0scan.json")).toBe(true);
  });

  it("rejects non-m0scan suffix", () => {
    expect(isM0Suffix("sub-01_asl.nii.gz")).toBe(false);
  });

  it("rejects T1w", () => {
    expect(isM0Suffix("sub-01_T1w.nii")).toBe(false);
  });
});

describe("isSubjectDir", () => {
  it("matches sub-01", () => {
    expect(isSubjectDir("sub-01")).toBe(true);
  });

  it("matches sub-control01", () => {
    expect(isSubjectDir("sub-control01")).toBe(true);
  });

  it("rejects ses-01", () => {
    expect(isSubjectDir("ses-01")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSubjectDir("")).toBe(false);
  });

  it("rejects string with path separator", () => {
    expect(isSubjectDir("sub-01/perf")).toBe(false);
  });
});

describe("isSessionDir", () => {
  it("matches ses-01", () => {
    expect(isSessionDir("ses-01")).toBe(true);
  });

  it("matches ses-baseline", () => {
    expect(isSessionDir("ses-baseline")).toBe(true);
  });

  it("rejects sub-01", () => {
    expect(isSessionDir("sub-01")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSessionDir("")).toBe(false);
  });

  it("rejects string with path separator", () => {
    expect(isSessionDir("ses-01/anat")).toBe(false);
  });
});
