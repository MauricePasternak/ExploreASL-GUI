import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { ResponsiveSwarmPlotCanvas } from "@nivo/swarmplot";
import { useAtomValue, useSetAtom, atom } from "jotai";
import React from "react";
import {
  toNivoSwarmPlotDataGroupBy,
  toNivoSwarmPlotDataSingle,
} from "../../../common/utilityFunctions/dataFrameFunctions";
import {
  atomDataVizLoadSettings,
  atomDataVizSubsetDF,
  atomEASLSwarmplotSettings,
  atomMRIDataStats,
  atomNivoGraphDataVariablesSchema,
  atomOfAtomMRIData,
} from "../../../stores/DataFrameVisualizationStore";

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
  const swarmplotSettings = useAtomValue(atomEASLSwarmplotSettings);
  const [groups, data] = dataVarsSchema.XAxisVar
    ? toNivoSwarmPlotDataGroupBy(
        dataFrame,
        "SUBJECT",
        dataVarsSchema.YAxisVar,
        dataVarsSchema.XAxisVar,
        ...dataVarsSchema.HoverVariables
      )
    : toNivoSwarmPlotDataSingle(
        dataFrame,
        "SUBJECT",
        dataVarsSchema.YAxisVar,
        dataVarsSchema.XAxisVar,
        ...dataVarsSchema.HoverVariables
      );

  console.log("EASLSwarmplot rendered with settings:", swarmplotSettings);
  console.log("EASLSwarmplot rendered with data:", data);

  async function handleLoadSubject(subjectToLoad: string) {
    const popPath = api.path.asPath(dataLoadSettings.StudyRootPath, "derivatives", "ExploreASL", "Population");
    if (!(await api.path.filepathExists(popPath.path))) return;

    console.log("handleLoadSubject -- found popPath: ", popPath.path);
    const qCBFFiles = await api.path.glob(popPath.path, `qCBF_${subjectToLoad}_*.nii*`);
    if (qCBFFiles.length === 0) return;

    console.log("handleLoadSubject -- found qCBFFiles: ", qCBFFiles);
    const niftiData = await api.invoke("NIFTI:load", qCBFFiles[0].path);
    if (!niftiData) return;

    const [axialData, minimumValue, maximumValue] = niftiToNivoAxial(niftiData);
    // console.log("handleLoadSubject -- loaded axialData: ", axialData);
    const coronalData = niftiToNivoCoronal(niftiData);
    const sagittalData = niftiToNivoSagittal(niftiData);

    console.log("Determined the maximum value of the data:", maximumValue);

    setMRIData([atom(axialData), atom(coronalData), atom(sagittalData)]);
    setMRIDataStats({ max: maximumValue, min: minimumValue });
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
      size={swarmplotSettings.nodeSize}
      enableGridY={swarmplotSettings.enableGridY}
      enableGridX={swarmplotSettings.enableGridX}
      axisTop={null}
      axisRight={null}
      axisBottom={{
        tickSize: swarmplotSettings.axisBottom.tickHeight,
        tickPadding: swarmplotSettings.axisBottom.tickLabelPadding,
        tickRotation: swarmplotSettings.axisBottom.tickLabelRotation,
        legend: dataVarsSchema.XAxisVar,
        legendPosition: "middle",
        legendOffset: swarmplotSettings.axisBottom.axisLabelTextOffset,
      }}
      axisLeft={{
        tickSize: swarmplotSettings.axisLeft.tickHeight,
        tickPadding: swarmplotSettings.axisLeft.tickLabelPadding,
        tickRotation: swarmplotSettings.axisLeft.tickLabelRotation,
        legend: dataVarsSchema.YAxisVar,
        legendPosition: "middle",
        legendOffset: swarmplotSettings.axisLeft.axisLabelTextOffset,
      }}
      useMesh={true}
      tooltip={({ data }) => (
        <Paper elevation={2} sx={{ p: 1 }}>
          <Stack>
            <Typography component={"strong"}>ID: {data.id}</Typography>
            <Typography>X: {data.group}</Typography>
            <Typography>Y: {data.value}</Typography>
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
        await handleLoadSubject(data["id"]);
      }}
    />
  );
}

export default EASLSwarmplot;
