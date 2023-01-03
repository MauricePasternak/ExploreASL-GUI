import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import Stack from "@mui/material/Stack";
import React, { useState } from "react";
import { DialogTitleH4 } from "../../components/TypographyComponents/DialogTitle";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import AccordionDetails from "@mui/material/AccordionDetails";
import { BulletPointList } from "./HelpStyledComponents";
import HelperImage__ProcessStudiesStudyRootExample from "../../assets/img/HelperImages/HelperImage__ProcessStudiesStudyRootExample.png";
import Box from "@mui/material/Box";
function HelpProcessStudies__PrepareAReRun() {
    const [expanded, setExpanded] = useState(false);
    const handleAccordionChange = (panel) => (event, isExpanded) => {
        setExpanded(isExpanded ? panel : false);
    };
    return (React.createElement(React.Fragment, null,
        React.createElement(DialogTitleH4, null, "Help Page Prepare A Re-Run"),
        React.createElement(DialogContent, null,
            React.createElement(Stack, { spacing: 1 },
                React.createElement(DialogContentText, null, "Select a question that best describes your concern."),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__whatisstudyrootfolder", onChange: handleAccordionChange("panel__whatisstudyrootfolder") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "What is the Study Root Folder?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "This is the root folder of your overall study that should adhere to Brain Imaging Data Structure (BIDS) standard in order to be useable by ExploreASL."),
                            React.createElement("br", null),
                            React.createElement("p", null, "After running the Import module, your study's root folder should contain 3 subfolders that follow BIDS format:"),
                            React.createElement(BulletPointList, null,
                                React.createElement("li", null, "sourcedata, containing the initial scanner data"),
                                React.createElement("li", null, "rawdata, converted scans into NIFTI format"),
                                React.createElement("li", null, "derivatives, analyses of NIFTI data")),
                            React.createElement("br", null),
                            React.createElement("p", null, "This root folder is the filepath that should be provided to this field."),
                            React.createElement("br", null),
                            React.createElement(Box, { mx: "auto", display: "block", maxWidth: 700, component: "img", src: HelperImage__ProcessStudiesStudyRootExample })))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__howdoesthisprepareforarerun", onChange: handleAccordionChange("panel__howdoesthisprepareforarerun") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "So what does checking the boxes do? How does this prepare for a re-run?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "ExploreASL keeps track of completed steps using its own \".status\" files. This is done so that if the program somehow crashes halfway through, the steps that were already successfully completed do not have to be re-run again."),
                            React.createElement("br", null),
                            React.createElement("p", null, "Therefore, this part of the program allows you to select which particular sections need to be re-run. You can select either everything, a module, a particular subject in a module, or even just a particular step. Once selected, just press the button and the particular files will be deleted, allowing ExploreASL to re-do those steps when you run it the next time.")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__cantIusemyownsystemsfileexplorer", onChange: handleAccordionChange("panel__cantIusemyownsystemsfileexplorer") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "Can't I use my own computer's file explorer to get the same outcome?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "You can certainly do this manually with your own system's file explorer. You do not have to use this part of the program. It's mostly here for your own convenience and safety. For example, this program will prevent you from re-running a study that is actively running in order to avoid the chance of data corruption. The same safety is not provided if you use your system's file explorer."))))))));
}
export default HelpProcessStudies__PrepareAReRun;
//# sourceMappingURL=HelpProcessStudies__PrepareAReRun.js.map