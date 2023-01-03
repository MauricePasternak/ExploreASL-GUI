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
import { NumberedPointList } from "./HelpStyledComponents";
function HelpBIDSDatagrid__BIDSDatagrid() {
    const [expanded, setExpanded] = useState(false);
    const handleAccordionChange = (panel) => (event, isExpanded) => {
        setExpanded(isExpanded ? panel : false);
    };
    return (React.createElement(React.Fragment, null,
        React.createElement(DialogTitleH4, null, "Help Page Edit BIDS Fields"),
        React.createElement(DialogContent, null,
            React.createElement(Stack, { spacing: 1 },
                React.createElement(DialogContentText, null, "Select a question that best describes your concern."),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__whymissingfields", onChange: handleAccordionChange("panel__whymissingfields") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "Why are there missing BIDS fields in the loaded spreadsheet? Are they going to disappear when I save the spreadsheet?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "With some exceptions, only fields that have to do with ASL processing are actively displayed or add-able. This was done in order to accomodate enourmous datasets that feature thousands of scans."),
                            React.createElement("br", null),
                            React.createElement("p", null, "However, these \"missing\" columns are not deleted from the BIDS sidecars during export, as it is assumed that they have good reason being there in the first place. Instead, supported (i.e. visible columns) fields from the speadsheet overwrite existing values. New fields are simply added as well.")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel__doyouhavevalidation", onChange: handleAccordionChange("panel__doyouhavevalidation") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "Are BIDS fields validated?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "Validation is currently not supported (likely will be in a future update). However, most of the widgets within individual spreadsheet cells implicitly prevent you from inputting invalid values.")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel_howdoIaddafield", onChange: handleAccordionChange("panel_howdoIaddafield") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "There is a field(s) missing from the BIDS sidecars that was never added during import. How do I add it/them?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "In the bottom of the program, you'll see a button with the text \"ADD A NEW BIDS COLUMN\". Click it."),
                            React.createElement("p", null, "You'll be brought to a dialog window that is comprised of 3 steps:"),
                            React.createElement(NumberedPointList, null,
                                React.createElement("li", null, "Select the BIDS field that you'd like to add."),
                                React.createElement("li", null, "Select the default value that should be applied to all rows. Alternatively, if the column should be mostly empty, check the box that says \"Start with empty cells instead of applying the default value\"."),
                                React.createElement("li", null, "Click the \"ADD TO SPREADSHEET\" action label in the bottom right corner of the dialog window.")),
                            React.createElement("p", null, "Your new column is automatically added as the rightmost column. You may need to move the scrollbar to see it.")))),
                React.createElement("section", null,
                    React.createElement(Accordion, { expanded: expanded === "panel_whatisexploreaslpath", onChange: handleAccordionChange("panel_whatisexploreaslpath") },
                        React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                            React.createElement(Typography, null, "I have a mixed dataset that needs to have certain fields present in some scans and omitted in others. When I add a column, I notice that it applies a default value to all the cells, causing all the BIDS sidecars to end up with the value if I save the spreadsheet. What do I do?")),
                        React.createElement(Divider, null),
                        React.createElement(AccordionDetails, null,
                            React.createElement("p", null, "After having added your column, click on a cell corresponding to the column of interest and the row of the scan where you want it omitted from (you can see which scan this applies to in the Basename column). When you see the cell selected, press the Delete button on your keyboard. The cell should now be empty. This cell's value is now nothing/empty, so it will be omitted from being written into the file corresponding to the row."),
                            React.createElement("br", null),
                            React.createElement("p", null, "Repeat this for all the cells/fields that need to be omitted from their respective files."))))))));
}
export default React.memo(HelpBIDSDatagrid__BIDSDatagrid);
//# sourceMappingURL=HelpBIDSDatagrid__BIDSDatagrid.js.map