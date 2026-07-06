import { describe, it, expect } from "vitest";
import {
  BidsAslMetadataSchema,
  BidsAslMetadataBaseSchema,
  MetadataGroup,
  SubjectRow,
  DerivedMetadataGroup,
} from "./schema";

describe("schema re-exports", () => {
  it("exports BidsAslMetadataSchema", () => {
    expect(BidsAslMetadataSchema).toBeDefined();
    expect(typeof BidsAslMetadataSchema.parse).toBe("function");
  });

  it("exports BidsAslMetadataBaseSchema", () => {
    expect(BidsAslMetadataBaseSchema).toBeDefined();
    expect(typeof BidsAslMetadataBaseSchema.parse).toBe("function");
  });

  it("BidsAslMetadataBaseSchema parses valid minimal ASL metadata", () => {
    const result = BidsAslMetadataBaseSchema.safeParse({
      ArterialSpinLabelingType: "PCASL",
      PostLabelingDelay: 1.8,
      MRAcquisitionType: "3D",
      MagneticFieldStrength: 3,
      Manufacturer: "Siemens",
      PulseSequenceType: "3D_SPIRAL",
      ASLContext: "m0scan,label,control",
      BackgroundSuppression: false,
    });
    expect(result.success).toBe(true);
  });

  it("MetadataGroup type is importable (compile-time check)", () => {
    // Type-only import; runtime value is not needed.
    // This test exists to verify the re-export resolves.
    const _check: MetadataGroup = {
      id: "test",
      label: "Test Group",
      bidsParams: {},
    };
    expect(_check.id).toBe("test");
  });

  it("SubjectRow type is importable (compile-time check)", () => {
    const _check: SubjectRow = {
      id: "sub-01/1",
      subject: "sub-01",
      session: "1",
      groupId: "group-1",
    };
    expect(_check.id).toBe("sub-01/1");
  });

  it("DerivedMetadataGroup type is importable (compile-time check)", () => {
    const _check: DerivedMetadataGroup = {
      id: "test",
      label: "Test",
      bidsParams: {},
      vendor: "Siemens",
      sequence: "3D_SPIRAL",
      labelingType: "PCASL",
      subjects: [],
    };
    expect(_check.vendor).toBe("Siemens");
  });
});
