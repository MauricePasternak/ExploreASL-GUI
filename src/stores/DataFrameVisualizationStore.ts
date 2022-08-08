import { DataFrame } from "data-forge";
import { atom, PrimitiveAtom } from "jotai";
import { set as lodashSet } from "lodash";
import {
  DataFrameChangeDtypeOp,
  DataFrameDTypeMainMapping,
  DataFrameMainType,
  predicateFormula,
} from "../common/types/dataFrameTypes";
import { LoadEASLDataFrameSchema, NivoGraphType, NivoPlotVariablesSchema } from "../common/types/DataVizSchemaTypes";
import {
  NivoHeatmapData,
  NivoLegendProps,
  NivoScatterPlotProps,
  NivoScatterPlotUpdateOp,
  NivoSwarmPlotProps,
  NivoSwarmPlotUpdateOp,
} from "../common/types/nivoTypes";
import { isNumericSeries, query, toNumericSeries, toStringSeries } from "../common/utilityFunctions/dataFrameFunctions";

export const DataFrameMainTypeOptions: DataFrameMainType[] = ["Categorical", "Continuous", "Ignore"];

/**
 * Atom for the current step of the data frame visualization wizard.
 */
export const atomDataVizCurrentStep = atom<"DefinePaths" | "DefineDTypes" | "Plotting">("DefinePaths");

export const loadDataFrameDataVizDefaults: LoadEASLDataFrameSchema = {
  StudyRootPath: "",
  Atlases: ["TotalGM"],
  Statistic: "mean",
  PVC: "PVC2",
  MetadataPath: "",
};

export const atomDataVizLoadSettings = atom(loadDataFrameDataVizDefaults);

/**
 * Atom for the dataframe used for data visualization.
 */
export const atomDataVizDF = atom<DataFrame>(new DataFrame([]));

/**
 * Atom for the dtypes of the main dataframe used for data visualization.
 */
export const atomDataVizDFDTypes = atom<DataFrameDTypeMainMapping>({});

/**
 * Setter atom used to change the dataframe & dtypes in the step where the user clarifies the dataframe's dtypes.
 */
export const atomSetDataVizDF = atom(null, (get, set, update: DataFrameChangeDtypeOp) => {
  const df = get(atomDataVizDF);
  const dtypes = get(atomDataVizDFDTypes);

  console.log("atomSetDataVizDF -- df: ", df.toArray());
  console.log("atomSetDataVizDF -- dtypes: ", dtypes);
  console.log("atomSetDataVizDF -- update: ", update);

  // Early exit if the dataframe is null or the column doesn't exist within it
  if (!df || !dtypes || !df.getColumnNames().includes(update.col)) return;

  const series = df.getSeries(update.col);
  if (update.mainDtype === "Categorical") {
    const newSeries = toStringSeries(series);
    set(atomDataVizDF, new DataFrame(df.withSeries({ [update.col]: newSeries }).toArray()));
    set(atomDataVizDFDTypes, { ...dtypes, [update.col]: "Categorical" });
  } else if (update.mainDtype === "Continuous") {
    const numericType = isNumericSeries(series);
    if (!numericType) return;
    const newSeries = toNumericSeries(series, numericType);
    set(atomDataVizDF, new DataFrame(df.withSeries({ [update.col]: newSeries }).toArray()));
    set(atomDataVizDFDTypes, { ...dtypes, [update.col]: "Continuous" });
  } else {
    set(atomDataVizDFDTypes, { ...dtypes, [update.col]: "Ignore" });
  }
});

/**
 * Atom for the subset operations that should be used to subset the dataframe of interest
 */
export const atomOfAtomsDataVizSubsetOperations = atom<PrimitiveAtom<predicateFormula>[]>([]);

export const atomSetAddPredicate = atom(null, (get, set) => {
  const predicates = get(atomOfAtomsDataVizSubsetOperations);
  set(atomOfAtomsDataVizSubsetOperations, [
    ...predicates,
    atom<predicateFormula>({
      funcName: "eq",
      col: "",
      val: "",
    }),
  ]);
});

export const atomSetRemovePredicate = atom(null, (get, set, index: number) => {
  const predicates = get(atomOfAtomsDataVizSubsetOperations);
  set(
    atomOfAtomsDataVizSubsetOperations,
    predicates.filter((_, i) => i !== index)
  );
});

/**
 * Derived getter atom specifically meant for the dataframe used for data visualization.
 * USE THIS WHEN USING NIVO, NOT THE MAIN ATOMDATAVIZDF.
 */
export const atomDataVizSubsetDF = atom<DataFrame>(get => {
  let df = get(atomDataVizDF);
  const operations = get(atomOfAtomsDataVizSubsetOperations).map(atomOp => get(atomOp));
  if (operations.length === 0) return df;

  const columnNames = df.getColumnNames();
  const commonFuncs = ["eq", "ne"];
  const numericFuncs = ["gt", "lt", "ge", "le"];
  const categoricalFuncs = ["includes", "excludes"];
  const allFuncs = [...commonFuncs, ...numericFuncs, ...categoricalFuncs];

  const filteredOps = operations.filter(op => {
    if (!columnNames.includes(op.col) || !allFuncs.includes(op.funcName) || op.val === "") return false;

    // Value must be consistent with the expected type of the column
    if (numericFuncs.includes(op.funcName) && (op.val == null || op.val == "" || isNaN(op.val))) return false;
    if (categoricalFuncs.includes(op.funcName) && (op.val == null || op.val == "")) return false;

    return true;
  });

  console.log("atomDataVizSubsetDF -- filteredOps: ", filteredOps);

  if (filteredOps.length === 0) return df;
  return new DataFrame(query(df, filteredOps).toArray());
});

