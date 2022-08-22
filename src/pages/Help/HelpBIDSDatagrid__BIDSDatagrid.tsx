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

function HelpBIDSDatagrid__BIDSDatagrid() {
  const [expanded, setExpanded] = useState<string | false>(false);

  const handleAccordionChange = (panel: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  return (
    <>
      <DialogTitleH4>Help Page Edit BIDS Fields</DialogTitleH4>
      <DialogContent>
        <Stack spacing={1}>
          <DialogContentText>Select a question that best describes your concern.</DialogContentText>

          <section>
            <Accordion
              expanded={expanded === "panel__whymissingfields"}
              onChange={handleAccordionChange("panel__whymissingfields")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>
                  Why are there missing BIDS fields in the loaded spreadsheet? Are they going to disappear when I save
                  the spreadsheet?
                </Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  With some exceptions, only fields that have to do with ASL processing are actively displayed or
                  add-able. This was done in order to accomodate enourmous datasets that feature thousands of scans.
                </p>
                <br />
                <p>
                  However, these "missing" columns are not deleted from the BIDS sidecars during export, as it is
                  assumed that they have good reason being there in the first place. Instead, supported (i.e. visible
                  columns) fields from the speadsheet overwrite existing values. New fields are simply added as well.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__doyouhavevalidation"}
              onChange={handleAccordionChange("panel__doyouhavevalidation")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Are BIDS fields validated?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  Validation is currently not supported (likely will be in a future update). However, most of the
                  widgets within individual spreadsheet cells implicitly prevent you from inputting invalid values.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel_howdoIaddafield"}
              onChange={handleAccordionChange("panel_howdoIaddafield")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>
                  There is a field(s) missing from the BIDS sidecars that was never added during import. How do I add
                  it/them?
                </Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  In the bottom of the program, you'll see a button with the text "ADD A NEW BIDS COLUMN". Click it.
                </p>
                <p>You'll be brought to a dialog window that is comprised of 3 steps:</p>
                <ol style={{ textIndent: "1rem", listStylePosition: "inside" }}>
                  <li>Select the BIDS field that you'd like to add.</li>
                  <li>
                    Select the default value that should be applied to all rows. Alternatively, if the column should be
                    mostly empty, check the box that says "Start with empty cells instead of applying the default
                    value".
                  </li>
                  <li>Click the "ADD TO SPREADSHEET" action label in the bottom right corner of the dialog window.</li>
                </ol>
                <p>
                  Your new column is automatically added as the rightmost column. You may need to move the scrollbar to
                  see it.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel_whatisexploreaslpath"}
              onChange={handleAccordionChange("panel_whatisexploreaslpath")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>
                  I have a mixed dataset that needs to have certain fields present in some scans and omitted in others.
                  When I add a column, I notice that it applies a default value to all the cells, causing all the BIDS
                  sidecars to end up with the value if I save the spreadsheet. What do I do?
                </Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  After having added your column, click on a cell corresponding to the column of interest and the row of
                  the scan where you want it omitted from (you can see which scan this applies to in the Basename
                  column). When you see the cell selected, press the Delete button on your keyboard. The cell should now
                  be empty. This cell's value is now nothing/empty, so it will be omitted from being written into the
                  file corresponding to the row.
                </p>
                <br />
                <p>Repeat this for all the cells/fields that need to be omitted from their respective files.</p>
              </AccordionDetails>
            </Accordion>
          </section>
        </Stack>
      </DialogContent>
    </>
  );
}

export default React.memo(HelpBIDSDatagrid__BIDSDatagrid);
