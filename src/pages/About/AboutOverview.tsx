import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";
import { BulletPointList } from "../Help/HelpStyledComponents";

function AboutOverview() {
  return (
    <Paper component="section" sx={{ maxWidth: 2160 }}>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h4" component="h1">
            Overview
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Divider style={{ width: "100%", marginBottom: "1rem" }} />
          <p>The overall pipeline is as follows:</p>
          <br />
          <Typography variant="h5" component="h2">
            1) Import Module
          </Typography>
          <p>
            As per BIDS standard, users will start off with their scanner data organized under a{" "}
            <strong>sourcedata</strong> folder that itself is a child of the root study folder. They will then specify
            the structure of the dataset - which folder levels house subject names versus visit designations versus scan
            type, etc. This will permit the program to convert all DICOM files into NIFTI format (necessary for image
            processing) and organize this NIFTI output into BIDS standard output folders: <strong>rawdata</strong> and{" "}
            <strong>derivatives</strong>.
          </p>
          <br />
          <Typography variant="h5" component="h2">
            2) Defining Data Parameters
          </Typography>
          <p>
            To accomodate the plethora of ASL variants and setups that are possible, an entire module is dedicated to
            specifying the parameters required to process imaging data. These include, but are not limited to:
          </p>
          <br />
          <ul style={{ listStylePosition: "inside", textIndent: 2, marginLeft: "1rem" }}>
            <li>
              Study-related Parameters: which subjects to process/exclude, which MATLAB/ExploreASL configuration to use,
              etc.
            </li>
            <li>Acquisition Parameters: vendor, sequence type, labeling duration, etc.</li>
            <li>Quantification Parameters: T1 and T2* values, single vs dual compartment modelling, etc.</li>
            <li>
              Processing Parameters: registration configurations, partial volume correction, DARTEL, longitudinal
              registration, etc.
            </li>
            <li>Etc. etc. Over 50 other parameters to cater to your dataset&apos;s requirements.</li>
          </ul>
          <br />
          <Typography variant="h5" component="h2">
            3) Editing BIDS Fields at the scan level
          </Typography>
          <p>
            For complex datasets, this program offers the oppurtunity to alter specific BIDS fields for every ASL scan
            within an imported dataset.
          </p>
          <br />
          <p>
            Users can interact with a loaded spreadsheet of every ASL BIDS sidecar, edit/remove values, add/remove
            columns, etc., and save the adjusted values back into every sidecar file. This saves users the hassle and
            error-prone nature of manually editing every BIDS sidecar individually.
          </p>
          <br />
          <Typography variant="h5" component="h2">
            4) Multiprocessing of Studies
          </Typography>
          <p>
            ExploreASL supports workstation multiprocessing from the get-go without any configuration. Allocate multiple
            cores towards multiple studies which can all be run in parallel to make the most of your workstation&apos;s
            capabilities and cut down processing time from weeks to days or hours. Studies have independent output and
            progressbar feedback in addition to supporting independent pause/resume/terminate capability without
            affecting the analysis of other studies.
          </p>
          <br />
          <Typography variant="h5" component="h2">
            5) Data Visualization
          </Typography>
          <p>
            Users are able to load in an ExploreASL-processed study, along with optional metadata from a spreadsheet
            file, and plot data according to two major visualization schemes:
          </p>
          <br />
          <BulletPointList>
            <li>Scatterplots for Continuous x Continuous data</li>
            <li>Swarmplots for Categorical x Continuous data</li>
          </BulletPointList>
          <br />
          <p>Furthermore, these graphs are interactive in multiple ways:</p>
          <br />
          <BulletPointList>
            <li>Most plot settings are adjustable (i.e. marker size, margins, axis label font sizes, etc.)</li>
            <li>
              For immense datasets, subsetting functionality is available. Users can trim down data to only present the
              exact data that is desired through multiple subsetters. Subsetter functions include:
              <BulletPointList>
                <li>
                  Single-Equivalency Operators: Equals ({"="}) and Not-Equals {"≠"}
                </li>
                <li>Multi-Equivalency Operators: "includes" and "excludes"</li>
                <li>
                  Relational Operators: {">"} , {"≥"} , {"<"} , and {"≤"}
                </li>
              </BulletPointList>
            </li>
            <li>
              Clicking on any datapoint will load in the processed CBF output for that particular subject as 3
              interactable MRI image + sliders (one set per orientation)
            </li>
          </BulletPointList>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}

export default AboutOverview;
