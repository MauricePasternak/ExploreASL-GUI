import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formatBidsScanValidationError } from "./errorFormatter";

describe("formatBidsScanValidationError", () => {
  const mockGroups = [{ label: "Group Siemens 3D" }, { label: "Group Philips 2D" }];

  it("formats error in bidsParams with group label", () => {
    const schema = z.object({
      bidsParams: z.object({
        LabelingType: z.enum(["PASL", "CASL"]),
      }),
    });

    const result = z.array(schema).safeParse([{ bidsParams: { LabelingType: "PCASL" } }]);

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatBidsScanValidationError(result.error, mockGroups);
      expect(formatted).toContain("BIDS scanner validation failed:");
      expect(formatted).toContain(
        'Field "LabelingType" in group "Group Siemens 3D": Invalid option: expected one of "PASL"|"CASL"',
      );
    }
  });

  it("formats error in sub-path with group label", () => {
    const schema = z.object({
      subjects: z.array(
        z.object({
          subjectLabel: z.string().min(3),
        }),
      ),
    });

    const result = z.array(schema).safeParse([{ subjects: [{ subjectLabel: "s1" }] }]);

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatBidsScanValidationError(result.error, mockGroups);
      expect(formatted).toContain("BIDS scanner validation failed:");
      expect(formatted).toContain(
        'Group "Group Siemens 3D" (path: subjects.0.subjectLabel): Too small: expected string to have >=3 characters',
      );
    }
  });

  it("handles empty path or other paths gracefully", () => {
    const schema = z.string();
    const result = z.array(schema).safeParse([123]);

    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatBidsScanValidationError(result.error, mockGroups);
      expect(formatted).toContain("BIDS scanner validation failed:");
      expect(formatted).toContain(
        'Group "Group Siemens 3D" (path: ): Invalid input: expected string, received number',
      );
    }
  });
});
