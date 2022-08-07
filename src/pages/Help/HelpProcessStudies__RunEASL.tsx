import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import Stack from "@mui/material/Stack";
import React, { useState } from "react";
import { DialogTitleH4 } from "../../components/DialogTitle";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import AccordionDetails from "@mui/material/AccordionDetails";
import { BulletPointList } from "./HelpStyledComponents";
import Box from "@mui/material/Box";
import HelperImage__ProcessStudiesLogsLocation from "../../assets/img/HelperImages/HelperImage__ProcessStudiesLogsLocation.png";

function HelpProcessStudies__RunEASL() {
  const { api } = window;
  const [expanded, setExpanded] = useState<string | false>(false);

  const handleAccordionChange = (panel: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  return (
    <>
      <DialogTitleH4>Help Page Run ExploreASL</DialogTitleH4>
      <DialogContent>
        <Stack spacing={1}>
          <DialogContentText>Select a question that best describes your concern.</DialogContentText>

          <section>
            <Accordion
              expanded={expanded === "panel__numberofcores"}
              onChange={handleAccordionChange("panel__numberofcores")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What does changing the "Number of Cores" do within a study?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  This program supports multiprocessing in order to make the most out of your workstation. By allocating
                  more cores towards a study, that study&apos;s subjects are distributed to different processing cores,
                  allowing for analysis of each to occur in parallel. In theory, this provides a speedup equal to the
                  number of cores you give.&nbsp;
                </p>
                <br />
                <p>
                  Be warned, however, that analysing multiple subjects in parallel is a very demanding task for your
                  computer. It is strongly recommended that all other background tasks (i.e. Chrome, Office, etc.) are
                  turned off if you plan to use all (or nearly all) available cores.
                </p>
                <br />
                <p>
                  Furthermore, as a rough estimate,{" "}
                  <strong>
                    treat each additional core as an extra load on your systems memory by a generous 3.5GB
                  </strong>
                  . This means that:
                </p>
                <BulletPointList>
                  <br />
                  <li>for a 4GB workstation, you should just use 1 core for only 1 study</li>
                  <li>for an 8GB workstation, you should not allocate more than 2 cores at any given time.</li>
                  <li>for a 16GB workstation, you should not allocate more than 4 cores at any given time.</li>
                  <li>for a 32GB workstation, you should not allocate more than 9 cores at any given time.</li>
                  <li>for a 64GB workstation, you should not allocate more than 18 cores at any given time.</li>
                  <li>Etc.</li>
                </BulletPointList>
                <br />
                <p>
                  Exceeding this value results in overwhelming your system&apos;s memory capacity, completely negating
                  the speed boost this otherwise provides, in addition to increasing the risk of crashes and data
                  corruption.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__safetostopmidway"}
              onChange={handleAccordionChange("panel__safetostopmidway")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Is it safe to stop a study mid-way?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  Due to the nature of inter-program communication, it is possible that data may be corrupted if the
                  stop button is pressed at just the right millisecond while a file transfer is going on. As such,
                  terminating a study manually is meant to be used in the case{" "}
                  <strong>
                    when ExploreASL has clearly been frozen for an extended period of time and no data transfer is
                    happening
                  </strong>{" "}
                  anyway. In which case, there is no reason to believe that data will become corrupted.
                </p>
                <br />
                <p>
                  If you do terminate a study forcefully, it is recommended that you re-run said study starting from the
                  Structural Module. If you are uncertain, you can even go back further and just restart from the Import
                  Module (as DICOM files are not touched and should not be corrupted here).
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel_whyonlyonecoreforpopulationmodule"}
              onChange={handleAccordionChange("panel_whyonlyonecoreforpopulationmodule")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>
                  Why can't I select more than one core for a given study when the Population Module is indicated?
                </Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  This is due to the nature of the operations taking place within the Population Module. MATLAB (without
                  pricey extensions) does not support a sharing computer memory pool between cores. Therefore, only one
                  core can act upon a Population Module as it is certain to have access to all the memory it will need.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel_runningdifferentanalysesonsamestudy"}
              onChange={handleAccordionChange("panel_runningdifferentanalysesonsamestudy")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Can I run two or more different analyses on the same dataset in parallel?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>Unfortunately, this is the limitation of this program. You can run an analysis for:</p>
                <BulletPointList>
                  <li>One study on one core.</li>
                  <li>Multiple different studies with one core per study.</li>
                  <li>Multiple different studies with multiple cores per study.</li>
                </BulletPointList>
                <br />
                <p>But you cannot run the same study in parallel with different settings.</p>
                <br />
                <p>
                  What you can do, however, is make a copy of the study, name it something different, and then run that
                  copy in parallel with the original. That essentially accomplishes the same desired goal, with the main
                  caveat being that additional disk space is being taken up by copies you make.
                </p>
                <br />
                <p>
                  You should also keep in mind that you'll have to re-run the Define Parameters part of the program for
                  the copy you make, as it will have a different Study Root Path than the original, and the dataPar.json
                  needs to be updated about that change.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__howcanIrerunastudy"}
              onChange={handleAccordionChange("panel__howcanIrerunastudy")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>How can I re-run a study with different parameters?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>In general, the following steps would have to be taken:</p>
                <ol style={{ textIndent: "1rem", listStylePosition: "inside" }}>
                  <li>Go to the &quot;Define Parameters&quot; section of this program.</li>
                  <li>
                    Load in the existing parameters, alter as needed, and save back to overwrite the existing
                    dataPar.json file.
                  </li>
                  <li>
                    Go to the &quot;Prepare a re-run&quot; tab in this module and indicate which sections/subjects/etc.
                    should be re-run.
                  </li>
                  <li>Re-run the study.</li>
                </ol>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whatisstudyrootfolder"}
              onChange={handleAccordionChange("panel__whatisstudyrootfolder")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>
                  It says the study did not finish all anticipated steps? Where can I see what's wrong?
                </Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>All ExploreASL operations have log files generated under</p>
                <br />
                <strong>
                  {api.platform === "win32"
                    ? "STUDYROOTderivativesExploreASLlog"
                    : "STUDYROOT/derivatives/ExploreASL/log"}
                </strong>
                <br />
                <br />
                <Box
                  mx="auto"
                  display="block"
                  maxWidth={500}
                  component="img"
                  src={HelperImage__ProcessStudiesLogsLocation}
                />
                <br />
                <br />
                <p>
                  You can visit the recent log file that was generated to determine the nature of the error. If hoping
                  to communicate with the ExploreASL team about the error,{" "}
                  <strong>
                    including said log file as well as the dataPar.json file used when the study was processed
                  </strong>{" "}
                  would be most helpful in figuring out the nature of what went wrong.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>
        </Stack>
      </DialogContent>
    </>
  );
}

export default HelpProcessStudies__RunEASL;
