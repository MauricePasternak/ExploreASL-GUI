import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";
import ExploreASLWorkflowImage from "../../../assets/img/EASLWorkflow.png";
export function AboutWorkflow() {
    return (React.createElement(Paper, { component: "section", sx: { width: "100%", maxWidth: 2160 } },
        React.createElement(Accordion, null,
            React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                React.createElement(Typography, { variant: "h4", component: "h1" }, "Workflow")),
            React.createElement(AccordionDetails, { sx: { display: "flex", flexDirection: "column" } },
                React.createElement(Divider, { style: { width: "100%", marginBottom: "1rem" } }),
                React.createElement("img", { src: ExploreASLWorkflowImage, style: { alignSelf: "center", width: "min(75%, 1200px)" } })))));
}
//# sourceMappingURL=AboutWorkflow.js.map