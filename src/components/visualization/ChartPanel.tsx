import { useEffect, useMemo } from "react";
import { Stack, Text } from "@mantine/core";
import { useMantineColorScheme } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { ResponsiveScatterPlotCanvas } from "@nivo/scatterplot";
import { ResponsiveSwarmPlotCanvas } from "@nivo/swarmplot";

import { useVisualizationStore } from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";
import { transformToChartData, translateColumnName } from "../../lib/tsvUtils";
import { OKABE_ITO } from "../../lib/okabeIto";
import { buildNivoTheme } from "../../lib/nivoTheme";
import { invoke } from "@tauri-apps/api/core";

function computeLinearScaleBounds(
  values: number[],
  filterMin: number | null,
  filterMax: number | null,
  paddingPercent = 0.05,
) {
  if (values.length === 0) {
    return {
      min: filterMin !== null ? filterMin : ("auto" as const),
      max: filterMax !== null ? filterMax : ("auto" as const),
    };
  }

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal;

  if (range === 0) {
    const pad = minVal === 0 ? 1 : Math.abs(minVal) * 0.1;
    return {
      min: filterMin !== null ? filterMin : minVal - pad,
      max: filterMax !== null ? filterMax : minVal + pad,
    };
  }

  const pad = range * paddingPercent;
  return {
    min: filterMin !== null ? filterMin : minVal - pad,
    max: filterMax !== null ? filterMax : maxVal + pad,
  };
}

