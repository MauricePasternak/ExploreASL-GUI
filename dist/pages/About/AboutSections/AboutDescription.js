import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";
import { SecureLink } from "../../../components/NavComponents";
export function AboutDescription() {
    return (React.createElement(Paper, { component: "section", sx: { maxWidth: 2160 } },
        React.createElement(Accordion, null,
            React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                React.createElement(Typography, { variant: "h4", component: "h1" }, "Description")),
            React.createElement(AccordionDetails, null,
                React.createElement(Divider, { style: { width: "100%", marginBottom: "1rem" } }),
                React.createElement(Typography, null, "ExploreASL is a \"from scanner to data analysis & publication\" pipeline for the processing and statistical analysis of arterial spin labeling (ASL) perfusion MR images. It has been designed to be compatible across all 3 major operating systems (Windows, MacOS, and Linux), open source, and a collaborative framework to facilitate input from image analytics and clinical investigators worldwide."),
                React.createElement("br", null),
                React.createElement("p", null,
                    "ExploreASL is opinionated and enforces a",
                    " ",
                    React.createElement(SecureLink, { href: "https://bids.neuroimaging.io/" }, "Brain Imaging Data Structure (BIDS)"),
                    " standard to support consistency between datasets across investigators."),
                React.createElement("br", null),
                "Please remember to reference",
                " ",
                React.createElement(SecureLink, { href: "https://www.sciencedirect.com/science/article/pii/S1053811920305176" }, "the following paper"),
                " ",
                "in the event that this software is used in a publication:",
                React.createElement("br", null),
                React.createElement(Typography, { sx: {
                        mt: 2,
                        fontSize: "1.1rem",
                        fontWeight: 600,
                        padding: 1,
                        borderRadius: 2,
                        bgcolor: (theme) => (theme.palette.mode === "light" ? theme.palette.grey[100] : theme.palette.grey[800]),
                    } }, "Mutsaerts HJMM, Petr J, Groot P, et al. ExploreASL: an image processing pipeline for multi-center ASL perfusion MRI studies. Neuroimage. 2020;219:117031. doi:10.1016/j.neuroimage.2020.117031")))));
}
//# sourceMappingURL=AboutDescription.js.map