import { describe, expect, it } from "vitest";

import type { SubjectModuleStatus } from "../../schemas/processingSchemas";

import { indexSubjectStatuses, getEntriesFor, getEntryFor } from "./subjectStatusIndex";

function makeStatus(
  subjectSession: string,
  module: SubjectModuleStatus["module"],
  partial: Partial<SubjectModuleStatus> = {},
): SubjectModuleStatus {
  return {
    subjectSession,
    module,
    run: undefined,
    status: "pending",
    completedSteps: [],
    locked: false,
    ...partial,
  };
}

describe("indexSubjectStatuses", () => {
  it("returns empty map for empty input", () => {
    const index = indexSubjectStatuses([]);
    expect(index.size).toBe(0);
  });

  it("indexes by `${subjectSession}|${module}` and groups runs", () => {
    const statuses = [
      makeStatus("sub-001_01", "asl", { run: "1", status: "complete" }),
      makeStatus("sub-001_01", "asl", { run: "2", status: "incomplete", locked: true }),
      makeStatus("sub-001_01", "structural", { status: "complete" }),
    ];
    const index = indexSubjectStatuses(statuses);
    expect(index.size).toBe(2);
    const aslEntries = getEntriesFor(index, "sub-001_01", "asl");
    expect(aslEntries).toHaveLength(2);
    expect(aslEntries[0].run).toBe("1");
    expect(aslEntries[1].run).toBe("2");
    const structEntries = getEntriesFor(index, "sub-001_01", "structural");
    expect(structEntries).toHaveLength(1);
    expect(structEntries[0].status).toBe("complete");
  });

  it("getEntriesFor returns empty array for missing key", () => {
    const index = indexSubjectStatuses([makeStatus("sub-001_01", "structural")]);
    expect(getEntriesFor(index, "sub-999_01", "structural")).toEqual([]);
    expect(getEntriesFor(index, "sub-001_01", "asl")).toEqual([]);
  });

  it("getEntryFor returns first matching run or undefined", () => {
    const statuses = [
      makeStatus("sub-001_01", "asl", { run: "1", status: "complete" }),
      makeStatus("sub-001_01", "asl", { run: "2", status: "incomplete" }),
    ];
    const index = indexSubjectStatuses(statuses);
    expect(getEntryFor(index, "sub-001_01", "asl")?.run).toBe("1");
    expect(getEntryFor(index, "sub-001_01", "asl", "2")?.run).toBe("2");
    expect(getEntryFor(index, "sub-001_01", "asl", "99")).toBeUndefined();
    expect(getEntryFor(index, "sub-999_01", "asl")).toBeUndefined();
  });

  it("getEntryFor without run matches entries whose run is undefined", () => {
    const statuses = [
      makeStatus("sub-001_01", "structural", { run: undefined, status: "complete" }),
    ];
    const index = indexSubjectStatuses(statuses);
    expect(getEntryFor(index, "sub-001_01", "structural")?.status).toBe("complete");
  });

  it("getEntryFor matches normalized run ids (01 == 1)", () => {
    const statuses = [makeStatus("sub-001_01", "asl", { run: "1", status: "complete" })];
    const index = indexSubjectStatuses(statuses);
    expect(getEntryFor(index, "sub-001_01", "asl", "01")?.run).toBe("1");
  });
});
