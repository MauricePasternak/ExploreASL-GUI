import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import Stack from "@mui/material/Stack";
import React, { useState } from "react";
import { DialogTitleH4 } from "../../components/TypographyComponents/DialogTitle";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import AccordionDetails from "@mui/material/AccordionDetails";
import { BulletPointList, NumberedPointList } from "./HelpStyledComponents";
import Box from "@mui/material/Box";
import HelperImage__ProcessStudiesLogsLocation from "../../assets/img/HelperImages/HelperImage__ProcessStudiesLogsLocation.png";
function HelpProcessStudies__RunEASL() {
    const { api } = window;
    const [expanded, setExpanded] = useState(false);
    const handleAccordionChange = (panel) => (event, isExpanded) => {
        setExpanded(isExpanded ? panel : false);
    };
    return (React.createElement(React.Fragment, null,
        React.createElement(DialogTitleH4, null, "Help Page Run ExploreASL"),
        React.createElement(DialogContent, null,
            React.createElement(Stack, { spacing: 1 },
                React.createElement(DialogContentText, null, "Select a question that best describes your concern."),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__numberofcores", onChange: handleAccordionChange("panel__numberofcores") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "What does changing the \"Number of Cores\" do within a study?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "This program supports multiprocessing in order to make the most out of your workstation. By allocating more cores towards a study, that study's subjects are distributed to different processing cores, allowing for analysis of each to occur in parallel. In theory, this provides a speedup equal to the number of cores you give.\u00A0"),
                            React.createElement("br", null),
                            React.createElement("p", null, "Be warned, however, that analysing multiple subjects in parallel is a very demanding task for your computer. It is strongly recommended that all other background tasks (i.e. Chrome, Office, etc.) are turned off if you plan to use all (or nearly all) available cores."),
                            React.createElement("br", null),
                            React.createElement("p", null,
                                "Furthermore, as a rough estimate,",
                                " ",
                                React.createElement("strong", null, "treat each additional core as an extra load on your systems memory by a generous 3.5GB"),
                                ". This means that:"),
                            React.createElement(BulletPointList, null,
                                React.createElement("br", null),
                                React.createElement("li", null, "for a 4GB workstation, you should just use 1 core for only 1 study"),
                                React.createElement("li", null, "for an 8GB workstation, you should not allocate more than 2 cores at any given time."),
                                React.createElement("li", null, "for a 16GB workstation, you should not allocate more than 4 cores at any given time."),
                                React.createElement("li", null, "for a 32GB workstation, you should not allocate more than 9 cores at any given time."),
                                React.createElement("li", null, "for a 64GB workstation, you should not allocate more than 18 cores at any given time."),
                                React.createElement("li", null, "Etc.")),
                            React.createElement("br", null),
                            React.createElement("p", null, "Exceeding this value results in overwhelming your system's memory capacity, completely negating the speed boost this otherwise provides, in addition to increasing the risk of crashes and data corruption.")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__safetostopmidway", onChange: handleAccordionChange("panel__safetostopmidway") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "Is it safe to stop a study mid-way?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null,
                                "Due to the nature of inter-program communication, it is possible that data may be corrupted if the stop button is pressed at just the right millisecond while a file transfer is going on. As such, terminating a study manually is meant to be used in the case",
                                " ",
                                React.createElement("strong", null, "when ExploreASL has clearly been frozen for an extended period of time and no data transfer is happening"),
                                " ",
                                "anyway. In which case, there is no reason to believe that data will become corrupted."),
                            React.createElement("br", null),
                            React.createElement("p", null, "If you do terminate a study forcefully, it is recommended that you re-run said study starting from the Structural Module. If you are uncertain, you can even go back further and just restart from the Import Module (as DICOM files are not touched and should not be corrupted here).")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel_whyonlyonecoreforpopulationmodule", onChange: handleAccordionChange("panel_whyonlyonecoreforpopulationmodule") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "Why can't I select more than one core for a given study when the Population Module is indicated?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "This is due to the nature of the operations taking place within the Population Module. MATLAB (without pricey extensions) does not support a sharing computer memory pool between cores. Therefore, only one core can act upon a Population Module as it is certain to have access to all the memory it will need.")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel_runningdifferentanalysesonsamestudy", onChange: handleAccordionChange("panel_runningdifferentanalysesonsamestudy") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "Can I run two or more different analyses on the same dataset in parallel?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "Unfortunately, this is the limitation of this program. You can run an analysis for:"),
                            React.createElement(BulletPointList, null,
                                React.createElement("li", null, "One study on one core."),
                                React.createElement("li", null, "Multiple different studies with one core per study."),
                                React.createElement("li", null, "Multiple different studies with multiple cores per study.")),
                            React.createElement("br", null),
                            React.createElement("p", null, "But you cannot run the same study in parallel with different settings."),
                            React.createElement("br", null),
                            React.createElement("p", null, "What you can do, however, is make a copy of the study, name it something different, and then run that copy in parallel with the original. That essentially accomplishes the same desired goal, with the main caveat being that additional disk space is being taken up by copies you make."),
                            React.createElement("br", null),
                            React.createElement("p", null, "You should also keep in mind that you'll have to re-run the Define Parameters part of the program for the copy you make, as it will have a different Study Root Path than the original, and the dataPar.json needs to be updated about that change.")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__howcanIrerunastudy", onChange: handleAccordionChange("panel__howcanIrerunastudy") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "How can I re-run a study with different parameters?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "In general, the following steps would have to be taken:"),
                            React.createElement(NumberedPointList, null,
                                React.createElement("li", null, "Go to the \"Define Parameters\" section of this program."),
                                React.createElement("li", null, "Load in the existing parameters, alter as needed, and save back to overwrite the existing dataPar.json file."),
                                React.createElement("li", null, "Go to the \"Prepare a re-run\" tab in this module and indicate which sections/subjects/etc. should be re-run."),
                                React.createElement("li", null, "Re-run the study."))))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__whatisstudyrootfolder", onChange: handleAccordionChange("panel__whatisstudyrootfolder") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "It says the study did not finish all anticipated steps? Where can I see what's wrong?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "All ExploreASL operations have log files generated under"),
                            React.createElement("br", null),
                            React.createElement("strong", null, api.platform === "win32"
                                ? "STUDYROOTderivativesExploreASLlog"
                                : "STUDYROOT/derivatives/ExploreASL/log"),
                            React.createElement("br", null),
                            React.createElement("br", null),
                            React.createElement(Box, { mx: "auto", display: "block", maxWidth: 500, component: "img", src: HelperImage__ProcessStudiesLogsLocation }),
                            React.createElement("br", null),
                            React.createElement("br", null),
                            React.createElement("p", null,
                                "You can visit the recent log file that was generated to determine the nature of the error. If hoping to communicate with the ExploreASL team about the error,",
                                " ",
                                React.createElement("strong", null, "including said log file as well as the dataPar.json file used when the study was processed"),
                                " ",
                                "would be most helpful in figuring out the nature of what went wrong."))))))));
}
export default HelpProcessStudies__RunEASL;
//# sourceMappingURL=HelpProcessStudies__RunEASL.js.map