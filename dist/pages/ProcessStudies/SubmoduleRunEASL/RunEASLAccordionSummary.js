import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import React from "react";
function RunEASLAccordionSummary({ studyIndex, currentStatus, }) {
    return (React.createElement(AccordionSummary, { sx: {
            bgcolor: (theme) => currentStatus === "Standby"
                ? theme.palette.primary.main
                : currentStatus === "Running"
                    ? theme.palette.success.main
                    : theme.palette.grey[400],
            color: (theme) => theme.palette.primary.contrastText,
        }, expandIcon: React.createElement(ExpandMoreIcon, { sx: {
                color: (theme) => theme.palette.primary.contrastText,
                fontSize: (theme) => theme.typography.h4.fontSize,
            } }) },
        React.createElement(Box, { mr: 3 },
            React.createElement(Typography, { variant: "h5" }, `Study ${studyIndex + 1}`),
            React.createElement(Typography, { variant: "caption" }, `Current Status: ${currentStatus}`)),
        currentStatus === "Running" && React.createElement(CircularProgress, { variant: "indeterminate", color: "inherit" })));
}
export default React.memo(RunEASLAccordionSummary);
//# sourceMappingURL=RunEASLAccordionSummary.js.map