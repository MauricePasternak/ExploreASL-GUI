import { describe, expect, it } from "vitest";

import type { SubjectModuleStatus, SubjectInfo } from "../../schemas/processingSchemas";
import {
  getStepsForSubject,
  getRunsForSubjectInfo,
  getSubjectOverallStatus,
  calcModuleProgress,
} from "./ExecutionDashboard";

describe("getStepsForSubject", () => {
  const baseEntry: SubjectModuleStatus = {
    subjectSession: "sub-001_01",
    module: "structural",
    status: "incomplete",
    completedSteps: ["060_Segment_T1w", "070_SkullStrip_T1w"],
    locked: true,
  };

  it("maps completed steps to complete status", () => {
    const statuses: SubjectModuleStatus[] = [{ ...baseEntry, locked: false }];
    const steps = getStepsForSubject("sub-001_01", "structural", statuses);
    expect(steps).toEqual([
      { name: "060_Segment_T1w", status: "complete" },
      { name: "070_SkullStrip_T1w", status: "complete" },
    ]);
  });

  it("appends running step when locked", () => {
    const statuses: SubjectModuleStatus[] = [baseEntry];
    const steps = getStepsForSubject("sub-001_01", "structural", statuses);
    expect(steps).toEqual([
      { name: "060_Segment_T1w", status: "complete" },
      { name: "070_SkullStrip_T1w", status: "complete" },
      { name: "Processing...", status: "running" },
    ]);
  });

  it("does not append running step when not locked", () => {
    const statuses: SubjectModuleStatus[] = [{ ...baseEntry, locked: false }];
    const steps = getStepsForSubject("sub-001_01", "structural", statuses);
    expect(steps).toHaveLength(2);
    expect(steps.every((s) => s.status === "complete")).toBe(true);
  });

  it("returns empty array when no entry found", () => {
    const steps = getStepsForSubject("sub-999_01", "structural", []);
    expect(steps).toEqual([]);
  });

  it("returns only running step when locked with no completed steps", () => {
    const statuses: SubjectModuleStatus[] = [{ ...baseEntry, completedSteps: [], locked: true }];
    const steps = getStepsForSubject("sub-001_01", "structural", statuses);
    expect(steps).toEqual([{ name: "Processing...", status: "running" }]);
  });

  it("matches on run when specified", () => {
    const statuses: SubjectModuleStatus[] = [
      { ...baseEntry, run: "01", locked: false },
      { ...baseEntry, run: "02", locked: true },
    ];
    const steps = getStepsForSubject("sub-001_01", "structural", statuses, "02");
    expect(steps).toHaveLength(3);
    expect(steps[2]).toEqual({ name: "Processing...", status: "running" });
  });

  it("does not append running step when locked but status is complete", () => {
    const statuses: SubjectModuleStatus[] = [{ ...baseEntry, status: "complete", locked: true }];
    const steps = getStepsForSubject("sub-001_01", "structural", statuses);
    expect(steps).toEqual([
      { name: "060_Segment_T1w", status: "complete" },
      { name: "070_SkullStrip_T1w", status: "complete" },
    ]);
  });
});

describe("getRunsForSubjectInfo", () => {
  const baseSubject: SubjectInfo = {
    subjectSession: "sub-001_01",
    subject: "001",
    session: "01",
    hasStructural: true,
    hasASL: true,
    aslRuns: ["1", "2"],
  };

  it("unions runs from SubjectInfo and statuses", () => {
    const statuses: SubjectModuleStatus[] = [
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "3",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
    ];
    const runs = getRunsForSubjectInfo(baseSubject, statuses);
    expect(runs).toEqual(["1", "2", "3"]);
  });

  it("defaults to ['1'] when no runs are defined", () => {
    const subjectWithoutRuns: SubjectInfo = {
      ...baseSubject,
      aslRuns: [],
    };
    const runs = getRunsForSubjectInfo(subjectWithoutRuns, []);
    expect(runs).toEqual(["1"]);
  });
});

describe("getSubjectOverallStatus", () => {
  it("aggregates status of multiple runs correctly", () => {
    const statuses: SubjectModuleStatus[] = [
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "1",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "2",
        status: "incomplete",
        completedSteps: [],
        locked: true,
      },
    ];
    const overall = getSubjectOverallStatus("sub-001_01", "asl", statuses);
    expect(overall).toEqual({
      status: "incomplete",
      locked: true,
      completedRunsCount: 1,
    });
  });

  it("returns complete only when all runs are complete", () => {
    const statuses: SubjectModuleStatus[] = [
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "1",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "2",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
    ];
    const overall = getSubjectOverallStatus("sub-001_01", "asl", statuses);
    expect(overall.status).toBe("complete");
    expect(overall.locked).toBe(false);
  });
});

describe("calcModuleProgress", () => {
  const subjects: SubjectInfo[] = [
    {
      subjectSession: "sub-001_01",
      subject: "001",
      session: "01",
      hasStructural: true,
      hasASL: true,
      aslRuns: ["1", "2"],
    },
    {
      subjectSession: "sub-002_01",
      subject: "002",
      session: "01",
      hasStructural: true,
      hasASL: true,
      aslRuns: ["1"],
    },
  ];

  it("calculates progress for structural module based on subjects", () => {
    const statuses: SubjectModuleStatus[] = [
      {
        subjectSession: "sub-001_01",
        module: "structural",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
    ];
    const progress = calcModuleProgress(subjects, "structural", statuses);
    expect(progress).toEqual({ complete: 1, total: 2 });
  });

  it("calculates progress for ASL module based on complete subjects (all runs complete)", () => {
    const statuses: SubjectModuleStatus[] = [
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "1",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
      {
        subjectSession: "sub-001_01",
        module: "asl",
        run: "2",
        status: "incomplete",
        completedSteps: [],
        locked: false,
      },
      {
        subjectSession: "sub-002_01",
        module: "asl",
        run: "1",
        status: "complete",
        completedSteps: [],
        locked: false,
      },
    ];
    const progress = calcModuleProgress(subjects, "asl", statuses);
    // sub-002_01 has all its runs (only run 1) complete -> complete
    // sub-001_01 has run 2 incomplete -> not complete
    expect(progress).toEqual({ complete: 1, total: 2 });
  });
});