/**
 * Atom for the nivo graph type.
 */
export const atomNivoGraphType = atom<NivoGraphType>("Scatterplot");

export const defaultNivoGraphDataVariablesSchema = {
  YAxisVar: "",
  XAxisVar: "",
  GroupingVar: "",
  HoverVariables: [] as string[],
};

/**
 * Atom for the nivo plot variables schema.
 */
export const atomNivoGraphDataVariablesSchema = atom<NivoPlotVariablesSchema>(defaultNivoGraphDataVariablesSchema);

export const atomCurrentMRIViewSubject = atom<string>("");
export const atomMRIDataStats = atom<{ max: number; min: number }>({ max: 0, min: 0 });
export const atomOfAtomMRIData = atom<
  [PrimitiveAtom<NivoHeatmapData[]>, PrimitiveAtom<NivoHeatmapData[]>, PrimitiveAtom<NivoHeatmapData[]>]
>([atom([]), atom([]), atom([])]);

export const atomOfAtomMRISlices = atom<[PrimitiveAtom<number>, PrimitiveAtom<number>, PrimitiveAtom<number>]>([
  atom(48), // axial
  atom(80), // coronal
  atom(60), // sagittal
]);

export const atomCurrentAxialSlice = atom<number>(48);
export const atomCurrentCoronalSlice = atom<number>(84);
export const atomCurrentSagittalSlice = atom<number>(60);

export const atomEASLSwarmplotSettings = atom<NivoSwarmPlotProps>({
  plotLayout: "vertical",
  margins: { top: 40, right: 50, bottom: 60, left: 90 },
  interSeriesGap: 0,
  colorScheme: "nivo",

  nodeSize: 10,
  nodeBorderWidth: 1,
  interNodeSpacing: 2,

  enableGridX: false,
  enableGridY: true,

  axisBottom: {
    tickHeight: 10,
    tickLabelPadding: 5,
    tickLabelRotation: 0,
    axisLabelText: "",
    axisLabelTextOffset: 46,
  },

  axisLeft: {
    tickHeight: 10,
    tickLabelPadding: 5,
    tickLabelRotation: 0,
    axisLabelText: "",
    axisLabelTextOffset: -76,
  },

  theme: {
    axisTickWidth: 2,
    axisTickColor: "#777",

    axisTickLabelFontSize: 12,
    axisTickLabelFontColor: "#333",

    axisSpineWidth: 2,
    axisSpineColor: "#777",

    axisLegendTextFontSize: 16,
    axisLegendTextColor: "#333",

    gridLineWidth: 1,

    legendTextFontSize: 14,
  },
});

export const atomSetEASLSwarmplotSettings = atom(null, (get, set, update: NivoSwarmPlotUpdateOp) => {
  const settings = get(atomEASLSwarmplotSettings);
  const newSettings = lodashSet(settings, update.path, update.value);
  set(atomEASLSwarmplotSettings, { ...newSettings }); // Needs a copy...why?
});

const EASLScatterPlotLegend: NivoLegendProps = {
  anchor: "right",
  direction: "column",
  justify: false,
  translateX: 130,
  translateY: 0,
  itemsSpacing: 5,
  symbolSize: 12,
  itemWidth: 100,
  itemHeight: 12,
  itemDirection: "left-to-right",
  symbolShape: "square",
  effects: [
    {
      on: "hover",
      style: {
        itemOpacity: 0.7,
      },
    },
  ],
};

export const atomEASLScatterplotSettings = atom<NivoScatterPlotProps>({
  margins: { top: 40, right: 130, bottom: 60, left: 90 },
  colorScheme: "nivo",

  nodeSize: 10,

  enableGridX: false,
  enableGridY: true,

  axisBottom: {
    tickHeight: 10,
    tickLabelPadding: 5,
    tickLabelRotation: 0,
    axisLabelText: "",
    axisLabelTextOffset: 46,
  },

  axisLeft: {
    tickHeight: 10,
    tickLabelPadding: 5,
    tickLabelRotation: 0,
    axisLabelText: "",
    axisLabelTextOffset: -76,
  },

  theme: {
    axisTickWidth: 2,
    axisTickColor: "#777",

    axisTickLabelFontSize: 12,
    axisTickLabelFontColor: "#333",

    axisSpineWidth: 2,
    axisSpineColor: "#777",

    axisLegendTextFontSize: 16,
    axisLegendTextColor: "#333",

    gridLineWidth: 1,

    legendTextFontSize: 18,
  },
  legends: [EASLScatterPlotLegend],
});

export const atomSetEASLScatterplotSettings = atom(null, (get, set, update: NivoScatterPlotUpdateOp) => {
  const settings = get(atomEASLScatterplotSettings);
  const newSettings = lodashSet(settings, update.path, update.value);
  set(atomEASLScatterplotSettings, { ...newSettings }); // Needs a copy...why?
});
