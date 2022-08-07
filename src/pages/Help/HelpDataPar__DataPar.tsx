import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import React, { useState } from "react";
import { DialogTitleH4 } from "../../components/DialogTitle";
import { BulletPointList } from "./HelpStyledComponents";
import HelperImage__EASLGithubExample from "../../assets/img/HelperImages/HelperImage__EASLGithubExample.png";
import HelperImage__EASLCompiledExample from "../../assets/img/HelperImages/HelperImage__EASLCompiledExample.png";
import HelperImage__MATLABRuntimeExample from "../../assets/img/HelperImages/HelperImage__MATLABRuntimeExample.png";
import HelperImage__DataParStudyRootExample from "../../assets/img/HelperImages/HelperImage__DataParStudyRootExample.png";
import HelperImage__DataParSubjectsToIncludeExample from "../../assets/img/HelperImages/HelperImage__DataParSubjectsToIncludeExample.png";
import HelperImage__DataParLoadDataParJSONExample from "../../assets/img/HelperImages/HelperImage__DataParLoadDataParJSONExample.png";

function HelpDataPar__DataPar() {
  const { api } = window;
  const [expanded, setExpanded] = useState<string | false>(false);

  const handleAccordionChange = (panel: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  return (
    <>
      <DialogTitleH4>Help Page Define Parameters</DialogTitleH4>
      <DialogContent>
        <Stack spacing={1}>
          <DialogContentText>Select a question that best describes your concern.</DialogContentText>

          <section>
            <Accordion
              expanded={expanded === "panel__whatdoesthedataparmoduledo"}
              onChange={handleAccordionChange("panel__whatdoesthedataparmoduledo")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What does the "Define Data Parameters" part of the program do?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>Primarily, this portion of the program has two objectives:</p>
                <BulletPointList>
                  <li>
                    To fine-tune and modify the execution behavior of ExploreASL. For example, perhaps you wish avoid
                    motion correction processing. Or you may want to control which subjects are processed and which
                    aren't without necessarily removing them from the dataset.
                  </li>
                  <li>
                    To provide backup values in the event of missing metadata, often due to the anonymization process of
                    DICOMs. When relevant values are not found in the metadata files accompanying each imported NIFTI
                    image, the values defined in this portion of the program will act as a substitute.
                  </li>
                </BulletPointList>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__how_do_I_reuse_parameters"}
              onChange={handleAccordionChange("panel__how_do_I_reuse_parameters")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>
                  I'd like to reuse some of the earlier parameters. Is there a shortcut to avoid re-defining all of them
                  each time?
                </Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  Yes! At the bottom of the window, you should be able to see a button which says "LOAD". Click on this
                  to bring up a file dialog window and select the file called dataPar.json which is located within the
                  study root folder.
                </p>
                <br />
                <p>
                  Note that there is another dataPar.json present inside the derivatives/ExploreASL subfolder path. Do
                  not select that one, as it is an internal copy that ExploreASL uses for its own purposes. Only load
                  from the one located at the study root folder.
                </p>
                <br />
                <Box
                  mx="auto"
                  display="block"
                  maxWidth={700}
                  component="img"
                  src={HelperImage__DataParLoadDataParJSONExample}
                />
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel_whatisexploreasltype"}
              onChange={handleAccordionChange("panel_whatisexploreasltype")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What is ExploreASL Type?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>There are two versions of ExploreASL that can be run:</p>
                <BulletPointList>
                  <li>from the Github repository</li>
                  <li>as a packaged &amp; compiled folder</li>
                </BulletPointList>
                <br />
                <p>These have different requirements regarding ancillary software needed to run them.</p>
                <br />
                <p>
                  The{" "}
                  <Link href="https://github.com/ExploreASL/ExploreASL" target="_blank">
                    Github version of ExploreASL
                  </Link>{" "}
                  requires an activated version of MATLAB 2019a or later.
                </p>
                <br />
                <p>
                  The packaged version of ExploreASL requires a MATLAB Runtime of version 2019a or later. The primary
                  advantage of this option is that MATLAB Runtime is free. Click{" "}
                  <Link href="https://www.mathworks.com/products/compiler/matlab-runtime.html" target="_blank">
                    here
                  </Link>{" "}
                  to be taken to download a MATLAB Runtime for your system.
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
                <Typography>What is ExploreASL Path?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  This is the filepath to the root folder of the ExploreASL program that will be used. This folder
                  differs depending on the value chosen for the &quot;ExploreASL Type&quot; field.
                </p>
                <br />
                <p>
                  If the Github (standard) version of ExploreASL was selected, this should be the folder, typically
                  called &quot;ExploreASL&quot; that was downloaded from the repository. You can confirm this is the
                  appropriate folder if it contains the following structure:
                </p>
                <Box mx="auto" display="block" maxWidth={500} component="img" src={HelperImage__EASLGithubExample} />
                <br />
                <br />
                <p>Therefore, a typical filepath to supply would be, for example:</p>
                {api.platform === "win32" ? (
                  <p>C:\Users\JohnDoe\MATLAB\ExploreASL</p>
                ) : (
                  <p>/home/JohnDoe/MATLAB/ExploreASL</p>
                )}
                <br />
                <p>Otherwise, if it is the packaged (compiled) version, the the file structure within differs:</p>
                <Box mx="auto" display="block" maxWidth={500} component="img" src={HelperImage__EASLCompiledExample} />
                <br />
                <br />
                <p>
                  For the packaged version, note that there may also be an extra folder that appears called
                  &quot;xASL_latest_mcr&quot;. It is created the first time that the packaged version of ExploreASL is
                  run and should not be deleted.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whatismatlabruntimepath"}
              onChange={handleAccordionChange("panel__whatismatlabruntimepath")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What is MATLAB Runtime Path</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  Firstly, this is only a necessary field if you intend to use the packaged/compiled version of
                  ExploreASL (not the one from the Github repository). You can (and should) leave this field blank if
                  you intend to use the ExploreASL version originating from Github. Otherwise, start by ensuring you
                  have followed{" "}
                  <Link href="https://www.mathworks.com/help/compiler/install-the-matlab-runtime.html" target="_blank">
                    the appropriate steps from the MATLAB website
                  </Link>
                  .
                </p>
                <br />
                <p>
                  The folder that you&apos;re looking for to specify for the GUI has the format v## (i.e. v97). A
                  typical location of this can be, for example:
                </p>
                {api.platform === "win32" ? (
                  <p>C:\Users\JohnDoe\MATLAB\MATLAB_Runtime\v97</p>
                ) : (
                  <p>/home/JohnDoe/MATLAB/MATLAB_Runtime/v97</p>
                )}
                <br />
                <p>This v## folder typically has the following structure:</p>
                <Box mx="auto" display="block" maxWidth={500} component="img" src={HelperImage__MATLABRuntimeExample} />
              </AccordionDetails>
            </Accordion>
          </section>

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
                  src={HelperImage__DataParStudyRootExample}
                />
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whatissubjectstoinclude"}
              onChange={handleAccordionChange("panel__whatissubjectstoinclude")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>How do I indicate subjects that I'd like processed or explicitly excluded?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  You can drag &amp; drop (or select with a dialog window by clicking BROWSE) the subjects' folders that
                  are contained within the <strong>rawdata</strong> folder.
                </p>
                <br />
                <p>
                  Do not select subjects that may be located within <strong>sourcedata</strong> or from{" "}
                  <strong>derivatives</strong>. This is done to prevent any naming discrepancies from confusing the
                  program.
                </p>
                <br />
                <Box
                  mx="auto"
                  display="block"
                  maxWidth={700}
                  component="img"
                  src={HelperImage__DataParSubjectsToIncludeExample}
                />
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whatisM0Type"}
              onChange={handleAccordionChange("panel__whatisM0Type")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What is M0 Type?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  This field refers to whether there was a proton-density scan (M0) acquired for your dataset. As per{" "}
                  <Link href="https://pubmed.ncbi.nlm.nih.gov/24715426/" target="_blank">
                    ASL Consensus Paper
                  </Link>
                  , a proton density image is required to scale the final perfusion image into clinically relevant units
                  of mL / 100g / min. There are two possiblities here:
                </p>
                <BulletPointList>
                  <li>
                    The user has acquired a proton-density scan. If so, select the option: &quot;
                    <strong>M0 Scan is present in the dataset</strong>&quot;.&nbsp;
                  </li>
                  <li>
                    The user did not acquire a proton-density scan. A substitute will have to be generated using the
                    mean of the control ASL images. Select &quot;
                    <strong>Use mean of control ASL scans as M0 substitute</strong>&quot; to have ExploreASL follow this
                    behavior.
                  </li>
                </BulletPointList>
                <br />
                <p>There are important factors to take into account when deciding which option to take:&nbsp;</p>
                <BulletPointList>
                  <li>
                    It is possible to select the second option even if there is an M0 scan that was acquired. This
                    necessary when only certain scans have an M0 scan and others do not.
                  </li>
                  <li>
                    If the second option is selected and the field &quot;Number of Background Suppression Pulses&quot;
                    is non-zero,{" "}
                    <strong>
                      then the background suppression &nbsp;timings must be specified in the &quot;Background
                      Suppression Pulse Timings&quot; field
                    </strong>
                    . This is necessary in order to adjust calculations for said suppression pulses.
                  </li>
                </BulletPointList>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whataboutCASL"}
              onChange={handleAccordionChange("panel__whataboutCASL")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>
                  My study used the older Continuous ASL labeling method, but that isn't an option. What do I do?
                </Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  Specify &quot;Pseudo-continuous ASL&quot; for the &quot;Labeling Type&quot; field. Continuous and
                  Pseudo-continuous methods undergo identical quantification.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whatisslicereadouttime"}
              onChange={handleAccordionChange("panel__whatisslicereadouttime")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What is the Slice Readout Time and how do I know what value to provide?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  The SliceReadoutTime is a parameter that is needed for quantification of 2D ASL acquisitions as the
                  timing of the readout of each slice (and hence quantification) differs. For 3D, this parameter can be
                  ignored. Otherwise, the estimation of this parameter depends on the labeling type.
                </p>
                <br />
                <p>For pulsed ASL acquisitions, it can be estimated as:</p>
                <br />
                <p style={{ marginLeft: "1rem" }}>
                  <strong>(minTR - TI) / numOfSlices</strong>
                </p>
                <br />
                <p>
                  Where minTR is the minimal repetition time. This is a standard value that should be available in the
                  DICOM files or in the scanner protocol export. TI is the inversion time. numOfSlices is the number of
                  2D slices that make up a volume. All times mentioned should be calculated using milliseconds.
                </p>
                <br />
                <p>For pseudo-continuous (or continuous) ASL acquisitions, it can be estimated as: </p>
                <br />
                <p style={{ marginLeft: "1rem" }}>
                  <strong>(minTR - PLD - LabelDur) / numOfSlices</strong>
                </p>
                <br />
                <p>
                  Where minTR and numOfSlices is the same as for the pulsed ASL case. PLD is the post-label delay and
                  LabelDur is the mean labeling duration; both of these are fields you should have already specified in
                  their respective fields within this module. All times mentioned should be calculated using
                  milliseconds.
                </p>
                <br />
                <p>
                  As a rough estimate, SliceReadoutTime is typically anywhere between 20-50 milliseconds. Values outside
                  of this range should be treated as atypical.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__partialvolumecorrectisonlyinnativespace"}
              onChange={handleAccordionChange("panel__partialvolumecorrectisonlyinnativespace")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>
                  I see partial volume correct settings? Do they only apply to native space CBF images?
                </Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  Unfortunately at the current time, the main ExploreASL pipeline does not support applying partial
                  volume correction to MNI-standard space CBF images. There are custom scripts available in the
                  repository on Github, but they haven't been implemented at the current time.
                </p>
                <br />
                <p>So, yes, unfortunately the partial volume correction settings only apply to native space images.</p>
              </AccordionDetails>
            </Accordion>
          </section>
        </Stack>
      </DialogContent>
    </>
  );
}

export default HelpDataPar__DataPar;
