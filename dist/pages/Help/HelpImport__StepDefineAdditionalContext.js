import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import React, { useState } from "react";
import { DialogTitleH4 } from "../../components/TypographyComponents/DialogTitle";
import { SecureLink } from "../../components/NavComponents";
import { BulletPointList } from "./HelpStyledComponents";
import HelperImage__ImportPostLabelingDelay from "../../assets/img/HelperImages/HelperImage__ImportPostLabelingDelay.png";
import Box from "@mui/material/Box";
function HelpImport__StepDefineAdditionalContext() {
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
                    React.createElement(Accordion, { expanded: expanded === "panel__whatisaslcontext", onChange: handleAccordionChange("panel__whatisaslcontext") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "What is ASL Context?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "In short, it is context that specifies the ordering of types of image volumes are contained within the ASL series acquisition. Typically an ASL series output from a scanner may contain the following volumes:"),
                            React.createElement("br", null),
                            React.createElement(BulletPointList, null,
                                React.createElement("li", null, "A control image"),
                                React.createElement("li", null, "A labeled (tag) image"),
                                React.createElement("li", null, "An M0 image"),
                                React.createElement("li", null, "A pre-calculated perfusion-weighted image (deltam)"),
                                React.createElement("li", null, "A pre-calculated cerebral blood flow image according to calculations done within the scanner (cbf)"),
                                React.createElement("li", null, "Any of the above, but as unwanted \"dummy\" volumes that should be discarded.")),
                            React.createElement("br", null),
                            React.createElement("p", null, "Fortunately, 99% of cases fall into only 4 categories of output, which a user should specify:"),
                            React.createElement(BulletPointList, null,
                                React.createElement("li", null, "Alternating control-label volumes with or without M0 located within"),
                                React.createElement("li", null, "Alternative label-control volumes with or without M0 located within"),
                                React.createElement("li", null, "Deltam volumes with accompanying M0 scans"),
                                React.createElement("li", null, "CBF volumes")),
                            React.createElement("br", null),
                            React.createElement("p", null, "In order for the program to comprehend the ASL context that your study follows, it must have 4 pieces of information:"),
                            React.createElement(BulletPointList, null,
                                React.createElement("li", null, "Which of the 4 patterns (see above) your study matches"),
                                React.createElement("li", null, "How many image volumes are located in the ASL series."),
                                React.createElement("li", null, "The locations of M0 scans within the series, if any. To clarify, this uses 1-based indexing (the first item's position is 1, NOT zero)"),
                                React.createElement("li", null, "The locations of dummy/unwanted scans. This too uses 1-based indexing.")),
                            React.createElement("br", null),
                            React.createElement("p", null,
                                "For more information about ASL Context,",
                                " ",
                                React.createElement(SecureLink, { href: "https://bids-specification.readthedocs.io/en/stable/99-appendices/12-arterial-spin-labeling.html" }, "please see the BIDS documentation"),
                                ".")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__additionalaslsequenceinfo", onChange: handleAccordionChange("panel__additionalaslsequenceinfo") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "Are the fields in \"Additional ASL Sequence Information\" optional?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "They may or may not be optional depending on the combination of settings and what you specified in the ASL Context section. For example, you can't indicate that an M0 scan was acquired separately while also implicitly claiming that it is located within the ASL sequence by providing M0 index positions."),
                            React.createElement("br", null),
                            React.createElement("p", null, "For the most part, these additional parameters are optional, but every additional piece of information may help ExploreASL figure out the proper handling required. For example, specifying that an ASL was acquired on a Philips scanner will allow the program to consider Philips-specific rescaling that may be present."),
                            React.createElement("br", null),
                            React.createElement("p", null,
                                "When in doubt, it is strongly recommended to check the DICOM headers using a program like",
                                " ",
                                React.createElement(SecureLink, { href: "https://nroduit.github.io/en/" }, "Weasis DICOM viewer"),
                                ". Otherwise, contact the technicians who operated the scanner for your particular images.")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__postlabelingdelayinfo", onChange: handleAccordionChange("panel__postlabelingdelayinfo") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "I have a PASL sequence. Can you clarify what Post Labeling Delay corresponds to as well as the Bolus Labeling Delay Time?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "Indeed, there may be some confusion between BIDS and the Alsop consensus paper's definitions of the term. The latter makes the following quote:"),
                            React.createElement("br", null),
                            React.createElement("blockquote", null,
                                "\"The PLD in PCASL is analogous to the quantity (TI-TI",
                                React.createElement("sub", null, "1"),
                                ")\""),
                            React.createElement("br", null),
                            React.createElement("p", null,
                                "As such one may be tempted to input the value of\u00A0(TI-TI",
                                React.createElement("sub", null, "1"),
                                ") as the Post Labeling Delay for a PASL sequence. ",
                                React.createElement("strong", null, "DO NOT"),
                                " do this. In BIDS, which this application follows, the Post Labeling Delay is just TI for PASL sequences."),
                            React.createElement("br", null),
                            React.createElement("p", null,
                                "For more information, please see the following figure or visit",
                                " ",
                                React.createElement(SecureLink, { href: "https://bids-specification.readthedocs.io/en/stable/appendices/arterial-spin-labeling.html#pasl-sequence" }, "the BIDS documentation highlighting this"),
                                ":",
                                React.createElement("br", null),
                                React.createElement("br", null),
                                React.createElement(Box, { mx: "auto", display: "block", maxWidth: 600, component: "img", src: HelperImage__ImportPostLabelingDelay })))))))));
}
export default HelpImport__StepDefineAdditionalContext;
//# sourceMappingURL=HelpImport__StepDefineAdditionalContext.js.map