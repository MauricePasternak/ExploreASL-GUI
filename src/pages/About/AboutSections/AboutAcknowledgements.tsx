import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";

export function AboutAcknowledgements() {
  return (
    <Paper component="section" sx={{ width: "100%", maxWidth: 2160 }}>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h4" component="h1">
            Acknowledgements
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Divider style={{ width: "100%", marginBottom: "1rem" }} />
          <p>
            A deep thanks to Dr. Vera C. Keil (Department of Radiology Amsterdam UMC, VUmc) for her contributions and
            advocacy of the &quot;A Beginner&rsquo;s Guide to Arterial Spin Labeling (ASL) Image Processing&quot; paper
            which will feature this program as a core tool.
          </p>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}
