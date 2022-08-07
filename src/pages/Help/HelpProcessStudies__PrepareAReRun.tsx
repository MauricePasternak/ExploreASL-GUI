import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import Stack from "@mui/material/Stack";
import React, { useState } from "react";
import { DialogTitleH4 } from "../../components/DialogTitle";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import AccordionDetails from "@mui/material/AccordionDetails";
import { BulletPointList } from "./HelpStyledComponents";
import HelperImage__ProcessStudiesStudyRootExample from "../../assets/img/HelperImages/HelperImage__ProcessStudiesStudyRootExample.png";
import Box from "@mui/material/Box";
function HelpProcessStudies__PrepareAReRun() {
  const [expanded, setExpanded] = useState<string | false>(false);

  const handleAccordionChange = (panel: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  return (
    <>
      <DialogTitleH4>Help Page Prepare A Re-Run</DialogTitleH4>
      <DialogContent>
        <Stack spacing={1}>
          <DialogContentText>Select a question that best describes your concern.</DialogContentText>

          <section>
            <Accordion
              expanded={expanded === "panel__whatisstudyrootfolder"}
              onChange={handleAccordionChange("panel__whatisstudyrootfolder")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What is the Study Root Folder?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  This is the root folder of your overall study that should adhere to Brain Imaging Data Structure
                  (BIDS) standard in order to be useable by ExploreASL.
                </p>
                <br />
                <p>
                  After running the Import module, your study's root folder should contain 3 subfolders that follow BIDS
                  format:
                </p>
                <BulletPointList>
                  <li>sourcedata, containing the initial scanner data</li>
                  <li>rawdata, converted scans into NIFTI format</li>
                  <li>derivatives, analyses of NIFTI data</li>
                </BulletPointList>
                <br />
                <p>This root folder is the filepath that should be provided to this field.</p>
                <br />
                <Box
                  mx="auto"
                  display="block"
                  maxWidth={700}
                  component="img"
                  src={HelperImage__ProcessStudiesStudyRootExample}
                />
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__howdoesthisprepareforarerun"}
              onChange={handleAccordionChange("panel__howdoesthisprepareforarerun")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>So what does checking the boxes do? How does this prepare for a re-run?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  ExploreASL keeps track of completed steps using its own ".status" files. This is done so that if the
                  program somehow crashes halfway through, the steps that were already successfully completed do not
                  have to be re-run again.
                </p>
                <br />
                <p>
                  Therefore, this part of the program allows you to select which particular sections need to be re-run.
                  You can select either everything, a module, a particular subject in a module, or even just a
                  particular step. Once selected, just press the button and the particular files will be deleted,
                  allowing ExploreASL to re-do those steps when you run it the next time.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__cantIusemyownsystemsfileexplorer"}
              onChange={handleAccordionChange("panel__cantIusemyownsystemsfileexplorer")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Can't I use my own computer's file explorer to get the same outcome?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  You can certainly do this manually with your own system's file explorer. You do not have to use this
                  part of the program. It's mostly here for your own convenience and safety. For example, this program
                  will prevent you from re-running a study that is actively running in order to avoid the chance of data
                  corruption. The same safety is not provided if you use your system's file explorer.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>
        </Stack>
      </DialogContent>
    </>
  );
}

export default HelpProcessStudies__PrepareAReRun;
