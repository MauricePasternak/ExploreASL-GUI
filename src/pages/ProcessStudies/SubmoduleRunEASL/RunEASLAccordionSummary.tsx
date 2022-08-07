import AccordionSummary from "@mui/material/AccordionSummary";
import React from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { RunEASLStatusType } from "../../../common/types/ExploreASLTypes";

function RunEASLAccordionSummary({
  studyIndex,
  currentStatus,
}: {
  studyIndex: number;
  currentStatus: RunEASLStatusType;
}) {
  return (
    <AccordionSummary
      sx={{
        bgcolor: theme =>
          currentStatus === "Standby"
            ? theme.palette.primary.main
            : currentStatus === "Running"
            ? theme.palette.success.main
            : theme.palette.grey[400],
        color: theme => theme.palette.primary.contrastText,
      }}
      expandIcon={
        <ExpandMoreIcon
          sx={{
            color: theme => theme.palette.primary.contrastText,
            fontSize: theme => theme.typography.h4.fontSize,
          }}
        />
      }
    >
      <Box mr={3}>
        <Typography variant="h5">{`Study ${studyIndex + 1}`}</Typography>
        <Typography variant="caption">{`Current Status: ${currentStatus}`}</Typography>
      </Box>
      {currentStatus === "Running" && <CircularProgress variant="indeterminate" color="inherit" />}
    </AccordionSummary>
  );
}

export default React.memo(RunEASLAccordionSummary);
