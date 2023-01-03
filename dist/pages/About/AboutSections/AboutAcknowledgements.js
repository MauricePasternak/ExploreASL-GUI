import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";
export function AboutAcknowledgements() {
    return (React.createElement(Paper, { component: "section", sx: { width: "100%", maxWidth: 2160 } },
        React.createElement(Accordion, null,
            React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                React.createElement(Typography, { variant: "h4", component: "h1" }, "Acknowledgements")),
            React.createElement(AccordionDetails, null,
                React.createElement(Divider, { style: { width: "100%", marginBottom: "1rem" } }),
                React.createElement("p", null, "A deep thanks to Dr. Vera C. Keil (Department of Radiology Amsterdam UMC, VUmc) for her contributions and advocacy of the \"A Beginner\u2019s Guide to Arterial Spin Labeling (ASL) Image Processing\" paper which will feature this program as a core tool.")))));
}
//# sourceMappingURL=AboutAcknowledgements.js.map