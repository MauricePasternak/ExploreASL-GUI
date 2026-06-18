import { describe, expect, it } from "vitest";

import type { SubjectModuleStatus } from "../../schemas/processingSchemas";
import { getStepsForSubject } from "./ExecutionDashboard";

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
    const statuses: SubjectModuleStatus[] = [
      { ...baseEntry, completedSteps: [], locked: true },
    ];
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
    const statuses: SubjectModuleStatus[] = [
      { ...baseEntry, status: "complete", locked: true },
    ];
    const steps = getStepsForSubject("sub-001_01", "structural", statuses);
    expect(steps).toEqual([
      { name: "060_Segment_T1w", status: "complete" },
      { name: "070_SkullStrip_T1w", status: "complete" },
    ]);
  });
});
