import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Avatar from "@mui/material/Avatar";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Collapse from "@mui/material/Collapse";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import InputLabel from "@mui/material/InputLabel";
import Stack from "@mui/material/Stack";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import ScatterPlotIcon from "../../../assets/svg/ScatterGraph.svg";
import ExpandMore from "../../../components/ExpandMore";
import { ControlledLabelSlider, ControlledLabelSwitch } from "../../../components/FormComponents/ControlLabelGrid";
import {
  atomEASLScatterplotSettings,
  atomSetEASLScatterplotSettings,
} from "../../../stores/DataFrameVisualizationStore";
import ColorSelect from "../ColorSelect";

function ScatterPlotVisualsSettings() {
  const [expanded, setExpanded] = React.useState(true);
  const EASLPlotSettings = useAtomValue(atomEASLScatterplotSettings);
  const setEASLPlotSettings = useSetAtom(atomSetEASLScatterplotSettings);

  return (
    <Card elevation={1} sx={{ margin: 0.5, pr: 1 }}>
      <CardHeader
        title={<Typography variant="h5">Scatter Plot Visuals</Typography>}
        subheader={
          <Typography variant="subtitle1">Control specifics about the scatterplot axes/margins/etc.</Typography>
        }
        avatar={
          <Avatar>
            <SvgIcon component={ScatterPlotIcon} inheritViewBox fontSize="large" />
          </Avatar>
        }
        action={
          <ExpandMore
            expand={expanded}
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label="show more"
          >
            <ExpandMoreIcon />
          </ExpandMore>
        }
      />
      <Collapse in={expanded}>
        <CardContent>
          <Stack spacing={2}>
            <FormControl fullWidth>
              <InputLabel>Color Palette</InputLabel>
              <ColorSelect
                label="Color Palette"
                value={EASLPlotSettings.colorScheme}
                onChange={color => {
                  setEASLPlotSettings({
                    path: "colorScheme",
                    value: color,
                  });
                }}
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Marker Settings</FormLabel>
              <ControlledLabelSlider
                label="Size"
                labelwidth="150px"
                max={30}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.nodeSize}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "nodeSize",
                    value: v as number,
                  })
                }
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>Margins</FormLabel>
              <ControlledLabelSlider
                label="Left"
                labelwidth="100px"
                max={200}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.margins.left}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "margins.left",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Top"
                labelwidth="100px"
                max={200}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.margins.top}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "margins.top",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Right"
                labelwidth="100px"
                max={200}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.margins.right}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "margins.right",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Bottom"
                labelwidth="100px"
                max={200}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.margins.bottom}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "margins.bottom",
                    value: v as number,
                  })
                }
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>Grid Lines</FormLabel>
              <ControlledLabelSwitch
                label="X Axis"
                labelwidth="90px"
                checked={EASLPlotSettings.enableGridX}
                onChange={(e, c) =>
                  setEASLPlotSettings({
                    path: "enableGridX",
                    value: c,
                  })
                }
              />
              <ControlledLabelSwitch
                label="Y Axis"
                labelwidth="90px"
                checked={EASLPlotSettings.enableGridY}
                onChange={(e, c) =>
                  setEASLPlotSettings({
                    path: "enableGridY",
                    value: c,
                  })
                }
              />
              <ControlledLabelSlider
                label="Grid Line Width"
                labelwidth="100px"
                min={0}
                step={0.1}
                max={3}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.theme.gridLineWidth}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "theme.gridLineWidth",
                    value: v as number,
                  })
                }
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>X Axis Settings</FormLabel>
              <ControlledLabelSlider
                label="Tick Height"
                labelwidth="160px"
                max={20}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.axisBottom.tickHeight}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "axisBottom.tickHeight",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Tick Width"
                labelwidth="160px"
                max={20}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.theme.axisTickWidth}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "theme.axisTickWidth",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Tick Label Font Size"
                labelwidth="160px"
                max={20}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.theme.axisTickLabelFontSize}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "theme.axisTickLabelFontSize",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Tick Label Offset"
                labelwidth="160px"
                max={20}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.axisBottom.tickLabelPadding}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "axisBottom.tickLabelPadding",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Tick Label Rotation"
                labelwidth="160px"
                min={-90}
                max={90}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.axisBottom.tickLabelRotation}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "axisBottom.tickLabelRotation",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Axis Label Font Size"
                labelwidth="160px"
                max={30}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.theme.axisLegendTextFontSize}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "theme.axisLegendTextFontSize",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Axis Label Offset"
                labelwidth="160px"
                valueLabelDisplay="auto"
                value={EASLPlotSettings.axisBottom.axisLabelTextOffset}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "axisBottom.axisLabelTextOffset",
                    value: v as number,
                  })
                }
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>Y Axis Settings</FormLabel>
              <ControlledLabelSlider
                label="Tick Height"
                labelwidth="160px"
                max={20}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.axisLeft.tickHeight}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "axisLeft.tickHeight",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Tick Width"
                labelwidth="160px"
                max={20}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.theme.axisTickWidth}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "theme.axisTickWidth",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Tick Label Font Size"
                labelwidth="160px"
                max={20}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.theme.axisTickLabelFontSize}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "theme.axisTickLabelFontSize",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Tick Label Offset"
                labelwidth="160px"
                max={20}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.axisLeft.tickLabelPadding}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "axisLeft.tickLabelPadding",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Tick Label Rotation"
                labelwidth="160px"
                min={-90}
                max={90}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.axisLeft.tickLabelRotation}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "axisLeft.tickLabelRotation",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Axis Label Font Size"
                labelwidth="160px"
                max={30}
                valueLabelDisplay="auto"
                value={EASLPlotSettings.theme.axisLegendTextFontSize}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "theme.axisLegendTextFontSize",
                    value: v as number,
                  })
                }
              />
              <ControlledLabelSlider
                label="Axis Label Offset"
                labelwidth="160px"
                valueLabelDisplay="auto"
                min={-100}
                max={0}
                value={EASLPlotSettings.axisLeft.axisLabelTextOffset}
                onChange={(e, v) =>
                  setEASLPlotSettings({
                    path: "axisLeft.axisLabelTextOffset",
                    value: v as number,
                  })
                }
              />
            </FormControl>
          </Stack>
        </CardContent>
      </Collapse>
    </Card>
  );
}

export default React.memo(ScatterPlotVisualsSettings);
