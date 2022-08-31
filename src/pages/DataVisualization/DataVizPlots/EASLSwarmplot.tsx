import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { ResponsiveSwarmPlotCanvas } from "@nivo/swarmplot";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import React from "react";
import {
  toNivoSwarmPlotDataGroupBy,
  toNivoSwarmPlotDataSingle,
} from "../../../common/utilityFunctions/dataFrameFunctions";
import {
  atomCurrentMRIViewSubject,
  atomDataVizLoadSettings,
  atomDataVizSubsetDF,
  atomEASLSwarmplotSettings,
  atomMRIDataStats,
  atomNivoGraphDataVariablesSchema,
  atomOfAtomMRIData,
} from "../../../stores/DataFrameVisualizationStore";

import { getMinMaxCountSum } from "../../../common/utilityFunctions/arrayFunctions";
import {
  niftiToNivoAxial,
  niftiToNivoCoronal,
  niftiToNivoSagittal,
} from "../../../common/utilityFunctions/nivoFunctions";

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
    ? toNivoSwarmPlotDataGroupBy(
        dataFrame,
        SubjectSessionSpread,
        dataVarsSchema.YAxisVar,
        dataVarsSchema.XAxisVar,
        ...SubjectSessionSpread,
        ...dataVarsSchema.HoverVariables
      )
    : toNivoSwarmPlotDataSingle(
        dataFrame,
        subjectCol,
        dataVarsSchema.YAxisVar,
        dataVarsSchema.XAxisVar,
        ...SubjectSessionSpread,
        ...dataVarsSchema.HoverVariables
      );

  console.log("EASLSwarmplot rendered with settings:", swarmplotSettings);
  console.log("EASLSwarmplot rendered with data:", data);

  async function handleLoadSubject(subjectToLoad: string) {
    if (subjectToLoad === currentMRIViewSubject) return; // Early return if the subject is already loaded

    const popPath = api.path.asPath(dataLoadSettings.StudyRootPath, "derivatives", "ExploreASL", "Population");
    if (!(await api.path.filepathExists(popPath.path))) return;

    console.log("handleLoadSubject -- found popPath: ", popPath.path);
    const qCBFFiles = await api.path.glob(popPath.path, `qCBF_${subjectToLoad}*.nii*`);
    if (qCBFFiles.length === 0) return;

    console.log("handleLoadSubject -- found qCBFFiles: ", qCBFFiles);
    const niftiData = await api.invoke("NIFTI:Load", qCBFFiles[0].path);
    if (!niftiData) return;

    const [axialData, minimumValue, maximumValue] = niftiToNivoAxial(niftiData);
    // console.log("handleLoadSubject -- loaded axialData: ", axialData);
    const coronalData = niftiToNivoCoronal(niftiData);
    const sagittalData = niftiToNivoSagittal(niftiData);

    console.log("Determined the maximum value of the data:", maximumValue);

    setMRIData([atom(axialData), atom(coronalData), atom(sagittalData)]);
    setMRIDataStats({ max: maximumValue, min: minimumValue });
    setMRICurrentViewSubject(subjectToLoad);
  }

  return (
    <ResponsiveSwarmPlotCanvas
      data={data}
      groups={Array.isArray(groups) ? groups : [groups]}
      margin={swarmplotSettings.margins}
      spacing={swarmplotSettings.interNodeSpacing}
      gap={swarmplotSettings.interSeriesGap}
      colors={{ scheme: swarmplotSettings.colorScheme }}
      borderWidth={swarmplotSettings.nodeBorderWidth}
      borderColor={{
        from: "color",
        modifiers: [["darker", 0.6]],
      }}
      valueScale={{
        type: "linear",
        min: YMin - YMean * 0.1,
        max: YMax + YMean * 0.1,
      }}
      layout={swarmplotSettings.plotLayout}
      size={swarmplotSettings.nodeSize}
      enableGridY={swarmplotSettings.enableGridY}
      enableGridX={swarmplotSettings.enableGridX}
      axisTop={null}
      axisRight={null}
      axisBottom={{
        tickSize: swarmplotSettings.axisBottom.tickHeight,
        tickPadding: swarmplotSettings.axisBottom.tickLabelPadding,
        tickRotation: swarmplotSettings.axisBottom.tickLabelRotation,
        legend:
          swarmplotSettings.plotLayout === "vertical"
            ? swarmplotSettings.axisBottom.axisLabelText
            : swarmplotSettings.axisLeft.axisLabelText,
        legendPosition: "middle",
        legendOffset: swarmplotSettings.axisBottom.axisLabelTextOffset,
      }}
      axisLeft={{
        tickSize: swarmplotSettings.axisLeft.tickHeight,
        tickPadding: swarmplotSettings.axisLeft.tickLabelPadding,
        tickRotation: swarmplotSettings.axisLeft.tickLabelRotation,
        legend:
          swarmplotSettings.plotLayout === "vertical"
            ? swarmplotSettings.axisLeft.axisLabelText
            : swarmplotSettings.axisBottom.axisLabelText,
        legendPosition: "middle",
        legendOffset: swarmplotSettings.axisLeft.axisLabelTextOffset,
      }}
      useMesh={true}
      tooltip={({ data }) => (
        <Paper elevation={2} sx={{ p: 1 }}>
          <Stack>
            {SubjectSessionSpread.length === 1 ? (
              <Typography component={"strong"}>Subject/Visit: {data[subjectCol as "value"]}</Typography>
            ) : (
              <>
                <Typography component={"strong"}>Subject/Visit: {data[subjectCol as "value"]}</Typography>
                <Typography component={"strong"}>Session: {data["session" as "value"]}</Typography>
              </>
            )}
            <Typography>
              {dataVarsSchema.XAxisVar}: {data.group}
            </Typography>
            <Typography>
              {dataVarsSchema.YAxisVar}: {data.value}
            </Typography>
            {...dataVarsSchema.HoverVariables.map(varName => (
              <Typography key={varName}>
                {varName}: {data[varName as "group"]}
              </Typography>
            ))}
          </Stack>
        </Paper>
      )}
      theme={{
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
      }}
      onClick={async ({ data }) => {
        console.log(data);
        if (!(subjectCol in data)) return;
        const subjectToLoad =
          "session" in data ? `${data[subjectCol as "id"]}_${data["session" as "id"]}` : data[subjectCol as "id"];
        console.log("Swarmplot trying to load in subject/session: ", subjectToLoad);
        await handleLoadSubject(subjectToLoad);
      }}
    />
  );
}

export default EASLSwarmplot;
