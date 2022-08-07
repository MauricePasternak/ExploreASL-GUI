import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import DialogContent from "@mui/material/DialogContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import React, { useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { DialogTitleH4 } from "../../components/DialogTitle";
import DialogContentText from "@mui/material/DialogContentText";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import HelperImage__ImportScanAliasOutput from "../../assets/img/HelperImages/HelperImage__ImportScanAliasOutput.png";
import HelperImage__ImportVisitAliasRawdataOutput from "../../assets/img/HelperImages/HelperImage__ImportVisitAliasRawdataOutput.png";
import HelperImage__ImportVisitAliasDerivativesOutput from "../../assets/img/HelperImages/HelperImage__ImportVisitAliasDerivativesOutput.png";
import { BulletPointList } from "./HelpStyledComponents";

function HelpImport__StepDefineAliases() {
  const [expanded, setExpanded] = useState<string | false>(false);

  const handleAccordionChange = (panel: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };
  return (
    <>
      <DialogTitleH4>Help Page Defining Aliases</DialogTitleH4>
      <DialogContent>
        <Stack spacing={1}>
          <DialogContentText>Select a question that best describes your concern.</DialogContentText>

          <section>
            <Accordion
              expanded={expanded === "panel__whathappensinscanaliases"}
              onChange={handleAccordionChange("panel__whathappensinscanaliases")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What do I specify in Scan Aliases?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  In this section, you assist the program in understanding what folder names correspond to which type of
                  MRI image that they uniquely contain (i.e. you can't have a folder called "structural" that contains
                  BOTH T1w and T2w DICOM files, each image type must be allocated to its own folder).
                </p>
                <br />
                <p>
                  When you earlier specified the folder depth at which folders containing scan information are found,
                  the left portion of this widget was populated with the file names of those folders.
                </p>
                <br />
                <p>
                  From here, the user specifies, via dropdown, which folders are which type of accepted scan. The
                  accepted scan types are:
                </p>
                <BulletPointList>
                  <li>ASL Functional Scans</li>
                  <li>Proton-density (M0) Scans</li>
                  <li>T1-weighted Structural Scans</li>
                  <li>T2-weighted Structural Scans</li>
                  <li>FLAIR Structural Scans</li>
                  <li>and the option to ignore a particular folder</li>
                </BulletPointList>
                <br />
                <p>
                  At least one folder name must be specified. By default, all others will be ignored. Here is an example
                  of the import taking place and how these scans are organized in the output:
                </p>
                <br />
                <Box
                  mx="auto"
                  display="block"
                  maxWidth={600}
                  component="img"
                  src={HelperImage__ImportScanAliasOutput}
                />
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whathappensinvisitaliases"}
              onChange={handleAccordionChange("panel__whathappensinvisitaliases")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What do I specify in Visit Aliases?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  In this section, you tell the program what you'd like the output folder name for various visits to be.
                  Sometimes scanners can output nonsensical visit names, and this is an oppurtunity for you to change
                  them into something more human-understandable in the rawdata and derivatives output. By default, no
                  alias change happens - the aliases are the same as the original names, resulting in the same names
                  carrying over into the output.
                </p>
                <br />
                <p>Note that all aliases you specify must be unique.</p>
                <br />
                <p>Here is an example of how visit aliases carry over to the rawdata section:</p>
                <br />
                <Box
                  mx="auto"
                  display="block"
                  maxWidth={600}
                  component="img"
                  src={HelperImage__ImportVisitAliasRawdataOutput}
                />
                <br />
                <p>
                  Here is an example of how visit aliases <strong>DO NOT</strong> carry over to the ExploreASL
                  derivative. Instead, each visit is demarcated by a suffix ending in an underscore and a number.
                </p>
                <br />
                <Box
                  mx="auto"
                  display="block"
                  maxWidth={600}
                  component="img"
                  src={HelperImage__ImportVisitAliasDerivativesOutput}
                />
              </AccordionDetails>
            </Accordion>
          </section>

        </Stack>
      </DialogContent>
    </>
  );
}

export default React.memo(HelpImport__StepDefineAliases);
