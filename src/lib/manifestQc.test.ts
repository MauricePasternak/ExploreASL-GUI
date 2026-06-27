import { describe, it, expect, vi } from "vitest";
import {
  readSubjectQcOutputs,
  aggregateMotionBySubject,
  aggregateMeanSd,
  aggregateFailReasons,
  formatMeanSd,
} from "./manifestQc";

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
}));

describe("readSubjectQcOutputs", () => {
  it("returns null when coverage.csv missing", async () => {
    const { exists } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValue(false);
    const result = await readSubjectQcOutputs("/tmp/project", "sub-X_01");
    expect(result).toBeNull();
  });
});

describe("aggregateMotionBySubject", () => {
  it("takes max across runs", () => {
    expect(aggregateMotionBySubject([0.4, 0.7, 0.5])).toBe(0.7);
  });
  it("returns 0 for empty array", () => {
    expect(aggregateMotionBySubject([])).toBe(0);
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
      { verdict: "fail", coverage: 50 },
      { verdict: "no-info", coverage: undefined },
    ];
    const result = aggregateMeanSd(rows, (r) => r.coverage);
    expect(result.mean).toBeCloseTo(92.5, 2);
    expect(result.sd).toBeCloseTo(3.54, 2);
  });

  it("returns null SD for single-subject group", () => {
    const rows: QcRow[] = [{ verdict: "pass", coverage: 88 }];
    const result = aggregateMeanSd(rows, (r) => r.coverage);
    expect(result.mean).toBeCloseTo(88, 2);
    expect(result.sd).toBeNull();
  });

  it("returns null mean and SD when zero pass rows", () => {
    const rows: QcRow[] = [{ verdict: "fail", coverage: 80 }];
    const result = aggregateMeanSd(rows, (r) => r.coverage);
    expect(result).toEqual({ mean: null, sd: null });
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
    expect(formatMeanSd({ mean: null, sd: null })).toBe("N/A");
  });
  it("returns mean with N/A SD", () => {
    expect(formatMeanSd({ mean: 88, sd: null })).toBe("88.00 (N/A)");
  });
  it("returns mean with SD", () => {
    expect(formatMeanSd({ mean: 95.0, sd: 3.54 })).toBe("95.00 (3.54)");
  });
});
