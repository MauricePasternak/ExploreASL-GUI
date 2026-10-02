import { describe, it, expect } from "vitest";
import { getQcMeasureLabel, QC_METRIC_LABELS } from "./qcLabels";

describe("qcLabels", () => {
  it("contains pre-defined metric entries in dictionary", () => {
    expect(Object.keys(QC_METRIC_LABELS).length).toBeGreaterThan(40);
    expect(QC_METRIC_LABELS["T1w_GM_ICV_Ratio"]).toBe(
      "Ratio of Gray Matter vs Intra-cortical Volume",
    );
  });
  it("translates known structural keys", () => {
    expect(getQcMeasureLabel("T1w_GM_ICV_Ratio")).toBe(
      "Ratio of Gray Matter vs Intra-cortical Volume",
    );
    expect(getQcMeasureLabel("T1w_GM_vol_mL")).toBe("Gray Matter Volume (mL)");
  });

  it("translates known ASL keys", () => {
    expect(getQcMeasureLabel("ASL_Coverage_Perc")).toBe("ASL Brain Coverage (%)");
    expect(getQcMeasureLabel("SpatialCoV_GM_Perc")).toBe(
      "Spatial Coefficient of Variation in Gray Matter (%)",
    );
    expect(getQcMeasureLabel("MotionMean_mm")).toBe("Mean Subject Motion (mm)");
  });

  it("translates known version/metadata keys", () => {
    expect(getQcMeasureLabel("Version_ExploreASL")).toBe("ExploreASL Version");
    expect(getQcMeasureLabel("ID")).toBe("Subject Session ID");
  });

  it("formats unknown keys as title case", () => {
    expect(getQcMeasureLabel("unknown_metric_key")).toBe("Unknown Metric Key");
    expect(getQcMeasureLabel("another_unknown_key")).toBe("Another Unknown Key");
  });
});
