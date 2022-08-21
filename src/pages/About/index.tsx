import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";
// LOCAL
import ExploreASLWorkflowImage from "../../assets/img/EASLWorkflow.png";
import ExploreASLBannerImage from "../../assets/img/ExploreASLBanner.png";
import { BulletPointList } from "../Help/HelpStyledComponents";

function AboutPage() {
  return (
    <Box padding={2}>
      <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
        <img src={ExploreASLBannerImage} style={{ maxWidth: "800px" }} />
        <Paper component="section">
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h4" component="h1">
                Description
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Divider style={{ width: "100%", marginBottom: "1rem" }} />
              <p>
                ExploreASL is a &quot;from scanner to data analysis &amp; publication&quot; pipeline for the processing
                and statistical analysis of arterial spin labeling (ASL) perfusion MR images. It has been designed to be
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

        <Paper component="section">
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
                <strong>sourcedata</strong> folder that itself is a child of the root study folder. They will then
                specify the structure of the dataset - which folder levels house subject names versus visit designations
                versus scan type, etc. This will permit the program to convert all DICOM files into NIFTI format
                (necessary for image processing) and organize this NIFTI output into BIDS standard output folders:{" "}
                <strong>rawdata</strong> and <strong>derivatives</strong>.
              </p>
              <br />
              <Typography variant="h5" component="h2">
                2) Defining Data Parameters
              </Typography>
              <p>
                To accomodate the plethora of ASL variants and setups that are possible, an entire module is dedicated
                to specifying the parameters required to process imaging data. These include, but are not limited to:
              </p>
              <br />
              <ul style={{ listStylePosition: "inside", textIndent: 2, marginLeft: "1rem" }}>
                <li>
                  Study-related Parameters: which subjects to process/exclude, which MATLAB/ExploreASL configuration to
                  use, etc.
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
                3) Multiprocessing of Studies
              </Typography>
              <p>
                ExploreASL supports workstation multiprocessing from the get-go without any configuration. Allocate
                multiple cores towards multiple studies which can all be run in parallel to make the most of your
                workstation&apos;s capabilities and cut down processing time from weeks to days or hours. Studies have
                independent output and progressbar feedback in addition to supporting independent pause/resume/terminate
                capability without affecting the analysis of other studies.
              </p>
              <br />
              <Typography variant="h5" component="h2">
                4) Data Visualization
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
                  For immense datasets, subsetting functionality is available. Users can trim down data to only present
                  the exact data that is desired through multiple subsetters. Subsetter functions include:
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

        <Paper component="section" sx={{ width: "100%" }}>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h4" component="h1">
                Workflow
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Divider style={{ width: "100%", marginBottom: "1rem" }} />
              <img src={ExploreASLWorkflowImage} style={{ maxWidth: "800px" }} />
            </AccordionDetails>
          </Accordion>
        </Paper>

        <Paper component="section" sx={{ width: "100%" }}>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h4" component="h1">
                ExploreASL Team
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Divider style={{ width: "100%", marginBottom: "1rem" }} />
              <p>
                This graphical user interface was developed by{" "}
                <Link href="https://github.com/MauricePasternak" target="_blank">
                  Maurice Pasternak
                </Link>
                . For questions regarding this program interface, please contact him at{" "}
                <Link data-fr-linked="true" href="mailto:maurice.pasternak@utoronto.ca" target="_blank">
                  maurice.pasternak@utoronto.ca
                </Link>
                . For all other inquiries, please see the team makeup and contacts below.
              </p>
              <br />
              <Typography variant="h4" component="h2">
                ExploreASL Members
              </Typography>
              <br />
              <ul style={{ listStylePosition: "inside", textIndent: 2, marginLeft: "1rem" }}>
                <li>
                  <Link href="mailto:h.j.mutsaerts@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                    Henk Mutsaerts
                  </Link>{" "}
                  - Co-creator,{" "}
                  <Link href="https://www.researchgate.net/profile/Henri-Mutsaerts" rel="nofollow" target="_blank">
                    Researcher
                  </Link>
                </li>
                <li>
                  <Link href="mailto:j.petr@hzdr.de?subject=%5BGitHub%5D%20ExploreASL">Jan Petr</Link> - Co-creator,{" "}
                  <Link href="https://www.researchgate.net/profile/Jan-Petr-2" rel="nofollow" target="_blank">
                    Researcher
                  </Link>
                </li>
                <li>
                  <Link href="mailto:m.stritt@mediri.com?subject=%5BGitHub%5D%20ExploreASL">Michael Stritt</Link> -
                  Software developer, Research Associate,{" "}
                  <Link href="http://aspire-mri.eu/" rel="nofollow" target="_blank">
                    ASPIRE
                  </Link>
                </li>
                <li>
                  <Link href="mailto:p.f.c.groot@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL">Paul Groot</Link> -
                  Software developer, IT specialist,{" "}
                  <Link href="https://www.researchgate.net/profile/Paul-Groot" rel="nofollow" target="_blank">
                    Researcher
                  </Link>
                </li>
                <li>
                  <Link href="mailto:pieter.vandemaele@gmail.com?subject=%5BGitHub%5D%20ExploreASL">
                    Pieter Vandemaele
                  </Link>{" "}
                  - Developer Matlab{" "}
                  <Link href="https://github.com/bids-standard" target="_blank">
                    BIDS app
                  </Link>
                </li>
                <li>
                  <Link href="mailto:l.lorenzini@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                    Luigi Lorenzini
                  </Link>{" "}
                  - Developer{" "}
                  <Link href="https://www.hzdr.de/publications/Publ-31929" rel="nofollow" target="_blank">
                    ExploreQC
                  </Link>
                </li>
                <li>
                  <Link href="mailto:maurice.pasternak@mail.utoronto.ca?subject=%5BGitHub%5D%20ExploreASL">
                    Maurice Pasternak
                  </Link>{" "}
                  - Developer ExploreASL User Interface
                </li>
                <li>
                  <Link href="mailto:m.b.dijsselhof@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                    Mathijs Dijsselhof
                  </Link>{" "}
                  - PhD student,{" "}
                  <Link href="https://sites.google.com/view/exploreasl/projects" rel="nofollow" target="_blank">
                    Cerebrovascular Age
                  </Link>
                </li>
                <li>
                  <Link
                    href="mailto:b.estevespadrela@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL"
                    target="_blank"
                  >
                    Beatriz Padrela
                  </Link>{" "}
                  - PhD student,{" "}
                  <Link href="https://sites.google.com/view/exploreasl/projects" rel="nofollow" target="_blank">
                    BBB-ASL
                  </Link>
                </li>
                <li>
                  <Link href="mailto:Sandeep.g.bio@gmail.com?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                    Sandeep Ganji
                  </Link>{" "}
                  - Developer integration Philips ISD,{" "}
                  <Link href="https://www.researchgate.net/profile/Sandeep-Ganji-3" rel="nofollow" target="_blank">
                    Researcher
                  </Link>
                </li>
                <li>
                  <Link href="mailto:Patricia.Clement@ugent.be?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                    Patricia Clement
                  </Link>{" "}
                  - Developer ASL-BIDS &amp; organizer,{" "}
                  <Link href="https://www.researchgate.net/profile/Patricia-Clement" rel="nofollow" target="_blank">
                    Researcher
                  </Link>
                </li>
              </ul>
            </AccordionDetails>
          </Accordion>
        </Paper>

        <Paper component="section" sx={{ width: "100%" }}>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h4" component="h1">
                Acknowledgements
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Divider style={{ width: "100%", marginBottom: "1rem" }} />
              <p>
                A deep thanks to Dr. Vera C. Keil (Department of Radiology Amsterdam UMC, VUmc) for her contributions
                and advocacy of the &quot;A Beginner&rsquo;s Guide to Arterial Spin Labeling (ASL) Image
                Processing&quot; paper which will feature this program as a core tool.
              </p>
            </AccordionDetails>
          </Accordion>
        </Paper>
      </Box>
    </Box>
  );
}

export default React.memo(AboutPage);
