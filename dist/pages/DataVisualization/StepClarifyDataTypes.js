import PersonSearchIcon from "@mui/icons-material/PersonSearch";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { Regex } from "../../common/utils/Regex";
import { atomDataVizCurrentStep, atomDataVizDFDTypes, atomSetDataVizDF, DataFrameMainTypeOptions, } from "../../stores/DataFrameVisualizationStore";
import HelpDataViz__StepClarifyDataTypes from "../Help/HelpDataViz__StepClarifyDataTypes";
import { FabDialogWrapper } from "../../components/WrapperComponents";
function StepClarifyDataTypes() {
    const dataFrameTypes = useAtomValue(atomDataVizDFDTypes);
    const setDataFrame = useSetAtom(atomSetDataVizDF);
    const setDataVizCurrentStep = useSetAtom(atomDataVizCurrentStep);
    const regexDefaultEASL = new Regex(`^(participant_id|session|LongitudinalTimePoint|SubjectNList)$`);
    function handleDTypeChange(event, colName) {
        const newDType = event.target.value;
        console.log(`Changing ${colName} to ${newDType} type`);
        setDataFrame({ col: colName, mainDtype: newDType });
    }
    // console.log("StepClarifyDataTypes -- dataFrameTypes: ", dataFrameTypes);
    return (dataFrameTypes && (React.createElement(React.Fragment, null,
        React.createElement(Box, { p: 2 },
            React.createElement(Card, { elevation: 2 },
                React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h4" }, "Specify Datatypes"), subheader: React.createElement(Typography, null, "Inform the program about whether columns are to be interpreted as Continuous or Categorical or outright Ignored"), avatar: React.createElement(Avatar, { sizes: "large" },
                        React.createElement(PersonSearchIcon, null)), action: React.createElement(FabDialogWrapper, { maxWidth: "xl", PaperProps: { sx: { minWidth: "499px" } }, sx: { marginTop: "40px" } },
                        React.createElement(HelpDataViz__StepClarifyDataTypes, null)) }),
                React.createElement(Divider, null),
                React.createElement(CardContent, null,
                    React.createElement(List, null,
                        React.createElement(ListItem, null,
                            React.createElement(Box, { width: "100%", display: "flex", justifyContent: "space-between" },
                                React.createElement(Typography, { variant: "h5" }, "Column Name"),
                                React.createElement(Typography, { variant: "h5" }, "Data Type"))),
                        Object.entries(dataFrameTypes).map(([columnName, dtype], colIdx) => {
                            if (typeof dtype !== "string")
                                return null;
                            return (React.createElement(ListItem, { key: `DataFrameDtypeClarifier__${columnName}_${colIdx}` },
                                React.createElement(Box, { width: "100%", display: "flex", alignItems: "center" },
                                    React.createElement(Typography, { noWrap: true, variant: "h5", flexBasis: "400px", mr: 10 }, columnName),
                                    React.createElement(Select, { disabled: !!regexDefaultEASL.search(columnName), fullWidth: true, value: dtype, onChange: (e) => handleDTypeChange(e, columnName) }, DataFrameMainTypeOptions.map((dtype, idx) => {
                                        return (React.createElement(MenuItem, { key: `DataFrameDtypeClarifier__${columnName}_${idx}`, value: dtype }, dtype));
                                    })))));
                        }))))),
        React.createElement(Paper, { elevation: 10, sx: {
                position: "fixed",
                left: 0,
                bottom: 0,
                width: "100%",
                borderRadius: 0,
                display: "flex",
                justifyContent: "space-between",
            } },
            React.createElement(Button, { onClick: () => setDataVizCurrentStep("DefinePaths") }, "Back to Loading Spreadsheets"),
            React.createElement(Button, { onClick: () => setDataVizCurrentStep("Plotting") }, "Go to Plotting")))));
}
export default React.memo(StepClarifyDataTypes);
//# sourceMappingURL=StepClarifyDataTypes.js.map