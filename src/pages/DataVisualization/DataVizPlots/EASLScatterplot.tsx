import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom, useAtom, atom } from "jotai";
import React from "react";
import {
  toNivoScatterPlotDataGroupBy,
  toNivoScatterPlotDataSingle,
  toNivoSwarmPlotDataGroupBy,
  toNivoSwarmPlotDataSingle,
} from "../../../common/utilityFunctions/dataFrameFunctions";
import {
  atomCurrentMRIViewSubject,
  atomDataVizLoadSettings,
  atomDataVizSubsetDF,
  atomEASLScatterplotSettings,
  atomMRIDataStats,
  atomNivoGraphDataVariablesSchema,
  atomOfAtomMRIData,
} from "../../../stores/DataFrameVisualizationStore";

import {
  niftiToNivoAxial,
  niftiToNivoCoronal,
  niftiToNivoSagittal,
} from "../../../common/utilityFunctions/nivoFunctions";
import { ResponsiveScatterPlotCanvas } from "@nivo/scatterplot";
import { getMinMaxCountSum } from "../../../common/utilityFunctions/arrayFunctions";

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
  const data = dataVarsSchema.GroupingVar
    ? toNivoScatterPlotDataGroupBy(
        dataFrame,
        dataVarsSchema.XAxisVar,
        dataVarsSchema.YAxisVar,
        dataVarsSchema.GroupingVar,
        "SUBJECT",
        ...dataVarsSchema.HoverVariables
      )
    : toNivoScatterPlotDataSingle(
        dataFrame,
        dataVarsSchema.XAxisVar,
        dataVarsSchema.YAxisVar,
        "SUBJECT",
        ...dataVarsSchema.HoverVariables
      );

  const [XMin, XMax, XCount, XSum] = getMinMaxCountSum(dataFrame.getSeries(dataVarsSchema.XAxisVar).toArray());
  const [YMin, YMax, YCount, YSum] = getMinMaxCountSum(dataFrame.getSeries(dataVarsSchema.YAxisVar).toArray());
  const XMean = XSum / XCount;
  const YMean = YSum / YCount;

  async function handleLoadSubject(subjectToLoad: string) {
    if (subjectToLoad === currentMRIViewSubject) return; // Early return if the subject is already loaded

    // console.log(`Loading subject ${subjectToLoad}`);
    // console.log(`Loading subject with dataLoadSettings: ${JSON.stringify(dataLoadSettings)}`);

    const popPath = api.path.asPath(dataLoadSettings.StudyRootPath, "derivatives", "ExploreASL", "Population");
    if (!(await api.path.filepathExists(popPath.path))) return;

    // console.log("handleLoadSubject -- found popPath: ", popPath.path);
    const qCBFFiles = await api.path.glob(popPath.path, `qCBF_${subjectToLoad}_*.nii*`);
    if (qCBFFiles.length === 0) return;

    // console.log("handleLoadSubject -- found qCBFFiles: ", qCBFFiles);
    const niftiData = await api.invoke("NIFTI:load", qCBFFiles[0].path);
    if (!niftiData) return;

    const [axialData, minimumValue, maximumValue] = niftiToNivoAxial(niftiData);
    // console.log("handleLoadSubject -- loaded axialData: ", axialData);
    const coronalData = niftiToNivoCoronal(niftiData);
    const sagittalData = niftiToNivoSagittal(niftiData);

    // console.log("Determined the maximum value of the data:", maximumValue);

    setMRIData([atom(axialData), atom(coronalData), atom(sagittalData)]);
    setMRIDataStats({ max: maximumValue, min: minimumValue });
    setMRICurrentViewSubject(subjectToLoad);
  }

  return (
    <ResponsiveScatterPlotCanvas
      data={data}
      margin={scatterplotSettings.margins}
      xScale={{ type: "linear", min: XMin - XMean * 0.1, max: XMax + XMean * 0.1 }}
      xFormat=">-.2f"
      yScale={{ type: "linear", min: YMin - YMean * 0.1, max: YMax + YMean * 0.1 }}
      yFormat=">-.2f"
      colors={{ scheme: scatterplotSettings.colorScheme }}
      nodeSize={scatterplotSettings.nodeSize}
      enableGridY={scatterplotSettings.enableGridY}
      enableGridX={scatterplotSettings.enableGridX}
      axisTop={null}
      axisRight={null}
      axisBottom={{
        tickSize: scatterplotSettings.axisBottom.tickHeight,
        tickPadding: scatterplotSettings.axisBottom.tickLabelPadding,
        tickRotation: scatterplotSettings.axisBottom.tickLabelRotation,
        legend: dataVarsSchema.XAxisVar,
        legendPosition: "middle",
        legendOffset: scatterplotSettings.axisBottom.axisLabelTextOffset,
      }}
      axisLeft={{
        tickSize: scatterplotSettings.axisLeft.tickHeight,
        tickPadding: scatterplotSettings.axisLeft.tickLabelPadding,
        tickRotation: scatterplotSettings.axisLeft.tickLabelRotation,
        legend: dataVarsSchema.YAxisVar,
        legendPosition: "middle",
        legendOffset: scatterplotSettings.axisLeft.axisLabelTextOffset,
      }}
      legends={[
        {
          anchor: "right",
          direction: "column",
          justify: false,
          translateX: 118,
          translateY: 0,
          itemWidth: 100,
          itemHeight: 12,
          itemsSpacing: 5,
          itemDirection: "left-to-right",
          symbolSize: 12,
          effects: [
            {
              on: "hover",
              style: {
                itemOpacity: 1,
              },
            },
          ],
        },
      ]}
      tooltip={({ node: { data } }) => {
        return (
          <Paper elevation={2} sx={{ p: 1 }}>
            <Stack>
              <Typography component={"strong"}>ID: {data["SUBJECT" as "x"]}</Typography>
              <Typography>X: {data.x}</Typography>
              <Typography>Y: {data.y}</Typography>
              {...dataVarsSchema.HoverVariables.map(varName => (
                <Typography key={varName}>
                  {varName}: {data[varName as "x"]}
                </Typography>
              ))}
            </Stack>
          </Paper>
        );
      }}
      theme={{
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
      }}
      onClick={async ({ data }) => {
        if (!("SUBJECT" in data)) return;
        await handleLoadSubject(data["SUBJECT" as "x"]);
      }}
    />
  );
}

export default EASLScatterplot;
