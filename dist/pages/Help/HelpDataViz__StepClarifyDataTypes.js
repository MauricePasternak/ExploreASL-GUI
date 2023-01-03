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
function HelpDataViz__StepClarifyDataTypes() {
    const [expanded, setExpanded] = useState(false);
    const handleAccordionChange = (panel) => (event, isExpanded) => {
        setExpanded(isExpanded ? panel : false);
    };
    return (React.createElement(React.Fragment, null,
        React.createElement(DialogTitleH4, null, "Help Load Dataframe"),
        React.createElement(DialogContent, null,
            React.createElement(Stack, { spacing: 1 },
                React.createElement(DialogContentText, null, "Select a question that best describes your concern."),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__whatdoIdointhissection", onChange: handleAccordionChange("panel__whatdoIdointhissection") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "What do I do in this section?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "In general, this section is just to help the program verify whether a given column has been interpreted correctly. Most of the time, the correct inference should have been made."),
                            React.createElement("br", null),
                            React.createElement("p", null, "However, there is one common scenario that this program cannot detect: the case where categorical variables are encoded by numbers (i.e. Female is 0 and Male is 1 for a categorical variable Sex). In such an event, the user should clarify the data type context.")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__whycantIchangethedatatype", onChange: handleAccordionChange("panel__whycantIchangethedatatype") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "Why can't I change the data type of some columns?!")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "The most common reason is that you're trying to convert a categorical variable into a continuous one when said categorical variable contains alphabetic characters. It doesn't make sense to try such a conversion."))))))));
}
export default React.memo(HelpDataViz__StepClarifyDataTypes);
//# sourceMappingURL=HelpDataViz__StepClarifyDataTypes.js.map