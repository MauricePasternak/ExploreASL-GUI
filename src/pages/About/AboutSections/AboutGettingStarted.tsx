import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";
import { SecureLink } from "../../../components/NavComponents";

import GIFGitCloneExploreASL from "../../../assets/gif/GitCloneExploreASL.gif";
import GIFMatlabAddPaths from "../../../assets/gif/MATLABAddPaths.gif";

export function AboutGettingStarted() {
  return (
    <Paper component="section" sx={{ maxWidth: 2160 }}>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h4" component="h1">
            Getting Started
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ display: "flex", flexDirection: "column" }}>
          <Divider style={{ width: "100%", marginBottom: "1rem" }} />
          <p>
            This program relies on ExploreASL, which in turn relies on MATLAB in some capacity. Therefore, there are 2
            approaches to take.
          </p>
          <br />
          <Typography variant="h5">Licensed MATLAB &amp; ExploreASL from Github</Typography>
          <br />
          <p>
            1) Go to{" "}
            <SecureLink href="https://login.mathworks.com/embedded-login/landing.html?cid=getmatlab&amp;s_tid=gn_getml">
              MATLAB&#39;s website
            </SecureLink>{" "}
            and download a relatively-modern version of MATLAB (2019a onward is recommended). Follow their installation
            instructions carefully.
          </p>

          <p>
            2) Go to the open-source repository for ExploreASL and clone the codebase to a folder on your workstation
            (see animation below). It is recommended to place it inside the MATLAB folder that is, itself, typically
            located within your system&#39;s Documents folder. Alternatively, if you don&#39;t have access to git, you
            can simply go to the repository, click on the green Code button and then the Download ZIP option from the
            dropdown. Extract the contents of the downloaded zip file into the MATLAB folder as described previously.
          </p>
          <img src={GIFGitCloneExploreASL} style={{ alignSelf: "center", width: "min(75%, 1200px)" }} />
          <br />
          <p>
            3) ExploreASL should be added to MATLAB&#39;s paths (see animation below). In MATLAB, go to the HOME tab and
            click on the Set Path button. A dialog window will open. Click Add with Subfolders... and navigate to select
            the ExploreASL folder you had downloaded.
          </p>
          <img src={GIFMatlabAddPaths} style={{ alignSelf: "center", width: "min(75%, 1200px)" }} />
          <br />
          <p>
            It may be necessary to restart your computer for changes to be set. But with the above steps, you should be
            set for using this program with &quot;ExploreASL from Github&quot;, which is an option you will encounter
            during the workflow.
          </p>

          <br />
          <Typography variant="h5">MATLAB Runtime &amp; Compiled ExploreASL</Typography>
          <br />
          <p>
            1) Go to{" "}
            <SecureLink href="https://www.mathworks.com/products/compiler/matlab-runtime.html">
              MATLAB&#39;s Runtime Website
            </SecureLink>{" "}
            and download R2019a (9.6) specifically for your operating system. No other version is compatible with
            Compiled ExploreASL for the time being. Unzip and follow the installer&#39;s instructions carefully.
          </p>

          <p>
            2) Contact either&nbsp;
            <SecureLink href="mailto:h.j.mutsaerts@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL">
              Henk Mutsaerts
            </SecureLink>
            &nbsp;or&nbsp;
            <SecureLink href="mailto:j.petr@hzdr.de?subject=%5BGitHub%5D%20ExploreASL">Jan Petr</SecureLink>
            &nbsp;for a copy of the compiled ExploreASL program. Save it in an accessible location (i.e. does not need
            administrator/sudo priveleges to access).
          </p>
          <br />
          <p>
            As in the other scenario, a restart may be necessary for changes to be set. When prompted, specify to this
            program that you intend to use &quot;Compiled ExploreASL&quot;. You will also be asked to specify the MATLAB
            Runtime path (filepath to a folder called v96).
          </p>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}
