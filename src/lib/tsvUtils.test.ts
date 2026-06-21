import { describe, it, expect } from "vitest";
import { parseStatsFileName, transformToChartData } from "./tsvUtils";

describe("parseStatsFileName", () => {
  it("parses ROI stats filename", () => {
    const result = parseStatsFileName(
      "mean_qCBF_GM_PV0.7_StandardSpace_Total_n=8_18-Jun-2026_PVC0.tsv",
    );
    expect(result?.metric).toBe("mean");
    expect(result?.tissue).toBe("GM");
    expect(result?.atlas).toBe("Total");
    expect(result?.pvc).toBe("0");
  });

  it("returns null for unparseable filename", () => {
    expect(parseStatsFileName("QC_RMS.tsv")).toBeNull();
  });

  it("parses WM tissue", () => {
    const result = parseStatsFileName("mean_qCBF_WM_PV0.95_StandardSpace_Total_n=5_PVC0.tsv");
    expect(result?.tissue).toBe("WM");
  });
});

describe("transformToChartData", () => {
  const columnTypes = { GM_vol: "continuous", Site: "nominal" };

  it("transforms rows to chart points", () => {
    const rows = [
      {
        participant_id: "sub-X_01",
        subject: "sub-X",
        session: "01",
        run: "ASL_1",
        GM_vol: "0.64",
        Site: "1",
      },
      {
        participant_id: "sub-X_02",
        subject: "sub-X",
        session: "02",
        run: "ASL_1",
        GM_vol: "0.68",
        Site: "2",
      },
    ];
    const { points, excluded } = transformToChartData(rows, "Site", "GM_vol", null, columnTypes);
    expect(points).toHaveLength(2);
    expect(excluded).toBe(0);
    expect(points[0].y).toBe(0.64);
  });

  it("excludes rows with missing Y values", () => {
    const rows = [
      {
        participant_id: "sub-X_01",
        subject: "sub-X",
        session: "01",
        run: "ASL_1",
        GM_vol: "0.64",
        Site: "1",
      },
      {
        participant_id: "sub-X_02",
        subject: "sub-X",
        session: "02",
        run: "ASL_1",
        GM_vol: "",
        Site: "2",
      },
    ];
    const { points, excluded } = transformToChartData(rows, "Site", "GM_vol", null, columnTypes);
    expect(points).toHaveLength(1);
    expect(excluded).toBe(1);
  });

  it("generates composite id from participantId + run", () => {
    const rows = [
      {
        participant_id: "sub-X_01",
        subject: "sub-X",
        session: "01",
        run: "ASL_1",
        GM_vol: "0.64",
        Site: "1",
      },
    ];
    const { points } = transformToChartData(rows, "Site", "GM_vol", null, columnTypes);
    expect(points[0].id).toBe("sub-X_01_ASL_1");
  });

  it("assigns colorBy from categorical column", () => {
    const rows = [
      {
        participant_id: "sub-X_01",
        subject: "sub-X",
        session: "01",
        run: "ASL_1",
        GM_vol: "0.64",
        Site: "Site_A",
      },
    ];
    const { points } = transformToChartData(rows, "Site", "GM_vol", "Site", columnTypes);
    expect(points[0].colorBy).toBe("Site_A");
  });

  it("groups missing colorBy as Unknown", () => {
    const rows = [
      {
        participant_id: "sub-X_01",
        subject: "sub-X",
        session: "01",
        run: "ASL_1",
        GM_vol: "0.64",
        Site: "1",
        Group: "",
      },
    ];
    const { points } = transformToChartData(rows, "Site", "GM_vol", "Group", {
      ...columnTypes,
      Group: "nominal",
    });
    expect(points[0].colorBy).toBe("Unknown");
  });
});
