import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import DialogContent from "@mui/material/DialogContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import React, { useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { DialogTitleH4 } from "../../components/TypographyComponents/DialogTitle";
import DialogContentText from "@mui/material/DialogContentText";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import HelperImage__ImportScanAliasOutput from "../../assets/img/HelperImages/HelperImage__ImportScanAliasOutput.png";
import HelperImage__ImportVisitAliasRawdataOutput from "../../assets/img/HelperImages/HelperImage__ImportVisitAliasRawdataOutput.png";
import HelperImage__ImportVisitAliasDerivativesOutput from "../../assets/img/HelperImages/HelperImage__ImportVisitAliasDerivativesOutput.png";
import { BulletPointList } from "./HelpStyledComponents";
function HelpImport__StepDefineAliases() {
    const [expanded, setExpanded] = useState(false);
    const handleAccordionChange = (panel) => (event, isExpanded) => {
        setExpanded(isExpanded ? panel : false);
    };
    return (React.createElement(React.Fragment, null,
        React.createElement(DialogTitleH4, null, "Help Page Defining Aliases"),
        React.createElement(DialogContent, null,
            React.createElement(Stack, { spacing: 1 },
                React.createElement(DialogContentText, null, "Select a question that best describes your concern."),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__whathappensinscanaliases", onChange: handleAccordionChange("panel__whathappensinscanaliases") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "What do I specify in Scan Aliases?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "In this section, you assist the program in understanding what folder names correspond to which type of MRI image that they uniquely contain (i.e. you can't have a folder called \"structural\" that contains BOTH T1w and T2w DICOM files, each image type must be allocated to its own folder)."),
                            React.createElement("br", null),
                            React.createElement("p", null, "When you earlier specified the folder depth at which folders containing scan information are found, the left portion of this widget was populated with the file names of those folders."),
                            React.createElement("br", null),
                            React.createElement("p", null, "From here, the user specifies, via dropdown, which folders are which type of accepted scan. The accepted scan types are:"),
                            React.createElement(BulletPointList, null,
                                React.createElement("li", null, "ASL Functional Scans"),
                                React.createElement("li", null, "Proton-density (M0) Scans"),
                                React.createElement("li", null, "T1-weighted Structural Scans"),
                                React.createElement("li", null, "T2-weighted Structural Scans"),
                                React.createElement("li", null, "FLAIR Structural Scans"),
                                React.createElement("li", null, "and the option to ignore a particular folder")),
                            React.createElement("br", null),
                            React.createElement("p", null, "At least one folder name must be specified. By default, all others will be ignored. Here is an example of the import taking place and how these scans are organized in the output:"),
                            React.createElement("br", null),
                            React.createElement(Box, { mx: "auto", display: "block", maxWidth: 600, component: "img", src: HelperImage__ImportScanAliasOutput })))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__whathappensinvisitaliases", onChange: handleAccordionChange("panel__whathappensinvisitaliases") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "What do I specify in Visit Aliases?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "In this section, you tell the program what you'd like the output folder name for various visits to be. Sometimes scanners can output nonsensical visit names, and this is an oppurtunity for you to change them into something more human-understandable in the rawdata and derivatives output. By default, no alias change happens - the aliases are the same as the original names, resulting in the same names carrying over into the output."),
                            React.createElement("br", null),
                            React.createElement("p", null, "Note that all aliases you specify must be unique."),
                            React.createElement("br", null),
                            React.createElement("p", null, "Here is an example of how visit aliases carry over to the rawdata section:"),
                            React.createElement("br", null),
                            React.createElement(Box, { mx: "auto", display: "block", maxWidth: 600, component: "img", src: HelperImage__ImportVisitAliasRawdataOutput }),
                            React.createElement("br", null),
                            React.createElement("p", null,
                                "Here is an example of how visit aliases ",
                                React.createElement("strong", null, "DO NOT"),
                                " carry over to the ExploreASL derivative. Instead, each visit is demarcated by a suffix ending in an underscore and a number."),
                            React.createElement("br", null),
                            React.createElement(Box, { mx: "auto", display: "block", maxWidth: 600, component: "img", src: HelperImage__ImportVisitAliasDerivativesOutput }))))))));
}
export default React.memo(HelpImport__StepDefineAliases);
//# sourceMappingURL=HelpImport__StepDefineAliases.js.map