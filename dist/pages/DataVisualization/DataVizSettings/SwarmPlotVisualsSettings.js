import BubbleChartIcon from "@mui/icons-material/BubbleChart";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Collapse from "@mui/material/Collapse";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { DebouncedInput } from "../../../components/DebouncedComponents";
import ExpandMore from "../../../components/ExpandMore";
import { ControlledLabelSlider, ControlledLabelSwitch, } from "../../../components/RegularFormComponents/ControlLabelGrid";
import { atomEASLSwarmplotSettings, atomSetEASLSwarmplotSettings } from "../../../stores/DataFrameVisualizationStore";
import ColorSelect from "../ColorSelect";
function SwarmPlotVisualsSettings() {
    const [expanded, setExpanded] = React.useState(true);
    const EASLPlotSettings = useAtomValue(atomEASLSwarmplotSettings);
    const setEASLPlotSettings = useSetAtom(atomSetEASLSwarmplotSettings);
    return (React.createElement(Card, { elevation: 1, sx: { margin: 0.5, pr: 1 } },
        React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h5" }, "Swarm Plot Visuals"), subheader: React.createElement(Typography, { variant: "subtitle1" }, "Control specifics about the swarmplot axes/margins/etc."), avatar: React.createElement(Avatar, null,
                React.createElement(BubbleChartIcon, null)), action: React.createElement(ExpandMore, { expand: expanded, onClick: () => setExpanded(!expanded), "aria-expanded": expanded, "aria-label": "show more" },
                React.createElement(ExpandMoreIcon, null)) }),
        React.createElement(Collapse, { in: expanded },
            React.createElement(CardContent, null,
                React.createElement(Stack, { spacing: 2 },
                    React.createElement(FormControl, { fullWidth: true },
                        React.createElement(InputLabel, null, "Orientation"),
                        React.createElement(Select, { fullWidth: true, label: "Orientation", value: EASLPlotSettings.plotLayout, onChange: (e) => {
                                setEASLPlotSettings({
                                    path: "plotLayout",
                                    value: e.target.value,
                                });
                            } },
                            React.createElement(MenuItem, { value: "horizontal" }, "Horizontal"),
                            React.createElement(MenuItem, { value: "vertical" }, "Vertical"))),
                    React.createElement(FormControl, { fullWidth: true },
                        React.createElement(InputLabel, null, "Color Palette"),
                        React.createElement(ColorSelect, { label: "Color Palette", value: EASLPlotSettings.colorScheme, onChange: (color) => {
                                setEASLPlotSettings({
                                    path: "colorScheme",
                                    value: color,
                                });
                            } })),
                    React.createElement(FormControl, { fullWidth: true },
                        React.createElement(FormLabel, null, "Marker Settings"),
                        React.createElement(ControlledLabelSlider, { label: "Size", labelwidth: "150px", max: 30, valueLabelDisplay: "auto", value: EASLPlotSettings.nodeSize, onChange: (e, v) => setEASLPlotSettings({
                                path: "nodeSize",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Border Width", labelwidth: "150px", max: 1, step: 1, valueLabelDisplay: "auto", value: EASLPlotSettings.nodeBorderWidth, onChange: (e, v) => setEASLPlotSettings({
                                path: "nodeBorderWidth",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Between-Groups Spacing", labelwidth: "150px", min: -300, max: 300, valueLabelDisplay: "auto", value: EASLPlotSettings.interSeriesGap, onChange: (e, v) => setEASLPlotSettings({
                                path: "interSeriesGap",
                                value: v,
                            }) })),
                    React.createElement(FormControl, { fullWidth: true },
                        React.createElement(FormLabel, null, "Margins"),
                        React.createElement(ControlledLabelSlider, { label: "Left", labelwidth: "100px", max: 200, valueLabelDisplay: "auto", value: EASLPlotSettings.margins.left, onChange: (e, v) => setEASLPlotSettings({
                                path: "margins.left",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Top", labelwidth: "100px", max: 200, valueLabelDisplay: "auto", value: EASLPlotSettings.margins.top, onChange: (e, v) => setEASLPlotSettings({
                                path: "margins.top",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Right", labelwidth: "100px", max: 200, valueLabelDisplay: "auto", value: EASLPlotSettings.margins.right, onChange: (e, v) => setEASLPlotSettings({
                                path: "margins.right",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Bottom", labelwidth: "100px", max: 200, valueLabelDisplay: "auto", value: EASLPlotSettings.margins.bottom, onChange: (e, v) => setEASLPlotSettings({
                                path: "margins.bottom",
                                value: v,
                            }) })),
                    React.createElement(FormControl, { fullWidth: true },
                        React.createElement(FormLabel, null, "Grid Lines"),
                        React.createElement(ControlledLabelSwitch, { label: "X Axis", labelwidth: "90px", checked: EASLPlotSettings.enableGridX, onChange: (e, c) => setEASLPlotSettings({
                                path: "enableGridX",
                                value: c,
                            }) }),
                        React.createElement(ControlledLabelSwitch, { label: "Y Axis", labelwidth: "90px", checked: EASLPlotSettings.enableGridY, onChange: (e, c) => setEASLPlotSettings({
                                path: "enableGridY",
                                value: c,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Grid Line Width", labelwidth: "100px", min: 0, step: 0.1, max: 3, valueLabelDisplay: "auto", value: EASLPlotSettings.theme.gridLineWidth, onChange: (e, v) => setEASLPlotSettings({
                                path: "theme.gridLineWidth",
                                value: v,
                            }) })),
                    React.createElement(FormControl, { fullWidth: true },
                        React.createElement(FormLabel, null, "X Axis Settings"),
                        React.createElement(Box, { py: 2, ml: 2 },
                            React.createElement(DebouncedInput, { fullWidth: true, label: "X Axis Label", value: EASLPlotSettings.axisBottom.axisLabelText, onChange: (value) => {
                                    setEASLPlotSettings({
                                        path: "axisBottom.axisLabelText",
                                        value,
                                    });
                                }, debounceTime: 1000 })),
                        React.createElement(ControlledLabelSlider, { label: "Tick Height", labelwidth: "160px", max: 20, valueLabelDisplay: "auto", value: EASLPlotSettings.axisBottom.tickHeight, onChange: (e, v) => setEASLPlotSettings({
                                path: "axisBottom.tickHeight",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Tick Width", labelwidth: "160px", max: 20, valueLabelDisplay: "auto", value: EASLPlotSettings.theme.axisTickWidth, onChange: (e, v) => setEASLPlotSettings({
                                path: "theme.axisTickWidth",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Tick Label Font Size", labelwidth: "160px", max: 20, valueLabelDisplay: "auto", value: EASLPlotSettings.theme.axisTickLabelFontSize, onChange: (e, v) => setEASLPlotSettings({
                                path: "theme.axisTickLabelFontSize",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Tick Label Offset", labelwidth: "160px", max: 20, valueLabelDisplay: "auto", value: EASLPlotSettings.axisBottom.tickLabelPadding, onChange: (e, v) => setEASLPlotSettings({
                                path: "axisBottom.tickLabelPadding",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Tick Label Rotation", labelwidth: "160px", min: -90, max: 90, valueLabelDisplay: "auto", value: EASLPlotSettings.axisBottom.tickLabelRotation, onChange: (e, v) => setEASLPlotSettings({
                                path: "axisBottom.tickLabelRotation",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Axis Label Font Size", labelwidth: "160px", max: 30, valueLabelDisplay: "auto", value: EASLPlotSettings.theme.axisLegendTextFontSize, onChange: (e, v) => setEASLPlotSettings({
                                path: "theme.axisLegendTextFontSize",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Axis Label Offset", labelwidth: "160px", valueLabelDisplay: "auto", value: EASLPlotSettings.axisBottom.axisLabelTextOffset, onChange: (e, v) => setEASLPlotSettings({
                                path: "axisBottom.axisLabelTextOffset",
                                value: v,
                            }) })),
                    React.createElement(FormControl, { fullWidth: true },
                        React.createElement(FormLabel, null, "Y Axis Settings"),
                        React.createElement(Box, { py: 2, ml: 2 },
                            React.createElement(DebouncedInput, { fullWidth: true, label: "Y Axis Label", value: EASLPlotSettings.axisLeft.axisLabelText, onChange: (value) => {
                                    setEASLPlotSettings({
                                        path: "axisLeft.axisLabelText",
                                        value,
                                    });
                                }, debounceTime: 1000 })),
                        React.createElement(ControlledLabelSlider, { label: "Tick Height", labelwidth: "160px", max: 20, valueLabelDisplay: "auto", value: EASLPlotSettings.axisLeft.tickHeight, onChange: (e, v) => setEASLPlotSettings({
                                path: "axisLeft.tickHeight",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Tick Width", labelwidth: "160px", max: 20, valueLabelDisplay: "auto", value: EASLPlotSettings.theme.axisTickWidth, onChange: (e, v) => setEASLPlotSettings({
                                path: "theme.axisTickWidth",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Tick Label Font Size", labelwidth: "160px", max: 20, valueLabelDisplay: "auto", value: EASLPlotSettings.theme.axisTickLabelFontSize, onChange: (e, v) => setEASLPlotSettings({
                                path: "theme.axisTickLabelFontSize",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Tick Label Offset", labelwidth: "160px", max: 20, valueLabelDisplay: "auto", value: EASLPlotSettings.axisLeft.tickLabelPadding, onChange: (e, v) => setEASLPlotSettings({
                                path: "axisLeft.tickLabelPadding",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Tick Label Rotation", labelwidth: "160px", min: -90, max: 90, valueLabelDisplay: "auto", value: EASLPlotSettings.axisLeft.tickLabelRotation, onChange: (e, v) => setEASLPlotSettings({
                                path: "axisLeft.tickLabelRotation",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Axis Label Font Size", labelwidth: "160px", max: 30, valueLabelDisplay: "auto", value: EASLPlotSettings.theme.axisLegendTextFontSize, onChange: (e, v) => setEASLPlotSettings({
                                path: "theme.axisLegendTextFontSize",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Axis Label Offset", labelwidth: "160px", valueLabelDisplay: "auto", min: -100, max: 0, value: EASLPlotSettings.axisLeft.axisLabelTextOffset, onChange: (e, v) => setEASLPlotSettings({
                                path: "axisLeft.axisLabelTextOffset",
                                value: v,
                            }) })))))));
}
export default React.memo(SwarmPlotVisualsSettings);
//# sourceMappingURL=SwarmPlotVisualsSettings.js.map