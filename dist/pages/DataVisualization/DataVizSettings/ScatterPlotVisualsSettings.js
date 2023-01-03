import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Avatar from "@mui/material/Avatar";
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
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { DebouncedInput } from "../../../components/DebouncedComponents";
import ScatterPlotIcon from "../../../assets/svg/ScatterGraph.svg";
import ExpandMore from "../../../components/ExpandMore";
import { ControlledLabelSlider, ControlledLabelSwitch, } from "../../../components/RegularFormComponents/ControlLabelGrid";
import { atomEASLScatterplotSettings, atomSetEASLScatterplotSettings, } from "../../../stores/DataFrameVisualizationStore";
import ColorSelect from "../ColorSelect";
import Box from "@mui/material/Box";
function ScatterPlotVisualsSettings() {
    const [expanded, setExpanded] = React.useState(true);
    const EASLPlotSettings = useAtomValue(atomEASLScatterplotSettings);
    const setEASLPlotSettings = useSetAtom(atomSetEASLScatterplotSettings);
    return (React.createElement(Card, { elevation: 1, sx: { margin: 0.5, pr: 1 } },
        React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h5" }, "Scatter Plot Visuals"), subheader: React.createElement(Typography, { variant: "subtitle1" }, "Control specifics about the scatterplot axes/margins/etc."), avatar: React.createElement(Avatar, null,
                React.createElement(SvgIcon, { component: ScatterPlotIcon, inheritViewBox: true, fontSize: "large" })), action: React.createElement(ExpandMore, { expand: expanded, onClick: () => setExpanded(!expanded), "aria-expanded": expanded, "aria-label": "show more" },
                React.createElement(ExpandMoreIcon, null)) }),
        React.createElement(Collapse, { in: expanded },
            React.createElement(CardContent, null,
                React.createElement(Stack, { spacing: 2 },
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
                        React.createElement(ControlledLabelSlider, { label: "Size", labelwidth: "150px", max: 50, valueLabelDisplay: "auto", value: EASLPlotSettings.nodeSize, onChange: (e, v) => setEASLPlotSettings({
                                path: "nodeSize",
                                value: v,
                            }) })),
                    React.createElement(FormControl, { fullWidth: true },
                        React.createElement(FormLabel, null, "Margins"),
                        React.createElement(ControlledLabelSlider, { label: "Left", labelwidth: "100px", min: -100, max: 500, valueLabelDisplay: "auto", value: EASLPlotSettings.margins.left, onChange: (e, v) => setEASLPlotSettings({
                                path: "margins.left",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Top", labelwidth: "100px", min: -100, max: 500, valueLabelDisplay: "auto", value: EASLPlotSettings.margins.top, onChange: (e, v) => setEASLPlotSettings({
                                path: "margins.top",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Right", labelwidth: "100px", min: -100, max: 500, valueLabelDisplay: "auto", value: EASLPlotSettings.margins.right, onChange: (e, v) => setEASLPlotSettings({
                                path: "margins.right",
                                value: v,
                            }) }),
                        React.createElement(ControlledLabelSlider, { label: "Bottom", labelwidth: "100px", min: -100, max: 500, valueLabelDisplay: "auto", value: EASLPlotSettings.margins.bottom, onChange: (e, v) => setEASLPlotSettings({
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
                            }) })),
                    React.createElement(FormControl, { fullWidth: true },
                        React.createElement(FormLabel, null, "Legend Settings"),
                        React.createElement(Stack, { spacing: 2, mt: 2 },
                            React.createElement(FormControl, { fullWidth: true },
                                React.createElement(InputLabel, null, "Main Anchor"),
                                React.createElement(Select, { fullWidth: true, label: "Main Anchor", value: EASLPlotSettings.legends[0].anchor, onChange: (e) => {
                                        setEASLPlotSettings({
                                            path: "legends.0.anchor",
                                            value: e.target.value,
                                        });
                                    } },
                                    React.createElement(MenuItem, { value: "top" }, "Top"),
                                    React.createElement(MenuItem, { value: "left" }, "Left"),
                                    React.createElement(MenuItem, { value: "bottom" }, "Bottom"),
                                    React.createElement(MenuItem, { value: "right" }, "Right"))),
                            React.createElement(FormControl, { fullWidth: true },
                                React.createElement(InputLabel, null, "Legend Direction"),
                                React.createElement(Select, { fullWidth: true, label: "Legend Direction", value: EASLPlotSettings.legends[0].direction, onChange: (e) => {
                                        setEASLPlotSettings({
                                            path: "legends.0.direction",
                                            value: e.target.value,
                                        });
                                    } },
                                    React.createElement(MenuItem, { value: "row" }, "Row"),
                                    React.createElement(MenuItem, { value: "column" }, "Column"))),
                            React.createElement(FormControl, { fullWidth: true },
                                React.createElement(InputLabel, null, "Item Packing Order"),
                                React.createElement(Select, { fullWidth: true, label: "Item Packing Order", value: EASLPlotSettings.legends[0].itemDirection, onChange: (e) => {
                                        setEASLPlotSettings({
                                            path: "legends.0.itemDirection",
                                            value: e.target.value,
                                        });
                                    } },
                                    React.createElement(MenuItem, { value: "left-to-right" }, "Left-To-Right"),
                                    React.createElement(MenuItem, { value: "right-to-left" }, "Right-To-Left"),
                                    React.createElement(MenuItem, { value: "top-to-bottom" }, "Top-To-Bottom"),
                                    React.createElement(MenuItem, { value: "bottom-to-top" }, "Bottom-To-Top"))),
                            React.createElement(FormControl, null,
                                React.createElement(ControlledLabelSlider, { label: "Translate X", labelwidth: "160px", valueLabelDisplay: "auto", min: -300, max: 300, value: EASLPlotSettings.legends[0].translateX, onChange: (e, v) => setEASLPlotSettings({
                                        path: "legends.0.translateX",
                                        value: v,
                                    }) }),
                                React.createElement(ControlledLabelSlider, { label: "Translate Y", labelwidth: "160px", valueLabelDisplay: "auto", min: -300, max: 300, value: EASLPlotSettings.legends[0].translateY, onChange: (e, v) => setEASLPlotSettings({
                                        path: "legends.0.translateY",
                                        value: v,
                                    }) }),
                                React.createElement(ControlledLabelSlider, { label: "Items Spacing", labelwidth: "160px", valueLabelDisplay: "auto", min: 0, max: 300, value: EASLPlotSettings.legends[0].itemsSpacing, onChange: (e, v) => setEASLPlotSettings({
                                        path: "legends.0.itemsSpacing",
                                        value: v,
                                    }) }),
                                React.createElement(ControlledLabelSlider, { label: "Legend Item Width", labelwidth: "160px", valueLabelDisplay: "auto", min: 0, max: 300, value: EASLPlotSettings.legends[0].itemWidth, onChange: (e, v) => setEASLPlotSettings({
                                        path: "legends.0.itemWidth",
                                        value: v,
                                    }) }),
                                React.createElement(ControlledLabelSlider, { label: "Legend Item Height", labelwidth: "160px", valueLabelDisplay: "auto", min: 0, max: 300, value: EASLPlotSettings.legends[0].itemHeight, onChange: (e, v) => setEASLPlotSettings({
                                        path: "legends.0.itemHeight",
                                        value: v,
                                    }) }))),
                        React.createElement(FormControl, { fullWidth: true, sx: { mt: 2 } },
                            React.createElement(FormLabel, null, "Legend Symbol Properties"),
                            React.createElement(Stack, { spacing: 2 },
                                React.createElement(ControlledLabelSlider, { label: "Symbol Size", labelwidth: "160px", valueLabelDisplay: "auto", min: 0, max: 30, value: EASLPlotSettings.legends[0].symbolSize, onChange: (e, v) => setEASLPlotSettings({
                                        path: "legends.0.symbolSize",
                                        value: v,
                                    }) })),
                            React.createElement(ControlledLabelSlider, { label: "Label Font Size", labelwidth: "160px", valueLabelDisplay: "auto", min: 0, max: 50, value: EASLPlotSettings.theme.legendTextFontSize, onChange: (e, v) => setEASLPlotSettings({
                                    path: "theme.legendTextFontSize",
                                    value: v,
                                }) }))))))));
}
export default React.memo(ScatterPlotVisualsSettings);
//# sourceMappingURL=ScatterPlotVisualsSettings.js.map