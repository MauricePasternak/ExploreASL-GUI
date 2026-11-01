import { describe, it, expect, vi } from "vitest";
import {
  readAllSubjectQcOutputs,
  aggregateMotionBySubject,
  aggregateMeanSd,
  aggregateFailReasons,
  formatMeanSd,
} from "./manifestQc";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("readAllSubjectQcOutputs", () => {
  it("returns null when subjectSessions is empty", async () => {
    const result = await readAllSubjectQcOutputs("/tmp/project", []);
    expect(result).toBeNull();
  });

  it("invokes Tauri command get_all_subjects_qc and returns mapped data", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockData = {
      "sub-01_01": {
        coverage: 95.0,
        spatialCov: 10.0,
        motion: [0.1, 0.2],
        motionExclusionPct: 0.0,
      },
    };
    vi.mocked(invoke).mockResolvedValue(mockData);

    const result = await readAllSubjectQcOutputs("/tmp/project", ["sub-01_01"]);
    expect(invoke).toHaveBeenCalledWith("get_all_subjects_qc", {
      projectRoot: "/tmp/project",
      subjectSessions: ["sub-01_01"],
    });
    expect(result).toEqual(mockData);
  });

  it("returns null and logs warning on invoke failure", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValue(new Error("IPC failure"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await readAllSubjectQcOutputs("/tmp/project", ["sub-01_01"]);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("excludes null/nonfinite motion samples without inventing zero motion", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue({
      valid: {
        coverage: null,
        spatialCov: null,
        motion: [null, 0.2, Number.NaN],
        motionExclusionPct: null,
      },
      missing: { coverage: null, spatialCov: null, motion: [null], motionExclusionPct: null },
    });
    const result = await readAllSubjectQcOutputs("/project", ["valid", "missing"]);
    expect(result?.valid.motion).toEqual([0.2]);
    expect(aggregateMotionBySubject(result?.missing.motion ?? [])).toBeNull();
  });
});

describe("aggregateMotionBySubject", () => {
  it("takes max across runs", () => {
    expect(aggregateMotionBySubject([0.4, 0.7, 0.5])).toBe(0.7);
  });
  it("returns null for empty array", () => {
    expect(aggregateMotionBySubject([])).toBeNull();
  });
});

interface QcRow {
  verdict: string;
  coverage?: number;
  spatialCov?: number;
  motion?: number;
  motionExclusionPct?: number;
}

describe("aggregateMeanSd", () => {
  it("excludes fail rows from coverage mean and SD", () => {
    const rows: QcRow[] = [
      { verdict: "pass", coverage: 95 },
      { verdict: "pass", coverage: 90 },
      { verdict: "pass", spatialCov: 8 },
      { verdict: "fail", coverage: 50 },
      { verdict: "no-info", coverage: undefined },
    ];
    const result = aggregateMeanSd(rows, (r) => r.coverage);
    expect(result.mean).toBeCloseTo(92.5, 2);
    expect(result.sd).toBeCloseTo(3.54, 2);
    expect(result.n).toBe(2);
    expect(aggregateMeanSd(rows, (r) => r.spatialCov).n).toBe(1);
  });

  it("returns null SD for single-subject group", () => {
    const rows: QcRow[] = [{ verdict: "pass", coverage: 88 }];
    const result = aggregateMeanSd(rows, (r) => r.coverage);
    expect(result.mean).toBeCloseTo(88, 2);
    expect(result.sd).toBeNull();
    expect(result.n).toBe(1);
  });

  it("returns null mean and SD when zero pass rows", () => {
    const rows: QcRow[] = [{ verdict: "fail", coverage: 80 }];
    const result = aggregateMeanSd(rows, (r) => r.coverage);
    expect(result).toEqual({ mean: null, sd: null, n: 0 });
  });
});

describe("aggregateFailReasons", () => {
  it("counts fail verdicts by reason", () => {
    const rows = [
      { verdict: "fail", reason: "motion" },
      { verdict: "fail", reason: "motion" },
      { verdict: "fail", reason: "coverage" },
      { verdict: "fail", reason: undefined },
      { verdict: "pass" },
    ];
    expect(aggregateFailReasons(rows)).toEqual({ motion: 2, coverage: 1 });
  });
});

describe("formatMeanSd", () => {
  it("returns N/A for null mean", () => {
    expect(formatMeanSd({ mean: null, sd: null, n: 0 })).toBe("N/A; n=0");
  });
  it("returns mean with N/A SD", () => {
    expect(formatMeanSd({ mean: 88, sd: null, n: 1 })).toBe("88.00 (N/A); n=1");
  });
  it("returns mean with SD", () => {
    expect(formatMeanSd({ mean: 95.0, sd: 3.54, n: 2 })).toBe("95.00 (3.54); n=2");
  });
});
