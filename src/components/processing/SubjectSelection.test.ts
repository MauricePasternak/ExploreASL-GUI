import { describe, expect, it } from "vitest";
import { resolveLogBadge, resolveModuleDisplay } from "./SubjectSelection.helpers";
import type { LogFileInfo } from "../../lib/logViewer";
import type { SubjectInfo, SubjectModuleStatus } from "../../schemas/processingSchemas";

function makeLog(overrides: Partial<LogFileInfo> = {}): LogFileInfo {
  return {
    filename: "xASL_module_Structural_sub-001_01.log",
    module: "structural",
    subjectSession: "sub-001_01",
    run: undefined,
    hasError: false,
    ...overrides,
  };
}

const SUBJECT_INFO: SubjectInfo = {
  subjectSession: "sub-001_01",
  subject: "001",
  session: "01",
  hasStructural: true,
  hasASL: true,
  aslRuns: ["1"],
};

function makeStatus(overrides: Partial<SubjectModuleStatus> = {}): SubjectModuleStatus {
  return {
    subjectSession: "sub-001_01",
    module: "structural",
    status: "complete",
    completedSteps: ["999_ready"],
    locked: false,
    bids2legacyExists: true,
    ...overrides,
  };
}

describe("resolveLogBadge", () => {
  it("complete + no logs = no-logs", () => {
    expect(resolveLogBadge("complete", undefined)).toBe("no-logs");
    expect(resolveLogBadge("complete", [])).toBe("no-logs");
  });

  it("complete + logs (no errors) = logs", () => {
    expect(resolveLogBadge("complete", [makeLog()])).toBe("logs");
  });

  it("complete + logs (hasError, filtered mutex) = logs", () => {
    expect(resolveLogBadge("complete", [makeLog({ hasError: false })])).toBe("logs");
  });

  it("incomplete + logs (mutex-only, hasError false) = errors", () => {
    expect(resolveLogBadge("incomplete", [makeLog({ hasError: false })])).toBe("errors");
  });

  it("incomplete + no logs = errors", () => {
    expect(resolveLogBadge("incomplete", undefined)).toBe("errors");
    expect(resolveLogBadge("incomplete", [])).toBe("errors");
  });

  it("pending + no logs = no-logs", () => {
    expect(resolveLogBadge("pending", undefined)).toBe("no-logs");
  });

  it("skipped + no logs = no-logs", () => {
    expect(resolveLogBadge("skipped", undefined)).toBe("no-logs");
  });

  it("outdated + logs = logs", () => {
    expect(resolveLogBadge("outdated", [makeLog()])).toBe("logs");
  });

  it("outdated + no logs = no-logs", () => {
    expect(resolveLogBadge("outdated", undefined)).toBe("no-logs");
  });
});

describe("resolveModuleDisplay", () => {
  it("marks completed structural status outdated when BIDS2Legacy subject-session lock is missing", () => {
    expect(
      resolveModuleDisplay(SUBJECT_INFO, "structural", [makeStatus({ bids2legacyExists: false })]),
    ).toBe("outdated");
  });

  it("marks completed ASL status outdated when BIDS2Legacy subject-session lock is missing", () => {
    expect(
      resolveModuleDisplay(SUBJECT_INFO, "asl", [
        makeStatus({ module: "asl", run: "1", bids2legacyExists: false }),
      ]),
    ).toBe("outdated");
  });

  it("keeps completed status when BIDS2Legacy subject-session lock exists", () => {
    expect(
      resolveModuleDisplay(SUBJECT_INFO, "structural", [makeStatus({ bids2legacyExists: true })]),
    ).toBe("complete");
  });

  it("does not convert pending or skipped modules to outdated", () => {
    expect(resolveModuleDisplay(SUBJECT_INFO, "structural", [])).toBe("pending");
    expect(
      resolveModuleDisplay({ ...SUBJECT_INFO, hasStructural: false }, "structural", [
        makeStatus({ bids2legacyExists: false }),
      ]),
    ).toBe("skipped");
  });
});
