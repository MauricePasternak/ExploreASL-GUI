import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import React from "react";
import {
  toNivoScatterPlotDataGroupBy,
  toNivoScatterPlotDataSingle
} from "../../../common/utilityFunctions/dataFrameFunctions";
import {
  atomCurrentMRIViewSubject,
  atomDataVizLoadSettings,
  atomDataVizSubsetDF,
  atomEASLScatterplotSettings,
  atomMRIDataStats,
  atomNivoGraphDataVariablesSchema,
  atomOfAtomMRIData
} from "../../../stores/DataFrameVisualizationStore";

import { ResponsiveScatterPlotCanvas } from "@nivo/scatterplot";
import { getMinMaxCountSum } from "../../../common/utilityFunctions/arrayFunctions";
import {
  niftiToNivoAxial,
  niftiToNivoCoronal,
  niftiToNivoSagittal
} from "../../../common/utilityFunctions/nivoFunctions";

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

  const subjectCol  = dataFrame.hasSeries("participant_id") ? "participant_id" : "SUBJECT";
  const SubjectSessionSpread = dataFrame.hasSeries("session") ? [subjectCol, "session"] : [subjectCol];

  const data = dataVarsSchema.GroupingVar
    ? toNivoScatterPlotDataGroupBy(
        dataFrame,
        dataVarsSchema.XAxisVar,
        dataVarsSchema.YAxisVar,
        dataVarsSchema.GroupingVar,
        ...SubjectSessionSpread,
        ...dataVarsSchema.HoverVariables
      )
    : toNivoScatterPlotDataSingle(
        dataFrame,
        dataVarsSchema.XAxisVar,
        dataVarsSchema.YAxisVar,
        ...SubjectSessionSpread,
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
    const qCBFFiles = await api.path.glob(popPath.path, `qCBF_${subjectToLoad}*.nii*`);
    if (qCBFFiles.length === 0) return;

    // console.log("handleLoadSubject -- found qCBFFiles: ", qCBFFiles);
    const niftiData = await api.invoke("NIFTI:Load", qCBFFiles[0].path);
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
        legend: scatterplotSettings.axisBottom.axisLabelText,
        legendPosition: "middle",
        legendOffset: scatterplotSettings.axisBottom.axisLabelTextOffset,
      }}
      axisLeft={{
        tickSize: scatterplotSettings.axisLeft.tickHeight,
        tickPadding: scatterplotSettings.axisLeft.tickLabelPadding,
        tickRotation: scatterplotSettings.axisLeft.tickLabelRotation,
        legend: scatterplotSettings.axisLeft.axisLabelText,
        legendPosition: "middle",
        legendOffset: scatterplotSettings.axisLeft.axisLabelTextOffset,
      }}
      legends={[
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
      ]}
      tooltip={({ node: { data } }) => {
        return (
          <Paper elevation={2} sx={{ p: 1 }}>
            <Stack>
              {SubjectSessionSpread.length === 1 ? (
                <Typography component={"strong"}>Subject/Visit: {data[subjectCol as "x"]}</Typography>
              ) : (
                <>
                  <Typography component={"strong"}>Subject/Visit: {data[subjectCol as "x"]}</Typography>
                  <Typography component={"strong"}>Session: {data["session" as "x"]}</Typography>
                </>
              )}
              <Typography>
                {dataVarsSchema.XAxisVar}: {data.x}
              </Typography>
              <Typography>
                {dataVarsSchema.YAxisVar}: {data.y}
              </Typography>
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
        legends: {
          text: {
            fontSize: scatterplotSettings.theme.legendTextFontSize,
          },
        },
      }}
      onClick={async ({ data }) => {
        if (!(subjectCol in data)) return;
        const subjectToLoad =
          "session" in data ? `${data[subjectCol as "x"]}_${data["session" as "y"]}` : data[subjectCol as "x"];
        console.log("Scatterplot trying to load in subject/session: ", subjectToLoad);
        await handleLoadSubject(subjectToLoad);
      }}
    />
  );
}

export default EASLScatterplot;
