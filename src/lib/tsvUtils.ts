import type { ChartPoint } from "../stores/visualizationStore";

export interface ParsedStatsFileName {
  metric?: string;
  tissue?: string;
  atlas?: string;
  pvc?: string;
}

/**
 * Parse ExploreASL Stats TSV filename into components.
 * Example: "mean_qCBF_GM_PV0.7_StandardSpace_Total_n=8_18-Jun-2026_PVC0.tsv"
 * Returns: { metric: "mean", tissue: "GM", atlas: "Total", pvc: "0" }
 */
export function parseStatsFileName(fileName: string): ParsedStatsFileName | null {
  const name = fileName.replace(/\.tsv$/i, "");

  const metricMatch = name.match(/^(\w+)_qCBF_/);
  const tissueMatch = name.match(/_qCBF_(GM|WM|WholeBrain|CBF)/i);
  const atlasMatch = name.match(/_StandardSpace_(\w+?)_/i);
  const pvcMatch = name.match(/_PVC(\d+)/i);

  if (!metricMatch && !tissueMatch) {
    return null;
  }

  return {
    metric: metricMatch?.[1],
    tissue: tissueMatch?.[1]?.toUpperCase(),
    atlas: atlasMatch?.[1],
    pvc: pvcMatch?.[1],
  };
}

/**
 * Transform raw TSV rows into nivo-ready ChartPoint objects.
 *
 * @param rows - Raw TSV row objects from read_tsv_columns
 * @param xCol - Column name for X axis
 * @param yCol - Column name for Y axis
 * @param colorByCol - Column name for color grouping (null if none)
 * @param columnTypes - Map of column name to type (continuous/ordinal/nominal/excluded)
 * @returns Array of ChartPoint objects
 */
export function transformToChartData(
  rows: Record<string, string>[],
  xCol: string,
  yCol: string,
  colorByCol: string | null,
  columnTypes: Record<string, string> = {},
): { points: ChartPoint[]; excluded: number } {
  const points: ChartPoint[] = [];
  let excluded = 0;

  for (const row of rows) {
    const participantId = row.participant_id ?? "";
    const subject = row.subject ?? "";
    const session = row.session ?? "";
    const run = row.run ?? "";

    const xRaw = row[xCol];
    const yRaw = row[yCol];

    if (isMissing(xRaw) || isMissing(yRaw)) {
      excluded++;
      continue;
    }

    const xVal = columnTypes[xCol] === "continuous" ? parseFloat(xRaw) : xRaw;
    const yVal = columnTypes[yCol] === "continuous" ? parseFloat(yRaw) : parseFloat(yRaw);

    if (isNaN(yVal)) {
      excluded++;
      continue;
    }

    const colorBy = colorByCol
      ? isMissing(row[colorByCol])
        ? "Unknown"
        : row[colorByCol]
      : undefined;

    points.push({
      x: isNaN(xVal as number) ? xRaw : (xVal as number),
      y: yVal,
      id: `${participantId}_${run}`,
      colorBy,
      participantId,
      subject,
      session,
      run,
    });
  }

  return { points, excluded };
}

function isMissing(val: string | undefined): boolean {
  if (val === undefined || val === null) return true;
  const v = val.trim();
  return (
    v === "" || v.toLowerCase() === "nan" || v.toLowerCase() === "na" || v.toLowerCase() === "n/a"
  );
}
