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
import { DialogTitleH4 } from "../../components/DialogTitle";

function HelpDataViz__StepClarifyDataTypes() {
  const [expanded, setExpanded] = useState<string | false>(false);

  const handleAccordionChange = (panel: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  return (
    <>
      <DialogTitleH4>Help Load Dataframe</DialogTitleH4>
      <DialogContent>
        <Stack spacing={1}>
          <DialogContentText>Select a question that best describes your concern.</DialogContentText>

          <section>
            <Accordion
              expanded={expanded === "panel__whatdoIdointhissection"}
              onChange={handleAccordionChange("panel__whatdoIdointhissection")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What do I do in this section?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  In general, this section is just to help the program verify whether a given column has been
                  interpreted correctly. Most of the time, the correct inference should have been made.
                </p>
                <br />
                <p>
                  However, there is one common scenario that this program cannot detect: the case where categorical
                  variables are encoded by numbers (i.e. Female is 0 and Male is 1 for a categorical variable Sex). In
                  such an event, the user should clarify the data type context.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whycantIchangethedatatype"}
              onChange={handleAccordionChange("panel__whycantIchangethedatatype")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Why can't I change the data type of some columns?!</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  The most common reason is that you&#39;re trying to convert a categorical variable into a continuous
                  one when said categorical variable contains alphabetic characters. It doesn&#39;t make sense to try
                  such a conversion.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>
        </Stack>
      </DialogContent>
    </>
  );
}

export default React.memo(HelpDataViz__StepClarifyDataTypes);
