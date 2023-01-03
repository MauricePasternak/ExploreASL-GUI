var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { ResponsiveScatterPlotCanvas } from "@nivo/scatterplot";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { getMinMaxCountSum } from "../../../common/utils/arrayFunctions";
import { toNivoScatterPlotDataGroupBy, toNivoScatterPlotDataSingle, } from "../../../common/utils/dataFrameFunctions";
import { niftiToNivoAxial, niftiToNivoCoronal, niftiToNivoSagittal, } from "../../../common/utils/nivoFunctions";
import { atomCurrentMRIViewSubject, atomDataVizLoadSettings, atomDataVizSubsetDF, atomEASLScatterplotSettings, atomMRIDataStats, atomNivoGraphDataVariablesSchema, atomOfAtomMRIData, } from "../../../stores/DataFrameVisualizationStore";
function EASLScatterplot() {
    console.log("EASLScatterplot rendered");
    const { api } = window;
    const theme = useTheme();
    const dataVarsSchema = useAtomValue(atomNivoGraphDataVariablesSchema);
    const dataFrame = useAtomValue(atomDataVizSubsetDF);
    const dataLoadSettings = useAtomValue(atomDataVizLoadSettings);
    const setMRIData = useSetAtom(atomOfAtomMRIData);
    const setMRIDataStats = useSetAtom(atomMRIDataStats);
    const [currentMRIViewSubject, setMRICurrentViewSubject] = useAtom(atomCurrentMRIViewSubject);
    const scatterplotSettings = useAtomValue(atomEASLScatterplotSettings);
    const subjectCol = dataFrame.hasSeries("participant_id") ? "participant_id" : "SUBJECT";
    const SubjectSessionSpread = dataFrame.hasSeries("session") ? [subjectCol, "session"] : [subjectCol];
    const data = dataVarsSchema.GroupingVar
        ? toNivoScatterPlotDataGroupBy(dataFrame, dataVarsSchema.XAxisVar, dataVarsSchema.YAxisVar, dataVarsSchema.GroupingVar, ...SubjectSessionSpread, ...dataVarsSchema.HoverVariables)
        : toNivoScatterPlotDataSingle(dataFrame, dataVarsSchema.XAxisVar, dataVarsSchema.YAxisVar, ...SubjectSessionSpread, ...dataVarsSchema.HoverVariables);
    const [XMin, XMax, XCount, XSum] = getMinMaxCountSum(dataFrame.getSeries(dataVarsSchema.XAxisVar).toArray());
    const [YMin, YMax, YCount, YSum] = getMinMaxCountSum(dataFrame.getSeries(dataVarsSchema.YAxisVar).toArray());
    const XMean = XSum / XCount;
    const YMean = YSum / YCount;
    function handleLoadSubject(subjectToLoad) {
        return __awaiter(this, void 0, void 0, function* () {
            if (subjectToLoad === currentMRIViewSubject)
                return; // Early return if the subject is already loaded
            // console.log(`Loading subject ${subjectToLoad}`);
            // console.log(`Loading subject with dataLoadSettings: ${JSON.stringify(dataLoadSettings)}`);
            const popPath = api.path.asPath(dataLoadSettings.StudyRootPath, "derivatives", "ExploreASL", "Population");
            if (!(yield api.path.filepathExists(popPath.path)))
                return;
            // console.log("handleLoadSubject -- found popPath: ", popPath.path);
            const qCBFFiles = yield api.path.glob(popPath.path, `qCBF_${subjectToLoad}*.nii*`);
            if (qCBFFiles.length === 0)
                return;
            // console.log("handleLoadSubject -- found qCBFFiles: ", qCBFFiles);
            const niftiData = yield api.invoke("NIFTI:Load", qCBFFiles[0].path);
            if (!niftiData)
                return;
            const [axialData, minimumValue, maximumValue] = niftiToNivoAxial(niftiData);
            // console.log("handleLoadSubject -- loaded axialData: ", axialData);
            const coronalData = niftiToNivoCoronal(niftiData);
            const sagittalData = niftiToNivoSagittal(niftiData);
            // console.log("Determined the maximum value of the data:", maximumValue);
            setMRIData([atom(axialData), atom(coronalData), atom(sagittalData)]);
            setMRIDataStats({ max: maximumValue, min: minimumValue });
            setMRICurrentViewSubject(subjectToLoad);
        });
    }
    return (React.createElement(ResponsiveScatterPlotCanvas, { data: data, margin: scatterplotSettings.margins, xScale: { type: "linear", min: XMin - XMean * 0.1, max: XMax + XMean * 0.1 }, xFormat: ">-.2f", yScale: { type: "linear", min: YMin - YMean * 0.1, max: YMax + YMean * 0.1 }, yFormat: ">-.2f", colors: { scheme: scatterplotSettings.colorScheme }, nodeSize: scatterplotSettings.nodeSize, enableGridY: scatterplotSettings.enableGridY, enableGridX: scatterplotSettings.enableGridX, axisTop: null, axisRight: null, axisBottom: {
            tickSize: scatterplotSettings.axisBottom.tickHeight,
            tickPadding: scatterplotSettings.axisBottom.tickLabelPadding,
            tickRotation: scatterplotSettings.axisBottom.tickLabelRotation,
            legend: scatterplotSettings.axisBottom.axisLabelText,
            legendPosition: "middle",
            legendOffset: scatterplotSettings.axisBottom.axisLabelTextOffset,
        }, axisLeft: {
            tickSize: scatterplotSettings.axisLeft.tickHeight,
            tickPadding: scatterplotSettings.axisLeft.tickLabelPadding,
            tickRotation: scatterplotSettings.axisLeft.tickLabelRotation,
            legend: scatterplotSettings.axisLeft.axisLabelText,
            legendPosition: "middle",
            legendOffset: scatterplotSettings.axisLeft.axisLabelTextOffset,
        }, legends: [
            {
                anchor: scatterplotSettings.legends[0].anchor,
                direction: scatterplotSettings.legends[0].direction,
                justify: true,
                translateX: scatterplotSettings.legends[0].translateX,
                translateY: scatterplotSettings.legends[0].translateY,
                itemsSpacing: scatterplotSettings.legends[0].itemsSpacing,
                symbolSize: scatterplotSettings.legends[0].symbolSize,
                itemWidth: scatterplotSettings.legends[0].itemWidth,
                itemHeight: scatterplotSettings.legends[0].itemHeight,
                itemDirection: scatterplotSettings.legends[0].itemDirection,
                symbolShape: "circle",
                effects: [
                    {
                        on: "hover",
                        style: {
                            itemOpacity: 0.7,
                        },
                    },
                ],
            },
        ], tooltip: ({ node: { data } }) => {
            return (React.createElement(Paper, { elevation: 2, sx: { p: 1 } },
                React.createElement(Stack, null,
                    SubjectSessionSpread.length === 1 ? (React.createElement(Typography, { component: "strong" },
                        "Subject/Visit: ",
                        data[subjectCol])) : (React.createElement(React.Fragment, null,
                        React.createElement(Typography, { component: "strong" },
                            "Subject/Visit: ",
                            data[subjectCol]),
                        React.createElement(Typography, { component: "strong" },
                            "Session: ",
                            data["session"]))),
                    React.createElement(Typography, null,
                        dataVarsSchema.XAxisVar,
                        ": ",
                        data.x),
                    React.createElement(Typography, null,
                        dataVarsSchema.YAxisVar,
                        ": ",
                        data.y),
                    ...dataVarsSchema.HoverVariables.map((varName) => (React.createElement(Typography, { key: varName },
                        varName,
                        ": ",
                        data[varName]))))));
        }, theme: {
            textColor: theme.palette.text.primary,
            fontSize: theme.typography.fontSize,
            grid: {
                line: {
                    strokeWidth: scatterplotSettings.theme.gridLineWidth,
                },
            },
            axis: {
                ticks: {
                    line: {
                        strokeWidth: scatterplotSettings.theme.axisTickWidth,
                        stroke: scatterplotSettings.theme.axisTickColor,
                    },
                    text: {
                        // fill: scatterplotSettings.theme.axisTickLabelFontColor,
                        fontSize: scatterplotSettings.theme.axisTickLabelFontSize,
                    },
                },
                domain: {
                    line: {
                        strokeWidth: scatterplotSettings.theme.axisSpineWidth,
                        stroke: scatterplotSettings.theme.axisSpineColor,
                    },
                },
                legend: {
                    text: {
                        fontSize: scatterplotSettings.theme.axisLegendTextFontSize,
                    },
                },
            },
            legends: {
                text: {
                    fontSize: scatterplotSettings.theme.legendTextFontSize,
                },
            },
        }, onClick: ({ data }) => __awaiter(this, void 0, void 0, function* () {
            if (!(subjectCol in data))
                return;
            const subjectToLoad = "session" in data ? `${data[subjectCol]}_${data["session"]}` : data[subjectCol];
            console.log("Scatterplot trying to load in subject/session: ", subjectToLoad);
            yield handleLoadSubject(`${subjectToLoad}`);
        }) }));
}
export default EASLScatterplot;
//# sourceMappingURL=EASLScatterplot.js.map