export default function ChartPanel() {
  const axisAssignment = useVisualizationStore((s) => s.axisAssignment);
  const columnTypes = useVisualizationStore((s) => s.columnTypes);
  const inspection = useVisualizationStore((s) => s.inspection);
  const contractSources = useVisualizationStore((s) => s.contractSources);
  const chartData = useVisualizationStore((s) => s.chartData);
  const setChartData = useVisualizationStore((s) => s.setChartData);
  const selectPoint = useVisualizationStore((s) => s.selectPoint);
  const setExclusionCount = useVisualizationStore((s) => s.setExclusionCount);
  const domainFilters = useVisualizationStore((s) => s.domainFilters);
  const exclusionCount = useVisualizationStore((s) => s.exclusionCount);

  // New settings
  const pointSize = useVisualizationStore((s) => s.pointSize);
  const swarmSpacing = useVisualizationStore((s) => s.swarmSpacing);
  const chartOpacity = useVisualizationStore((s) => s.chartOpacity);
  const showGridX = useVisualizationStore((s) => s.showGridX);
  const showGridY = useVisualizationStore((s) => s.showGridY);

  const xTickSize = useVisualizationStore((s) => s.xTickSize);
  const xTickPadding = useVisualizationStore((s) => s.xTickPadding);
  const xTickRotation = useVisualizationStore((s) => s.xTickRotation);
  const xLegendOverride = useVisualizationStore((s) => s.xLegendOverride);
  const xLegendOffset = useVisualizationStore((s) => s.xLegendOffset);

  const yTickSize = useVisualizationStore((s) => s.yTickSize);
  const yTickPadding = useVisualizationStore((s) => s.yTickPadding);
  const yTickRotation = useVisualizationStore((s) => s.yTickRotation);
  const yLegendOverride = useVisualizationStore((s) => s.yLegendOverride);
  const yLegendOffset = useVisualizationStore((s) => s.yLegendOffset);

  const project = useProjectStore((s) => s.project);
  const { colorScheme } = useMantineColorScheme();
  const { ref: chartContainerRef, width: chartWidth } = useElementSize();

  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const xCol = axisAssignment.x;
  const yCol = axisAssignment.y;
  const colorByCol = axisAssignment.colorBy;

  const xType = xCol
    ? (columnTypes[xCol] ?? inspection?.columns.find((c) => c.name === xCol)?.inferredType)
    : null;
  const yType = yCol
    ? (columnTypes[yCol] ?? inspection?.columns.find((c) => c.name === yCol)?.inferredType)
    : null;

  const isScatter = xType === "continuous" && yType === "continuous";
  const isUnsupported = yType !== "continuous" && yType !== null;

  const projectRoot = project?.projectMeta.rootPath;
  const fileSourcePath = contractSources[0]?.relativePath;
  const fileSourceHash = contractSources[0]?.fileHash;
  const columnTypesSerialized = JSON.stringify(columnTypes);

  useEffect(() => {
    async function loadData() {
      if (!projectRoot || !xCol || !yCol || !fileSourcePath) return;
      const columnsToFetch = [xCol, yCol];
      if (colorByCol && !columnsToFetch.includes(colorByCol)) columnsToFetch.push(colorByCol);
      try {
        const rows = await invoke<Record<string, string>[]>("read_tsv_columns", {
          projectRoot,
          relativePath: fileSourcePath,
          columnNames: columnsToFetch,
        });
        const { points, excluded } = transformToChartData(
          rows,
          xCol,
          yCol,
          colorByCol,
          columnTypes,
        );
        setChartData(points);
        setExclusionCount({ plotted: points.length, excluded });
      } catch (err) {
        console.error("Failed to load chart data:", err);
      }
    }
    loadData();
  }, [
    xCol,
    yCol,
    colorByCol,
    fileSourcePath,
    fileSourceHash,
    columnTypesSerialized,
    projectRoot,
    setChartData,
    setExclusionCount,
  ]);

  // Reset selected point only when axes or file sources change
  useEffect(() => {
    selectPoint(null);
  }, [xCol, yCol, colorByCol, fileSourcePath, selectPoint]);

  const filteredData = useMemo(() => {
    let data = chartData;
    if (domainFilters.xMin !== null)
      data = data.filter((p) => typeof p.x === "number" && p.x >= domainFilters.xMin!);
    if (domainFilters.xMax !== null)
      data = data.filter((p) => typeof p.x === "number" && p.x <= domainFilters.xMax!);
    if (domainFilters.yMin !== null) data = data.filter((p) => p.y >= domainFilters.yMin!);
    if (domainFilters.yMax !== null) data = data.filter((p) => p.y <= domainFilters.yMax!);
    return data;
  }, [chartData, domainFilters]);

  const colorByValues = useMemo(() => {
    if (!colorByCol) return [];
    return Array.from(new Set(filteredData.map((p) => p.colorBy).filter(Boolean)));
  }, [filteredData, colorByCol]);

  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    colorByValues.forEach((val, idx) => {
      map[val!] = OKABE_ITO[idx % OKABE_ITO.length];
    });
    return map;
  }, [colorByValues]);

  const nivoTheme = useMemo(() => buildNivoTheme(colorScheme), [colorScheme]);

  const isCompactChart = chartWidth > 0 && chartWidth < 520;
  const chartMargin = useMemo(
    () => ({
      top: 20,
      right: 20,
      bottom: isCompactChart ? 80 : 60,
      left: 70,
    }),
    [isCompactChart],
  );
  const axisBottomConfig = useMemo(
    () => ({
      legend:
        xLegendOverride !== null && xLegendOverride !== ""
          ? xLegendOverride
          : xCol
            ? translateColumnName(xCol)
            : "",
      legendOffset: xLegendOffset,
      legendPosition: "middle" as const,
      tickSize: xTickSize,
      tickPadding: xTickPadding,
      tickRotation: xTickRotation,
    }),
    [xCol, xLegendOverride, xLegendOffset, xTickSize, xTickPadding, xTickRotation],
  );

  const axisLeftConfig = useMemo(
    () => ({
      legend:
        yLegendOverride !== null && yLegendOverride !== ""
          ? yLegendOverride
          : yCol
            ? translateColumnName(yCol)
            : "",
      legendOffset: yLegendOffset,
      legendPosition: "middle" as const,
      tickSize: yTickSize,
      tickPadding: yTickPadding,
      tickRotation: yTickRotation,
    }),
    [yCol, yLegendOverride, yLegendOffset, yTickSize, yTickPadding, yTickRotation],
  );

  const xScaleConfig = useMemo(() => {
    const xValues = filteredData.map((p) => p.x).filter((x): x is number => typeof x === "number");
    return {
      type: "linear" as const,
      ...computeLinearScaleBounds(xValues, domainFilters.xMin, domainFilters.xMax),
    };
  }, [filteredData, domainFilters.xMin, domainFilters.xMax]);

  const yScaleConfig = useMemo(() => {
    const yValues = filteredData.map((p) => p.y).filter((y): y is number => typeof y === "number");
    return {
      type: "linear" as const,
      ...computeLinearScaleBounds(yValues, domainFilters.yMin, domainFilters.yMax),
    };
  }, [filteredData, domainFilters.yMin, domainFilters.yMax]);

  if (!xCol || !yCol) {
    return (
      <Stack data-testid="chart-panel" align="center" justify="center" h="100%">
        <Text c="dimmed">
          {!xCol && !yCol
            ? "Select X and Y columns to begin."
            : "Assign both X and Y to render the chart."}
        </Text>
      </Stack>
    );
  }

  if (isUnsupported) {
    return (
      <Stack data-testid="chart-panel" align="center" justify="center" h="100%">
        <Text c="dimmed">
          Unsupported combination. Use continuous×continuous (scatter) or continuous×categorical
          (swarm).
        </Text>
      </Stack>
    );
  }

  if (filteredData.length === 0) {
    return (
      <Stack data-testid="chart-panel" align="center" justify="center" h="100%">
        <Text c="dimmed">No plottable data. Selected columns have no valid values.</Text>
      </Stack>
    );
  }

  const nivoData = colorByCol
    ? colorByValues.map((group) => ({
        id: group ?? "Unknown",
        data: filteredData
          .filter((p) => p.colorBy === group)
          .map((p) => ({ ...p, x: p.x, y: p.y })),
      }))
    : [
        {
          id: "data",
          data: filteredData.map((p) => ({ ...p, x: p.x, y: p.y })),
        },
      ];

  function handleClick(node: any) {
    console.log("[ChartPanel] Clicked node:", node);
    const data = node?.data;
    if (!data) {
      console.warn("[ChartPanel] Clicked node has no data property:", node);
      return;
    }
    const pointId = data.id;
    console.log("[ChartPanel] Clicked point ID:", pointId);
    if (pointId) {
      selectPoint(pointId);
      console.log("[ChartPanel] Selected point ID set in store:", pointId);
    } else {
      console.error("[ChartPanel] Clicked node data does not have an id field:", data);
    }
  }

  function renderTooltipContent(data: any) {
    const subject = data.subject ?? "";
    const session = data.session ?? "";
    const run = data.run ?? "";
    const xVal = data.x ?? "";
    const yVal = data.y ?? "";
    const hueVal = data.colorBy ?? "";

    return (
      <div
        style={{
          background: colorScheme === "dark" ? "#2e2e2e" : "#ffffff",
          color: colorScheme === "dark" ? "#ffffff" : "#000000",
          padding: "8px 12px",
          border: "1px solid rgba(128,128,128,0.3)",
          borderRadius: "4px",
          fontSize: "12px",
          lineHeight: "1.4",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          zIndex: 100,
        }}
      >
        <div>
          <strong>Subject:</strong> {subject}
        </div>
        <div>
          <strong>Session:</strong> {session}
        </div>
        <div>
          <strong>Run:</strong> {run}
        </div>
        <div>
          <strong>X:</strong> {xVal}
        </div>
        <div>
          <strong>Y:</strong> {yVal}
        </div>
        {colorByCol && (
          <div>
            <strong>Hue:</strong> {hueVal}
          </div>
        )}
      </div>
    );
  }

  function renderScatterTooltip({ node }: { node: any }) {
    return renderTooltipContent(node.data);
  }

  function renderSwarmTooltip(props: any) {
    return renderTooltipContent(props.data);
  }

  return (
    <Stack data-testid="chart-panel" h="100%" gap={0} style={{ overflow: "visible" }}>
      <Text size="xs" c="dimmed" px="sm" py={4}>
        {filteredData.length} points plotted
        {chartData.length !== filteredData.length &&
          ` (${chartData.length - filteredData.length} filtered out by domain filters)`}
        {exclusionCount.excluded > 0 &&
          ` (${exclusionCount.excluded} rows excluded due to missing data)`}
      </Text>
      <div
        ref={chartContainerRef}
        style={{
          flex: 1,
          minHeight: 280,
          minWidth: 0,
          width: "100%",
          position: "relative",
          overflow: "visible",
        }}
      >
        {isScatter ? (
          <ResponsiveScatterPlotCanvas
            data={nivoData}
            theme={nivoTheme}
            colors={
              colorByCol
                ? colorByValues.map((v) => hexToRgba(colorMap[v!], chartOpacity))
                : [hexToRgba(OKABE_ITO[0], chartOpacity)]
            }
            nodeSize={pointSize}
            onClick={handleClick}
            axisBottom={axisBottomConfig}
            axisLeft={axisLeftConfig}
            axisTop={null}
            margin={chartMargin}
            useMesh={true}
            tooltip={renderScatterTooltip}
            xScale={xScaleConfig}
            yScale={yScaleConfig}
            enableGridX={showGridX}
            enableGridY={showGridY}
          />
        ) : (
          <ResponsiveSwarmPlotCanvas
            data={filteredData.map((p) => ({
              ...p,
              group: p.x as string,
              value: p.y,
            }))}
            groups={Array.from(new Set(filteredData.map((p) => p.x as string)))}
            theme={nivoTheme}
            colors={(node: any) => {
              const colorByVal = node.data?.colorBy;
              if (colorByCol && colorByVal && colorMap[colorByVal]) {
                return hexToRgba(colorMap[colorByVal], chartOpacity);
              }
              return hexToRgba(OKABE_ITO[0], chartOpacity);
            }}
            value="value"
            groupBy="group"
            size={pointSize}
            spacing={swarmSpacing}
            onClick={handleClick}
            axisBottom={axisBottomConfig}
            axisLeft={axisLeftConfig}
            axisTop={null}
            margin={chartMargin}
            tooltip={renderSwarmTooltip}
            valueScale={yScaleConfig}
            enableGridX={showGridX}
            enableGridY={showGridY}
          />
        )}
      </div>
    </Stack>
  );
}
