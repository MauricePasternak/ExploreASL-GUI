import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import React, { useState } from "react";
import { DialogTitleH4 } from "../../components/TypographyComponents/DialogTitle";
import { SecureLink } from "../../components/NavComponents";
import { BulletPointList } from "./HelpStyledComponents";

function HelpImport__StepDefineAdditionalContext() {
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
              expanded={expanded === "panel__whatisaslcontext"}
              onChange={handleAccordionChange("panel__whatisaslcontext")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What is ASL Context?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  In short, it is context that specifies the ordering of types of image volumes are contained within the
                  ASL series acquisition. Typically an ASL series output from a scanner may contain the following
                  volumes:
                </p>
                <br />
                <BulletPointList>
                  <li>A control image</li>
                  <li>A labeled (tag) image</li>
                  <li>An M0 image</li>
                  <li>A pre-calculated perfusion-weighted image (deltam)</li>
                  <li>
                    A pre-calculated cerebral blood flow image according to calculations done within the scanner (cbf)
                  </li>
                  <li>Any of the above, but as unwanted "dummy" volumes that should be discarded.</li>
                </BulletPointList>
                <br />
                <p>Fortunately, 99% of cases fall into only 4 categories of output, which a user should specify:</p>
                <BulletPointList>
                  <li>Alternating control-label volumes with or without M0 located within</li>
                  <li>Alternative label-control volumes with or without M0 located within</li>
                  <li>Deltam volumes with accompanying M0 scans</li>
                  <li>CBF volumes</li>
                </BulletPointList>
                <br />
                <p>
                  In order for the program to comprehend the ASL context that your study follows, it must have 4 pieces
                  of information:
                </p>
                <BulletPointList>
                  <li>Which of the 4 patterns (see above) your study matches</li>
                  <li>How many image volumes are located in the ASL series.</li>
                  <li>
                    The locations of M0 scans within the series, if any. To clarify, this uses 1-based indexing (the
                    first item's position is 1, NOT zero)
                  </li>
                  <li>The locations of dummy/unwanted scans. This too uses 1-based indexing.</li>
                </BulletPointList>
                <br />
                <p>
                  For more information about ASL Context,{" "}
                  <SecureLink href="https://bids-specification.readthedocs.io/en/stable/99-appendices/12-arterial-spin-labeling.html">
                    please see the BIDS documentation
                  </SecureLink>
                  .
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__additionalaslsequenceinfo"}
              onChange={handleAccordionChange("panel__additionalaslsequenceinfo")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Are the fields in "Additional ASL Sequence Information" optional?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  They may or may not be optional depending on the combination of settings and what you specified in the
                  ASL Context section. For example, you can't indicate that an M0 scan was acquired separately while
                  also implicitly claiming that it is located within the ASL sequence by providing M0 index positions.
                </p>
                <br />
                <p>
                  For the most part, these additional parameters are optional, but every additional piece of information
                  may help ExploreASL figure out the proper handling required. For example, specifying that an ASL was
                  acquired on a Philips scanner will allow the program to consider Philips-specific rescaling that may
                  be present.
                </p>
                <br />
                <p>
                  When in doubt, it is strongly recommended to check the DICOM headers using a program like{" "}
                  <SecureLink href="https://nroduit.github.io/en/">Weasis DICOM viewer</SecureLink>. Otherwise, contact
                  the technicians who operated the scanner for your particular images.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>
        </Stack>
      </DialogContent>
    </>
  );
}

export default HelpImport__StepDefineAdditionalContext;
