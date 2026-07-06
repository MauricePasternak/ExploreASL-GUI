import { describe, expect, it } from "vitest";
import type { DerivedMetadataGroup } from "../../schemas/importSchemas";
import { flattenBidsGroupsToSubjectRows, stripSubjectPrefix } from "./subjectRows";

describe("stripSubjectPrefix", () => {
  it("strips sub- prefix", () => {
    expect(stripSubjectPrefix("sub-01")).toBe("01");
    expect(stripSubjectPrefix("01")).toBe("01");
  });
});

describe("flattenBidsGroupsToSubjectRows", () => {
  const baseGroup = (overrides: Partial<DerivedMetadataGroup>): DerivedMetadataGroup => ({
    id: "g1",
    label: "Siemens_3T_PCASL_3D_Included",
    bidsParams: {
      ArterialSpinLabelingType: "PCASL",
      MRAcquisitionType: "3D",
      PostLabelingDelay: [1.8],
      MagneticFieldStrength: 3,
      Manufacturer: "Siemens",
      ASLContext: "control,label",
      M0Type: "Included",
      LabelingDuration: 1.8,
      BackgroundSuppression: false,
    },
    vendor: "Siemens",
    sequence: "3D_SPIRAL",
    labelingType: "CASL",
    subjects: [{ subjectLabel: "sub-01", sessionLabels: ["1"] }],
    ...overrides,
  });

  it("maps Rust SidecarGroup payload to SubjectRow contract", () => {
    const rows = flattenBidsGroupsToSubjectRows([
      baseGroup({
        subjects: [
          { subjectLabel: "sub-01", sessionLabels: ["1"] },
          { subjectLabel: "sub-02", sessionLabels: ["1"] },
        ],
      }),
    ]);

    expect(rows).toEqual([
      { id: "sub-01_1", subject: "01", session: "1", groupId: "g1" },
      { id: "sub-02_1", subject: "02", session: "1", groupId: "g1" },
    ]);
  });

  it("merges duplicate subject entries with multiple sessions", () => {
    const rows = flattenBidsGroupsToSubjectRows([
      baseGroup({
        subjects: [{ subjectLabel: "sub-01", sessionLabels: ["01", "02"] }],
      }),
    ]);

    expect(rows).toEqual([
      { id: "sub-01_01", subject: "01", session: "01", groupId: "g1" },
      { id: "sub-01_02", subject: "01", session: "02", groupId: "g1" },
    ]);
  });

  it("supports multiple groups with different groupId", () => {
    const rows = flattenBidsGroupsToSubjectRows([
      baseGroup({ id: "g1", subjects: [{ subjectLabel: "sub-01", sessionLabels: ["1"] }] }),
      baseGroup({ id: "g2", subjects: [{ subjectLabel: "sub-02", sessionLabels: ["1"] }] }),
    ]);

    expect(rows.find((r) => r.subject === "01")?.groupId).toBe("g1");
    expect(rows.find((r) => r.subject === "02")?.groupId).toBe("g2");
  });

  it("allows same subjectLabel in two groups with DIFFERENT session labels", () => {
    const rows = flattenBidsGroupsToSubjectRows([
      baseGroup({ id: "g1", subjects: [{ subjectLabel: "sub-01", sessionLabels: ["1"] }] }),
      baseGroup({ id: "g2", subjects: [{ subjectLabel: "sub-01", sessionLabels: ["2"] }] }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ id: "sub-01_1", subject: "01", session: "1", groupId: "g1" });
    expect(rows).toContainEqual({ id: "sub-01_2", subject: "01", session: "2", groupId: "g2" });
  });

  it("throws on cross-group same subject-session collision", () => {
    expect(() =>
      flattenBidsGroupsToSubjectRows([
        baseGroup({ id: "g1", subjects: [{ subjectLabel: "sub-01", sessionLabels: ["1"] }] }),
        baseGroup({ id: "g2", subjects: [{ subjectLabel: "sub-01", sessionLabels: ["1"] }] }),
      ]),
    ).toThrow(/duplicate subject-session.*sub-01_1.*across groups/i);
  });
});
