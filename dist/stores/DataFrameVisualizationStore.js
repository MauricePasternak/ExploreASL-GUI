import { DataFrame } from "data-forge";
import { atom } from "jotai";
import { set as lodashSet } from "lodash";
import { isNumericSeries, query, toNumericSeries, toStringSeries } from "../common/utils/dataFrameFunctions";
export const DataFrameMainTypeOptions = ["Categorical", "Continuous", "Ignore"];
/**
 * Atom for the current step of the data frame visualization wizard.
 */
export const atomDataVizCurrentStep = atom("DefinePaths");
export const loadDataFrameDataVizDefaults = {
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
export const atomDataVizDF = atom(new DataFrame([]));
/**
 * Atom for the dtypes of the main dataframe used for data visualization.
 */
export const atomDataVizDFDTypes = atom({});
/**
 * Setter atom used to change the dataframe & dtypes in the step where the user clarifies the dataframe's dtypes.
 */
export const atomSetDataVizDF = atom(null, (get, set, update) => {
    const df = get(atomDataVizDF);
    const dtypes = get(atomDataVizDFDTypes);
    console.log("atomSetDataVizDF -- df: ", df.toArray());
    console.log("atomSetDataVizDF -- dtypes: ", dtypes);
    console.log("atomSetDataVizDF -- update: ", update);
    // Early exit if the dataframe is null or the column doesn't exist within it
    if (!df || !dtypes || !df.getColumnNames().includes(update.col))
        return;
    const series = df.getSeries(update.col);
    if (update.mainDtype === "Categorical") {
        const newSeries = toStringSeries(series);
        set(atomDataVizDF, new DataFrame(df.withSeries({ [update.col]: newSeries }).toArray()));
        set(atomDataVizDFDTypes, Object.assign(Object.assign({}, dtypes), { [update.col]: "Categorical" }));
    }
    else if (update.mainDtype === "Continuous") {
        const numericType = isNumericSeries(series);
        if (!numericType)
            return;
        const newSeries = toNumericSeries(series, numericType);
        set(atomDataVizDF, new DataFrame(df.withSeries({ [update.col]: newSeries }).toArray()));
        set(atomDataVizDFDTypes, Object.assign(Object.assign({}, dtypes), { [update.col]: "Continuous" }));
    }
    else {
        set(atomDataVizDFDTypes, Object.assign(Object.assign({}, dtypes), { [update.col]: "Ignore" }));
    }
});
/**
 * Atom for the subset operations that should be used to subset the dataframe of interest
 */
export const atomOfAtomsDataVizSubsetOperations = atom([]);
export const atomSetAddPredicate = atom(null, (get, set) => {
    const predicates = get(atomOfAtomsDataVizSubsetOperations);
    set(atomOfAtomsDataVizSubsetOperations, [
        ...predicates,
        atom({
            funcName: "eq",
            col: "",
            val: "",
        }),
    ]);
});
export const atomSetRemovePredicate = atom(null, (get, set, index) => {
    const predicates = get(atomOfAtomsDataVizSubsetOperations);
    set(atomOfAtomsDataVizSubsetOperations, predicates.filter((_, i) => i !== index));
});
/**
 * Derived getter atom specifically meant for the dataframe used for data visualization.
 * USE THIS WHEN USING NIVO, NOT THE MAIN ATOMDATAVIZDF.
 */
export const atomDataVizSubsetDF = atom(get => {
    let df = get(atomDataVizDF);
    const operations = get(atomOfAtomsDataVizSubsetOperations).map(atomOp => get(atomOp));
    if (operations.length === 0)
        return df;
    const columnNames = df.getColumnNames();
    const commonFuncs = ["eq", "ne"];
    const numericFuncs = ["gt", "lt", "ge", "le"];
    const categoricalFuncs = ["includes", "excludes"];
    const allFuncs = [...commonFuncs, ...numericFuncs, ...categoricalFuncs];
    const filteredOps = operations.filter(op => {
        if (!columnNames.includes(op.col) || !allFuncs.includes(op.funcName) || op.val === "")
            return false;
        // Value must be consistent with the expected type of the column
        if (numericFuncs.includes(op.funcName) && (op.val == null || op.val == "" || isNaN(op.val)))
            return false;
        if (categoricalFuncs.includes(op.funcName) && (op.val == null || op.val == ""))
            return false;
        return true;
    });
    console.log("atomDataVizSubsetDF -- filteredOps: ", filteredOps);
    if (filteredOps.length === 0)
        return df;
    return new DataFrame(query(df, filteredOps).toArray());
});
/**
 * Atom for the nivo graph type.
 */
export const atomNivoGraphType = atom("Scatterplot");
export const defaultNivoGraphDataVariablesSchema = {
    YAxisVar: "",
    XAxisVar: "",
    GroupingVar: "",
    HoverVariables: [],
};
/**
 * Atom for the nivo plot variables schema.
 */
export const atomNivoGraphDataVariablesSchema = atom(defaultNivoGraphDataVariablesSchema);
export const atomCurrentMRIViewSubject = atom("");
export const atomMRIDataStats = atom({ max: 0, min: 0 });
export const atomOfAtomMRIData = atom([atom([]), atom([]), atom([])]);
export const atomOfAtomMRISlices = atom([
    atom(48),
    atom(80),
    atom(60), // sagittal
]);
export const atomCurrentAxialSlice = atom(48);
export const atomCurrentCoronalSlice = atom(84);
export const atomCurrentSagittalSlice = atom(60);
export const atomEASLSwarmplotSettings = atom({
    plotLayout: "vertical",
    margins: { top: 40, right: 50, bottom: 60, left: 90 },
    interSeriesGap: 0,
    colorScheme: "set1",
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
export const atomSetEASLSwarmplotSettings = atom(null, (get, set, update) => {
    const settings = get(atomEASLSwarmplotSettings);
    const newSettings = lodashSet(settings, update.path, update.value);
    set(atomEASLSwarmplotSettings, Object.assign({}, newSettings)); // Needs a copy...why?
});
const EASLScatterPlotLegend = {
    anchor: "right",
    direction: "column",
    justify: false,
    translateX: 130,
    translateY: 0,
    itemsSpacing: 5,
    symbolSize: 12,
    itemWidth: 120,
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
export const atomEASLScatterplotSettings = atom({
    margins: { top: 40, right: 130, bottom: 60, left: 90 },
    colorScheme: "set1",
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
export const atomSetEASLScatterplotSettings = atom(null, (get, set, update) => {
    const settings = get(atomEASLScatterplotSettings);
    const newSettings = lodashSet(settings, update.path, update.value);
    set(atomEASLScatterplotSettings, Object.assign({}, newSettings)); // Needs a copy...why?
});
//# sourceMappingURL=DataFrameVisualizationStore.js.map