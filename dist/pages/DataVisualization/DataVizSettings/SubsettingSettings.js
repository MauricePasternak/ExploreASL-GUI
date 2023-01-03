import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VerticalSplitIcon from "@mui/icons-material/VerticalSplit";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Collapse from "@mui/material/Collapse";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import ExpandMore from "../../../components/ExpandMore";
import { atomOfAtomsDataVizSubsetOperations, atomSetAddPredicate } from "../../../stores/DataFrameVisualizationStore";
import SingleSubsetter from "./SingleSubsetter";
function SubsettingSettings() {
    const [expanded, setExpanded] = React.useState(true);
    const atomsSubsetOperations = useAtomValue(atomOfAtomsDataVizSubsetOperations);
    const addSubsetOperation = useSetAtom(atomSetAddPredicate);
    return (React.createElement(Card, { elevation: 1, sx: { margin: 0.5 } },
        React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h5" }, "Subsetting Settings"), subheader: React.createElement(Typography, { variant: "subtitle1" }, "Control how subsets of the data can be presented"), avatar: React.createElement(Avatar, null,
                React.createElement(VerticalSplitIcon, null)), action: React.createElement(ExpandMore, { expand: expanded, onClick: () => setExpanded(!expanded), "aria-expanded": expanded, "aria-label": "show more" },
                React.createElement(ExpandMoreIcon, null)) }),
        React.createElement(Collapse, { in: expanded },
            React.createElement(CardContent, null,
                React.createElement(Stack, { spacing: 2 },
                    React.createElement(Button, { fullWidth: true, onClick: addSubsetOperation, endIcon: React.createElement(AddCircleOutlineIcon, null) }, "Add a new subsetter"),
                    atomsSubsetOperations.map((atomPredicateFormula, subsetterIndex) => {
                        return (React.createElement(SingleSubsetter, { key: `${atomPredicateFormula}`, atomPredicateFormula: atomPredicateFormula, subsetterIndex: subsetterIndex }));
                    }))))));
}
export default SubsettingSettings;
//# sourceMappingURL=SubsettingSettings.js.map