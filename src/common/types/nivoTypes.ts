import { Path, PathValue } from "react-hook-form";

export type NivoHeatmapSingleCell = { x: number | string; y: number };
export type NivoHeatmapRow = { id: string; data: NivoHeatmapSingleCell[] };
export type NivoHeatmapData = NivoHeatmapRow[];

export type NivoThemeProps = {
  axisTickWidth: number;
  axisTickColor: string;
  axisTickLabelFontSize: number;
  axisTickLabelFontColor?: string;
  axisSpineWidth: number;
  axisSpineColor?: string;
  axisLegendTextFontSize: number;
  axisLegendTextColor?: string;

  gridLineWidth: number;
};

export type NivoSingleAxisProps = {
  tickHeight: number;
  tickLabelPadding: number;
  tickLabelRotation: number;
  axisLabelText: string;
  axisLabelTextOffset: number;
};

export type NivoSwarmPlotProps = {
  plotLayout: "horizontal" | "vertical";
  margins: { top: number; right: number; bottom: number; left: number };
  interSeriesGap: number;
  colorScheme: NivoColorPaletteNameType

  nodeSize: number;
  nodeBorderWidth: number;
  interNodeSpacing: number;

  enableGridX: boolean;
  enableGridY: boolean;

  axisBottom: NivoSingleAxisProps;
  axisLeft: NivoSingleAxisProps;

  theme: NivoThemeProps;
};

export type NivoSwarmPlotUpdateOp<
  TPath extends Path<NivoSwarmPlotProps> = Path<NivoSwarmPlotProps>,
  TValue = PathValue<NivoSwarmPlotProps, TPath>
> = {
  path: TPath;
  value: TValue;
};

export type NivoScatterPlotProps = {
  margins: { top: number; right: number; bottom: number; left: number };
  colorScheme: NivoColorPaletteNameType

  nodeSize: number;

  enableGridX: boolean;
  enableGridY: boolean;

  axisBottom: NivoSingleAxisProps;
  axisLeft: NivoSingleAxisProps;
  theme: NivoThemeProps;
};

export type NivoScatterPlotUpdateOp<
  TPath extends Path<NivoScatterPlotProps> = Path<NivoScatterPlotProps>,
  TValue = PathValue<NivoScatterPlotProps, TPath>
> = {
  path: TPath;
  value: TValue;
};

export type NivoColorPaletteNameType =
  | "nivo"
  | "category10"
  | "accent"
  | "dark2"
  | "paired"
  | "pastel1"
  | "pastel2"
  | "set1"
  | "set2"
  | "set3"
  | "brown_blueGreen"
  | "purpleRed_green"
  | "pink_yellowGreen"
  | "purple_orange"
  | "red_blue"
  | "red_grey"
  | "red_yellow_blue"
  | "red_yellow_green"
  | "spectral"
  | "blues"
  | "greens"
  | "greys"
  | "oranges"
  | "purples"
  | "reds"
  | "blue_green"
  | "blue_purple"
  | "green_blue"
  | "orange_red"
  | "purple_blue"
  | "purple_red"
  | "red_purple"
  | "yellow_green_blue"
  | "yellow_green"
  | "yellow_orange_brown"
  | "yellow_orange_red";
