import React, { useState } from "react";
import { DialogTitleH4 } from "../../components/DialogTitle";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { BulletPointList } from "./HelpStyledComponents";
import Link from "@mui/material/Link";
import HelperImage__DataVizRerunPopulationModule from "../../assets/img/HelperImages/HelperImage__DataVizRerunPopulationModule.png";
import Box from "@mui/material/Box";

function HelpDataViz__StepDefineDataframeLoc() {
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
              expanded={expanded === "panel__whatisthedatavizmodule"}
              onChange={handleAccordionChange("panel__whatisthedatavizmodule")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What does the "Data Visualization" part of the program do?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>The intent of this module is two-fold:</p>
                <BulletPointList>
                  <li>
                    To allow users to visualize how the cerebral blood flow (CBF) data of analyzed subjects&nbsp;maps
                    against other variables of interest. This greatly speeds up the identification of quantitative
                    outliers.
                  </li>
                  <li>
                    To assist users in quality control. If a data point comes off as an outlier, users can just click on
                    said data point and be presented with the CBF volumes as interactive axial, coronal, and sagittal
                    slice views. While ExploreASL outputs very helpful summaries, they are restricted to only certain
                    slices which risks the chance of artifacts being omitted. With an interactive view, this is no
                    longer an issue.
                  </li>
                </BulletPointList>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__useforownspreadsheets"}
              onChange={handleAccordionChange("panel__useforownspreadsheets")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Can I use this part of the program to visualize only my own spreadsheets?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  Unfortunately, at the current time, this option is not available, since the program is specifically
                  geared towards plotting the output of ExploreASL. You can, however, merge the ExploreASL data with
                  your own metadata as long as the latter possesses a column called SUBJECT
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__canIloadexcelspreadsheets"}
              onChange={handleAccordionChange("panel__canIloadexcelspreadsheets")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Can I load Microsoft Excel spreadsheets as my metadata?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>Yes and no.</p>
                <br />
                <p>
                  Only comma-separated values (.csv) or tab-separated values (.tsv) files are accepted for metadata. And
                  while Excel spreadsheets don&#39;t fit that criteria, all excel spreadsheets have the option to be
                  exported as one of the two in Microsoft Excel. You&#39;ll just have to do that extra step.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__itisntacceptingtheindicatedatlases"}
              onChange={handleAccordionChange("panel__itisntacceptingtheindicatedatlases")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Why isn't it accepting the atlases I've selected?!</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  Because it would have been necessary to have those atlases first indicated in the &quot;Define
                  Parameters&quot; section of this program.
                </p>

                <p>Fortunately, it isn&#39;t too much of a hassle to get things to work with these steps:</p>

                <ol>
                  <li>
                    Go back to the &quot;Define Parameters&quot; section of this program and load in your study&#39;s
                    dataPar.json file.
                  </li>
                  <li>
                    Go to the &quot;Processing Parameters&quot; tab of that section and indicate the atlases you are
                    interested in.
                  </li>
                  <li>Save the new dataPar.json file which will overwrite the old one.</li>
                  <li>
                    Go to the &quot;Process Studies&quot; --&gt; &quot;Prepare A Re-run&quot; section. Load in the study
                    which will need to have its Population Module re-run.
                  </li>
                  <li>
                    Expand the xASL_module_Population portions and select the step associated with calculating ROI
                    statistics. Tell the program to delete that step.
                    <Box
                      mx="auto"
                      my={2}
                      display="block"
                      maxWidth={500}
                      component="img"
                      src={HelperImage__DataVizRerunPopulationModule}
                    />
                  </li>
                  <li>Go to the&nbsp;&quot;Run ExploreASL&quot; tab and run the Population Module for this study.</li>
                  <li>Once completed successfully, you will be permitted to indicate those atlases.</li>
                </ol>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__howcanIgettheprogramtoacceptmymetadata"}
              onChange={handleAccordionChange("panel__howcanIgettheprogramtoacceptmymetadata")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What are the requirements for the program to accept my metadata?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  The metadata spreadsheet must contain a column called SUBJECT in order to perform an{" "}
                  <Link href="https://miro.medium.com/max/1838/1*UAPgZRnhFG29C0nDFi5D0A.png" target="_blank">
                    outer-left join
                  </Link>{" "}
                  with the ExploreASL data (the latter being the &quot;left&quot; portion of the join). As this is an
                  outer-left join, subjects which are present in the metadata but absent in the ExploreASL data will be
                  removed.
                </p>
                <br />
                <p>
                  In addition to the SUBJECT column (which must be present regardless) you can also merge with an
                  additional column called: session. Again, the nature of the join is outer-left. Rows for SUBJECT and
                  session which are present in the metadata but absent in the ExploreASL data will be removed.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__willsomeofmymetadatacolumnsberemoved"}
              onChange={handleAccordionChange("panel__willsomeofmymetadatacolumnsberemoved")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Will some of my metadata columns be removed?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  It is possible that some of your metadata columns will be removed. Currently, the following conditions
                  will cause the removal of a column:
                </p>
                <br />
                <BulletPointList>
                  <li>It is completely empty.</li>
                  <li>
                    It contains mixed types of data (i.e. pure numbers in certain cells and alphanumeric characters in
                    other cells)
                  </li>
                  <li>
                    It contains complex/nested values (i.e. if this:&nbsp;[1, 2, 3] was inside a cell, it is interpreted
                    as an array of numbers). Arrays and JSON-like content is interpreted as complex.
                  </li>
                </BulletPointList>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__doyousupportcustomrois"}
              onChange={handleAccordionChange("panel__doyousupportcustomrois")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>Do you support custom ROIs (i.e. masks of clusters in a voxelwise analysis?)</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  At the current time, only defined regions from popular atlases (i.e. Harvard-Oxford Cortical) are
                  supported.&nbsp;
                </p>
                <br />
                <p>
                  <strong>In the future</strong>, we will consider allowing users to indicate their own regions by
                  supplying:
                </p>

                <BulletPointList>
                  <li>
                    A NIFTI file in MNI-space (121 x 145 x 121 voxels) with integers masking the regions of interest.
                  </li>
                  <li>
                    A &quot;.tsv&quot; file with one row with the names of regions. The order of these names will have
                    to correspond to the ascending order of integers in the NIFTI file.
                  </li>
                </BulletPointList>
              </AccordionDetails>
            </Accordion>
          </section>
        </Stack>
      </DialogContent>
    </>
  );
}

export default React.memo(HelpDataViz__StepDefineDataframeLoc);
