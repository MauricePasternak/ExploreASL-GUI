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
    return (React.createElement(Paper, { component: "section", sx: { maxWidth: 2160 } },
        React.createElement(Accordion, null,
            React.createElement(AccordionSummary, { expandIcon: React.createElement(ExpandMoreIcon, null) },
                React.createElement(Typography, { variant: "h4", component: "h1" }, "Getting Started")),
            React.createElement(AccordionDetails, { sx: { display: "flex", flexDirection: "column" } },
                React.createElement(Divider, { style: { width: "100%", marginBottom: "1rem" } }),
                React.createElement("p", null, "This program relies on ExploreASL, which in turn relies on MATLAB in some capacity. Therefore, there are 2 approaches to take."),
                React.createElement("br", null),
                React.createElement(Typography, { variant: "h5" }, "Licensed MATLAB & ExploreASL from Github"),
                React.createElement("br", null),
                React.createElement("p", null,
                    "1) Go to",
                    " ",
                    React.createElement(SecureLink, { href: "https://login.mathworks.com/embedded-login/landing.html?cid=getmatlab&s_tid=gn_getml" }, "MATLAB's website"),
                    " ",
                    "and download a relatively-modern version of MATLAB (2019a onward is recommended). Follow their installation instructions carefully."),
                React.createElement("p", null, "2) Go to the open-source repository for ExploreASL and clone the codebase to a folder on your workstation (see animation below). It is recommended to place it inside the MATLAB folder that is, itself, typically located within your system's Documents folder. Alternatively, if you don't have access to git, you can simply go to the repository, click on the green Code button and then the Download ZIP option from the dropdown. Extract the contents of the downloaded zip file into the MATLAB folder as described previously."),
                React.createElement("img", { src: GIFGitCloneExploreASL, style: { alignSelf: "center", width: "min(75%, 1200px)" } }),
                React.createElement("br", null),
                React.createElement("p", null, "3) ExploreASL should be added to MATLAB's paths (see animation below). In MATLAB, go to the HOME tab and click on the Set Path button. A dialog window will open. Click Add with Subfolders... and navigate to select the ExploreASL folder you had downloaded."),
                React.createElement("img", { src: GIFMatlabAddPaths, style: { alignSelf: "center", width: "min(75%, 1200px)" } }),
                React.createElement("br", null),
                React.createElement("p", null, "It may be necessary to restart your computer for changes to be set. But with the above steps, you should be set for using this program with \"ExploreASL from Github\", which is an option you will encounter during the workflow."),
                React.createElement("br", null),
                React.createElement(Typography, { variant: "h5" }, "MATLAB Runtime & Compiled ExploreASL"),
                React.createElement("br", null),
                React.createElement("p", null,
                    "1) Go to",
                    " ",
                    React.createElement(SecureLink, { href: "https://www.mathworks.com/products/compiler/matlab-runtime.html" }, "MATLAB's Runtime Website"),
                    " ",
                    "and download R2019a (9.6) specifically for your operating system. No other version is compatible with Compiled ExploreASL for the time being. Unzip and follow the installer's instructions carefully."),
                React.createElement("p", null,
                    "2) Contact either\u00A0",
                    React.createElement(SecureLink, { href: "mailto:h.j.mutsaerts@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL" }, "Henk Mutsaerts"),
                    "\u00A0or\u00A0",
                    React.createElement(SecureLink, { href: "mailto:j.petr@hzdr.de?subject=%5BGitHub%5D%20ExploreASL" }, "Jan Petr"),
                    "\u00A0for a copy of the compiled ExploreASL program. Save it in an accessible location (i.e. does not need administrator/sudo priveleges to access)."),
                React.createElement("br", null),
                React.createElement("p", null, "As in the other scenario, a restart may be necessary for changes to be set. When prompted, specify to this program that you intend to use \"Compiled ExploreASL\". You will also be asked to specify the MATLAB Runtime path (filepath to a folder called v96).")))));
}
//# sourceMappingURL=AboutGettingStarted.js.map