import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";
import ExploreASLWorkflowImage from "../../assets/img/EASLWorkflow.png";

function AboutWorkflow() {
  return (
    <Paper component="section" sx={{ width: "100%", maxWidth: 2160 }}>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h4" component="h1">
            Workflow
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ display: "flex", flexDirection: "column" }}>
          <Divider style={{ width: "100%", marginBottom: "1rem" }} />
          <img src={ExploreASLWorkflowImage} style={{ alignSelf: "center", width: "min(75%, 1200px)" }} />
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}

export default AboutWorkflow;
