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
import { ResponsiveSwarmPlotCanvas } from "@nivo/swarmplot";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { toNivoSwarmPlotDataGroupBy, toNivoSwarmPlotDataSingle } from "../../../common/utils/dataFrameFunctions";
import { atomCurrentMRIViewSubject, atomDataVizLoadSettings, atomDataVizSubsetDF, atomEASLSwarmplotSettings, atomMRIDataStats, atomNivoGraphDataVariablesSchema, atomOfAtomMRIData } from "../../../stores/DataFrameVisualizationStore";
import { getMinMaxCountSum } from "../../../common/utils/arrayFunctions";
import { niftiToNivoAxial, niftiToNivoCoronal, niftiToNivoSagittal } from "../../../common/utils/nivoFunctions";
function EASLSwarmplot() {
    const { api } = window;
    const theme = useTheme();
    const dataVarsSchema = useAtomValue(atomNivoGraphDataVariablesSchema);
    const dataFrame = useAtomValue(atomDataVizSubsetDF);
    const dataLoadSettings = useAtomValue(atomDataVizLoadSettings);
    const setMRIData = useSetAtom(atomOfAtomMRIData);
    const setMRIDataStats = useSetAtom(atomMRIDataStats);
    const [currentMRIViewSubject, setMRICurrentViewSubject] = useAtom(atomCurrentMRIViewSubject);
    const swarmplotSettings = useAtomValue(atomEASLSwarmplotSettings);
    const [YMin, YMax, YCount, YSum] = getMinMaxCountSum(dataFrame.getSeries(dataVarsSchema.YAxisVar).toArray());
    const YMean = YSum / YCount;
    const subjectCol = dataFrame.hasSeries("participant_id") ? "participant_id" : "SUBJECT";
    const SubjectSessionSpread = dataFrame.hasSeries("session") ? [subjectCol, "session"] : [subjectCol];
    const [groups, data] = dataVarsSchema.XAxisVar
        ? toNivoSwarmPlotDataGroupBy(dataFrame, SubjectSessionSpread, dataVarsSchema.YAxisVar, dataVarsSchema.XAxisVar, ...SubjectSessionSpread, ...dataVarsSchema.HoverVariables)
        : toNivoSwarmPlotDataSingle(dataFrame, subjectCol, dataVarsSchema.YAxisVar, dataVarsSchema.XAxisVar, ...SubjectSessionSpread, ...dataVarsSchema.HoverVariables);
    console.log("EASLSwarmplot rendered with settings:", swarmplotSettings);
    console.log("EASLSwarmplot rendered with data:", data);
    function handleLoadSubject(subjectToLoad) {
        return __awaiter(this, void 0, void 0, function* () {
            if (subjectToLoad === currentMRIViewSubject)
                return; // Early return if the subject is already loaded
            const popPath = api.path.asPath(dataLoadSettings.StudyRootPath, "derivatives", "ExploreASL", "Population");
            if (!(yield api.path.filepathExists(popPath.path)))
                return;
            console.log("handleLoadSubject -- found popPath: ", popPath.path);
            const qCBFFiles = yield api.path.glob(popPath.path, `qCBF_${subjectToLoad}*.nii*`);
            if (qCBFFiles.length === 0)
                return;
            console.log("handleLoadSubject -- found qCBFFiles: ", qCBFFiles);
            const niftiData = yield api.invoke("NIFTI:Load", qCBFFiles[0].path);
            if (!niftiData)
                return;
            const [axialData, minimumValue, maximumValue] = niftiToNivoAxial(niftiData);
            // console.log("handleLoadSubject -- loaded axialData: ", axialData);
            const coronalData = niftiToNivoCoronal(niftiData);
            const sagittalData = niftiToNivoSagittal(niftiData);
            console.log("Determined the maximum value of the data:", maximumValue);
            setMRIData([atom(axialData), atom(coronalData), atom(sagittalData)]);
            setMRIDataStats({ max: maximumValue, min: minimumValue });
            setMRICurrentViewSubject(subjectToLoad);
        });
    }
    return (React.createElement(ResponsiveSwarmPlotCanvas, { data: data, groups: Array.isArray(groups) ? groups : [groups], margin: swarmplotSettings.margins, spacing: swarmplotSettings.interNodeSpacing, gap: swarmplotSettings.interSeriesGap, colors: { scheme: swarmplotSettings.colorScheme }, 
        // borderWidth={0}
        borderColor: swarmplotSettings.nodeBorderWidth === 0
            ? {
                from: "color",
                modifiers: [["darker", 1.4]],
            }
            : theme.palette.text.primary, valueScale: {
            type: "linear",
            min: YMin - YMean * 0.1,
            max: YMax + YMean * 0.1,
        }, layout: swarmplotSettings.plotLayout, size: swarmplotSettings.nodeSize, enableGridY: swarmplotSettings.enableGridY, enableGridX: swarmplotSettings.enableGridX, axisTop: null, axisRight: null, axisBottom: {
            tickSize: swarmplotSettings.axisBottom.tickHeight,
            tickPadding: swarmplotSettings.axisBottom.tickLabelPadding,
            tickRotation: swarmplotSettings.axisBottom.tickLabelRotation,
            legend: swarmplotSettings.plotLayout === "vertical"
                ? swarmplotSettings.axisBottom.axisLabelText
                : swarmplotSettings.axisLeft.axisLabelText,
            legendPosition: "middle",
            legendOffset: swarmplotSettings.axisBottom.axisLabelTextOffset,
        }, axisLeft: {
            tickSize: swarmplotSettings.axisLeft.tickHeight,
            tickPadding: swarmplotSettings.axisLeft.tickLabelPadding,
            tickRotation: swarmplotSettings.axisLeft.tickLabelRotation,
            legend: swarmplotSettings.plotLayout === "vertical"
                ? swarmplotSettings.axisLeft.axisLabelText
                : swarmplotSettings.axisBottom.axisLabelText,
            legendPosition: "middle",
            legendOffset: swarmplotSettings.axisLeft.axisLabelTextOffset,
        }, useMesh: true, tooltip: ({ data }) => (React.createElement(Paper, { elevation: 2, sx: { p: 1 } },
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
                    data.group),
                React.createElement(Typography, null,
                    dataVarsSchema.YAxisVar,
                    ": ",
                    data.value),
                ...dataVarsSchema.HoverVariables.map(varName => (React.createElement(Typography, { key: varName },
                    varName,
                    ": ",
                    data[varName])))))), theme: {
            background: theme.palette.background.paper,
            textColor: theme.palette.text.primary,
            fontSize: theme.typography.fontSize,
            grid: {
                line: {
                    strokeWidth: swarmplotSettings.theme.gridLineWidth,
                },
            },
            axis: {
                ticks: {
                    line: {
                        strokeWidth: swarmplotSettings.theme.axisTickWidth,
                        stroke: swarmplotSettings.theme.axisTickColor,
                    },
                    text: {
                        // fill: swarmplotSettings.theme.axisTickLabelFontColor,
                        fontSize: swarmplotSettings.theme.axisTickLabelFontSize,
                    },
                },
                domain: {
                    line: {
                        strokeWidth: swarmplotSettings.theme.axisSpineWidth,
                        stroke: swarmplotSettings.theme.axisSpineColor,
                    },
                },
                legend: {
                    text: {
                        fontSize: swarmplotSettings.theme.axisLegendTextFontSize,
                    },
                },
            },
        }, onClick: ({ data }) => __awaiter(this, void 0, void 0, function* () {
            console.log(data);
            if (!(subjectCol in data))
                return;
            const subjectToLoad = "session" in data ? `${data[subjectCol]}_${data["session"]}` : data[subjectCol];
            console.log("Swarmplot trying to load in subject/session: ", subjectToLoad);
            yield handleLoadSubject(subjectToLoad);
        }) }));
}
export default EASLSwarmplot;
//# sourceMappingURL=EASLSwarmplot.js.map