import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";

function AboutDescription() {
  return (
    <Paper component="section" sx={{ maxWidth: 2160 }}>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h4" component="h1">
            Description
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Divider style={{ width: "100%", marginBottom: "1rem" }} />
          <p>
            ExploreASL is a &quot;from scanner to data analysis &amp; publication&quot; pipeline for the processing and
            statistical analysis of arterial spin labeling (ASL) perfusion MR images. It has been designed to be
            compatible across all 3 major operating systems (Windows, MacOS, and Linux), open source, and a
            collaborative framework to facilitate input from image analytics and clinical investigators worldwide.
          </p>
          <br />
          <p>
            ExploreASL is opinionated and enforces a{" "}
            <Link href="https://bids.neuroimaging.io/" target="_blank">
              Brain Imaging Data Structure (BIDS)
            </Link>{" "}
            standard to support consistency between datasets across investigators.
          </p>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}

export default AboutDescription;
