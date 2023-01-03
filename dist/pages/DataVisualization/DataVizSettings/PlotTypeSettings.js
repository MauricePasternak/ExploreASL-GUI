import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Avatar from "@mui/material/Avatar";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Collapse from "@mui/material/Collapse";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React from "react";
import FunctionVariableIcon from "../../../assets/svg/FunctionVariable.svg";
import ExpandMore from "../../../components/ExpandMore";
import { atomDataVizDFDTypes, atomNivoGraphDataVariablesSchema, atomNivoGraphType, atomSetEASLScatterplotSettings, atomSetEASLSwarmplotSettings, } from "../../../stores/DataFrameVisualizationStore";
function PlotTypeSettings() {
    const [expanded, setExpanded] = React.useState(true);
    const dtypes = useAtomValue(atomDataVizDFDTypes);
    const [nivoGraphType, setNivoGraphType] = useAtom(atomNivoGraphType);
    const [nivoGraphDataSchema, setNivoGraphDataSchema] = useAtom(atomNivoGraphDataVariablesSchema);
    const setEASLScatterplotSettings = useSetAtom(atomSetEASLScatterplotSettings);
    const setEASLSwarmplotSettings = useSetAtom(atomSetEASLSwarmplotSettings);
    function renderOptions(permittedType, prefix = "PlotTypeOption", disabledCondition = []) {
        console.log(`renderOptions for prefix ${prefix} -- permittedType: `, permittedType);
        return Object.entries(dtypes)
            .map(([colName, dtype], colIdx) => {
            if (colName === "SUBJECT" || (dtype !== permittedType && permittedType !== "Any"))
                return null;
            return (React.createElement(MenuItem, { key: `${prefix}__${colIdx}`, value: colName, disabled: disabledCondition.includes(colName) ||
                    colName === nivoGraphDataSchema.XAxisVar ||
                    colName === nivoGraphDataSchema.YAxisVar }, colName));
        })
            .filter(x => x !== null);
    }
    const handleChangeYAxis = (e) => {
        setNivoGraphDataSchema(Object.assign(Object.assign({}, nivoGraphDataSchema), { HoverVariables: nivoGraphDataSchema.HoverVariables
                ? nivoGraphDataSchema.HoverVariables.filter(l => l !== e.target.value)
                : [], YAxisVar: e.target.value }));
        nivoGraphType === "Scatterplot"
            ? setEASLScatterplotSettings({ path: "axisLeft.axisLabelText", value: e.target.value })
            : setEASLSwarmplotSettings({ path: "axisLeft.axisLabelText", value: e.target.value });
    };
    const handleChangeXAxis = (e) => {
        setNivoGraphDataSchema(Object.assign(Object.assign({}, nivoGraphDataSchema), { HoverVariables: nivoGraphDataSchema.HoverVariables
                ? nivoGraphDataSchema.HoverVariables.filter(l => l !== e.target.value)
                : [], XAxisVar: e.target.value }));
        nivoGraphType === "Scatterplot"
            ? setEASLScatterplotSettings({ path: "axisBottom.axisLabelText", value: e.target.value })
            : setEASLSwarmplotSettings({ path: "axisBottom.axisLabelText", value: e.target.value });
    };
    return (React.createElement(Card, { elevation: 1, sx: { margin: 0.5 } },
        React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h5" }, "Plot Variables"), subheader: React.createElement(Typography, { variant: "subtitle1" }, "Define which columns should be plotted and the graph type"), avatar: React.createElement(Avatar, null,
                React.createElement(SvgIcon, { component: FunctionVariableIcon, inheritViewBox: true })), action: React.createElement(ExpandMore, { expand: expanded, onClick: () => setExpanded(!expanded), "aria-expanded": expanded, "aria-label": "show more" },
                React.createElement(ExpandMoreIcon, null)) }),
        React.createElement(Collapse, { in: expanded },
            React.createElement(CardContent, null,
                React.createElement(Stack, { spacing: 2 },
                    React.createElement(FormControl, { fullWidth: true, className: "PlotTypeSetting__GraphType__FormControl" },
                        React.createElement(InputLabel, null, "Graph Type"),
                        React.createElement(Select, { fullWidth: true, label: "Graph Type", value: nivoGraphType, onChange: e => {
                                setNivoGraphType(e.target.value);
                                setNivoGraphDataSchema(Object.assign(Object.assign({}, nivoGraphDataSchema), { XAxisVar: "", YAxisVar: "", GroupingVar: "" }));
                            } }, ["Scatterplot", "Swarmplot"].map((gType, gTypeIdx) => {
                            return (React.createElement(MenuItem, { key: `GraphTypeMenuItem__${gTypeIdx}`, value: gType }, gType));
                        }))),
                    React.createElement(FormControl, { fullWidth: true, className: "PlotTypeSetting__XAxis__FormControl" },
                        React.createElement(InputLabel, null, "X Axis"),
                        React.createElement(Select, { fullWidth: true, label: "X Axis", value: nivoGraphDataSchema.XAxisVar, onChange: handleChangeXAxis }, renderOptions(nivoGraphType === "Swarmplot" ? "Categorical" : "Continuous", "XAxisVar"))),
                    React.createElement(FormControl, { fullWidth: true, className: "PlotTypeSetting__YAxis__FormControl" },
                        React.createElement(InputLabel, null, "Y Axis"),
                        React.createElement(Select, { fullWidth: true, label: "Y Axis", value: nivoGraphDataSchema.YAxisVar, onChange: handleChangeYAxis }, renderOptions("Continuous", "YAxisVar"))),
                    nivoGraphType === "Scatterplot" && (React.createElement(FormControl, { fullWidth: true, className: "PlotTypeSetting__Color__FormControl" },
                        React.createElement(InputLabel, null, "Color"),
                        React.createElement(Select, { fullWidth: true, label: "Color", value: nivoGraphDataSchema.GroupingVar, onChange: e => {
                                setNivoGraphDataSchema(Object.assign(Object.assign({}, nivoGraphDataSchema), { GroupingVar: e.target.value }));
                            } }, renderOptions("Categorical", "GroupingVar", [nivoGraphDataSchema.XAxisVar])))),
                    React.createElement(FormControl, { fullWidth: true, className: "PlotTypeSetting__HoverData__FormControl" },
                        React.createElement(InputLabel, null, "Additional Hover Data"),
                        React.createElement(Select, { fullWidth: true, multiple: true, label: "Additional Hover Data", value: nivoGraphDataSchema.HoverVariables, onChange: e => setNivoGraphDataSchema(Object.assign(Object.assign({}, nivoGraphDataSchema), { HoverVariables: e.target.value })) }, renderOptions("Any", "HoverVariables"))))))));
}
export default React.memo(PlotTypeSettings);
//# sourceMappingURL=PlotTypeSettings.js.map