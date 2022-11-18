import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";
import { SecureLink } from "../../../components/NavComponents";

export function AboutDescription() {
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
            <SecureLink href="https://bids.neuroimaging.io/">Brain Imaging Data Structure (BIDS)</SecureLink> standard
            to support consistency between datasets across investigators.
          </p>
          <br />
          Please remember to reference{" "}
          <SecureLink href="https://www.sciencedirect.com/science/article/pii/S1053811920305176">
            the following paper
          </SecureLink>{" "}
          in the event that this software is used in a publication:
          <br />
          <Typography
            variant="caption"
            sx={{
              fontSize: "1.1rem",
              bgcolor: (theme) => (theme.palette.mode === "light" ? theme.palette.grey[100] : theme.palette.grey[800]),
            }}
          >
            Mutsaerts HJMM, Petr J, Groot P, et al. ExploreASL: an image processing pipeline for multi-center ASL
            perfusion MRI studies. Neuroimage. 2020;219:117031. doi:10.1016/j.neuroimage.2020.117031
          </Typography>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}
