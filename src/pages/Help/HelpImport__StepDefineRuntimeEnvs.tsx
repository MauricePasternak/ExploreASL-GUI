import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import React, { useState } from "react";
import HelperImage__EASLCompiledExample from "../../assets/img/HelperImages/HelperImage__EASLCompiledExample.png";
import HelperImage__EASLGithubExample from "../../assets/img/HelperImages/HelperImage__EASLGithubExample.png";
import HelperImage__ImportBeforeAndAfter from "../../assets/img/HelperImages/HelperImage__ImportBeforeAndAfter.png";
import HelperImage__ImportFolderStructureMapping from "../../assets/img/HelperImages/HelperImage__ImportFolderStructureMapping.png";
import HelperImage__MATLABRuntimeExample from "../../assets/img/HelperImages/HelperImage__MATLABRuntimeExample.png";
import HelperImage__StudyRootWithSourcedataExample from "../../assets/img/HelperImages/HelperImage__StudyRootWithSourcedataExample.png";
import { DialogTitleH4 } from "../../components/TypographyComponents/DialogTitle";
import { SecureLink } from "../../components/NavComponents";
import { BulletPointList } from "./HelpStyledComponents";

function HelpImport__StepDefineRuntimeEnvs() {
  const { api } = window;
  const [expanded, setExpanded] = useState<string | false>(false);

  const handleAccordionChange = (panel: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  return (
    <>
      <DialogTitleH4>Help Page Define Folder Structure</DialogTitleH4>
      <DialogContent>
        <Stack spacing={1}>
          <DialogContentText>Select a question that best describes your concern.</DialogContentText>

          <section>
            <Accordion
              expanded={expanded === "panel__whatistheimportmodule"}
              onChange={handleAccordionChange("panel__whatistheimportmodule")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What does the "Import Dataset" part of the program do?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  MRI Images come off the scanner in a file format called <strong>DICOM</strong>. While useful for
                  storage, most MRI image analysis programs require a different file format called{" "}
                  <strong>NIFTI</strong>.
                </p>
                <br />
                <p>
                  Furthermore, the output between scanners is not standardized, resulting in difficulties with respect
                  to collaborations between MRI image study groups and in the setup of the analyses.
                </p>
                <br />
                <p>
                  Therefore, this module aims to convert an existing scanner output format into a{" "}
                  <SecureLink href="https://bids.neuroimaging.io/">BIDS-standard</SecureLink> structure while also
                  converting the DICOM files into NIFTI format.
                </p>
                <br />
                <p>Here is an example of pre- and post- import folder structures:</p>
                <Box mx="auto" display="block" maxWidth={500} component="img" src={HelperImage__ImportBeforeAndAfter} />
                <p>
                  <strong>"sourcedata"</strong> contains the intial filestructure output from your MRI scanner.{" "}
                  <strong>"rawdata"</strong> contains the BIDS-standard NIFTI conversion. <strong>"derivatives"</strong>{" "}
                  contains the various analyses performed on copies of files from rawdata.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === " panel__whatisExploreASLType"}
              onChange={handleAccordionChange(" panel__whatisExploreASLType")}
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
                  <SecureLink href="https://github.com/ExploreASL/ExploreASL">Github version of ExploreASL</SecureLink>{" "}
                  requires an activated version of MATLAB 2019a or later.
                </p>
                <br />
                <p>
                  The packaged version of ExploreASL requires a MATLAB Runtime of version 2019a or later. The primary
                  advantage of this option is that MATLAB Runtime is free. Click{" "}
                  <SecureLink href="https://www.mathworks.com/products/compiler/matlab-runtime.html">here</SecureLink>{" "}
                  to be taken to download a MATLAB Runtime for your system.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whatisExploreASLPath"}
              onChange={handleAccordionChange("panel__whatisExploreASLPath")}
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
              expanded={expanded === "panel__whatisMATLABRuntimePath"}
              onChange={handleAccordionChange("panel__whatisMATLABRuntimePath")}
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
                  <SecureLink href="https://www.mathworks.com/help/compiler/install-the-matlab-runtime.html">
                    the appropriate steps from the MATLAB website
                  </SecureLink>
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
              expanded={expanded === "panel__whatisStudyRootFolder"}
              onChange={handleAccordionChange("panel__whatisStudyRootFolder")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What is the Study Root Folder?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  This is the root folder of your overall study that must adhere to{" "}
                  <SecureLink href="https://bids.neuroimaging.io/">Brain Imaging Data Structure (BIDS)</SecureLink>{" "}
                  standard in order to be usable by ExploreASL. An example of a BIDS-compatible folder structure would
                  be:
                </p>
                <br />
                <Box
                  mx="auto"
                  display="block"
                  maxWidth={400}
                  component="img"
                  src={HelperImage__StudyRootWithSourcedataExample}
                />
                <br />
                <p>
                  As this is the Import Module, the only mandatory folder that must be present is{" "}
                  <strong>sourcedata</strong>. The other two common subfolders, <strong>rawdata</strong> and{" "}
                  <strong>derivatives</strong> are generated by this Import Module when the program is run.
                </p>
                <br />
                <p>
                  Additional expectations about the folder structure of your study are outlined below under &quot;How
                  should the data be organized to work with the Import Module?&quot;
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whatissourcestructure"}
              onChange={handleAccordionChange("panel__whatissourcestructure")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What is going on in the Study Structure area and what is sourcedata?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  In compliance with BIDS standard, it is expected that original scan data is placed inside a folder
                  called "sourcedata", which itself is a folder found at the root of your MRI project.
                </p>
                <br />
                <p>
                  In 99% of cases, the output from MRI scanners contains 1 piece of information for every folder depth
                  that is output. One level may contain subject descriptors, another folder depth may describe the type
                  of scan acquired, etc. Of course some folders may contain no relevant information and should be
                  ignored (i.e. a redunant folder called DICOM is typically output by certain Siemens scanners).
                </p>
                <br />
                <p>
                  The user is expected to tell the program what piece of information is kept at each folder depth from{" "}
                  <strong>"sourcedata"</strong> to, and including, the last folder that contains the DICOM files. The
                  following are the available options:
                </p>
                <BulletPointList>
                  <li>Subject</li>
                  <li>Visit</li>
                  <li>Session</li>
                  <li>Scan</li>
                  <li>Ignore</li>
                </BulletPointList>
                <br />
                <p>The following is an example of such user specification:</p>
                <br />
                <Box
                  mx="auto"
                  display="block"
                  maxWidth={500}
                  component="img"
                  src={HelperImage__ImportFolderStructureMapping}
                />
                <br />
                <p>
                  A point of clarification, as there may be some confusion between Visit and Session. A session is an
                  instance of scanning that typically occurs in quick succession to another while being the same image
                  modality type (i.e. a scan while resting, another scan while performing a task). A visit can,
                  essentially, be thought of as every instance where a patient visits the scanner facility for one or
                  more scans, typically significant time periods apart (i.e. one visit to be scanned at "baseline" and
                  then another a year later as a "followup" visit).
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whatdoesIgnoremean"}
              onChange={handleAccordionChange("panel__whatdoesIgnoremean")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What does Ignore mean?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  Simply put, it is a folder that should not be taken into account when determining a piece of
                  information about the dataset. Typically, scanners will produce redundant folders with either
                  jibberish names and fluff like &quot;DICOM&quot; before actually reaching a folder level that contains
                  the dicom files.
                </p>
                <br />
                <p>
                  The DUMMY designation is to tell the program &quot;hey, ignore this level of folders that appears
                  after sourcedata, but keep in mind how it pads the folder structure&quot;.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>

          <section>
            <Accordion
              expanded={expanded === "panel__whatifafoldercontainstwopiecesofinfo"}
              onChange={handleAccordionChange("panel__whatifafoldercontainstwopiecesofinfo")}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography>What if a folder contains two pieces of information?</Typography>
              </AccordionSummary>
              <Divider />
              <AccordionDetails>
                <p>
                  At the current time, the program does not support mixed-information folder levels. For example, a
                  folder with name: &quot;sub-001_ASL&quot; would not be valid, as it contains both information about
                  the subject and the scan type. The Import Module currently expects that all folder levels contain{" "}
                  <strong>one and only one&nbsp;</strong>piece of information about the dataset.
                </p>
              </AccordionDetails>
            </Accordion>
          </section>
        </Stack>
      </DialogContent>
    </>
  );
}

export default React.memo(HelpImport__StepDefineRuntimeEnvs);
