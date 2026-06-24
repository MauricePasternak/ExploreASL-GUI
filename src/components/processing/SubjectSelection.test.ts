import { describe, expect, it } from "vitest";
import { resolveLogBadge } from "./SubjectSelection.helpers";
import type { LogFileInfo } from "../../lib/logViewer";

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
