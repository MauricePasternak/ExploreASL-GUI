import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";

function AboutExploreASLTeam() {
  return (
    <Paper component="section" sx={{ width: "100%", maxWidth: 2160 }}>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h4" component="h1">
            ExploreASL Team
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Divider style={{ width: "100%", marginBottom: "1rem" }} />
          <p>
            This graphical user interface was developed by{" "}
            <Link href="https://github.com/MauricePasternak" target="_blank">
              Maurice Pasternak
            </Link>
            . For questions regarding this program interface, please contact him at{" "}
            <Link data-fr-linked="true" href="mailto:maurice.pasternak@utoronto.ca" target="_blank">
              maurice.pasternak@utoronto.ca
            </Link>
            . For all other inquiries, please see the team makeup and contacts below.
          </p>
          <br />
          <Typography variant="h5" component="h2">
            ExploreASL Members
          </Typography>
          <br />
          <ul style={{ listStylePosition: "inside", textIndent: 2, marginLeft: "1rem" }}>
            <li>
              <Link href="mailto:h.j.mutsaerts@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                Henk Mutsaerts
              </Link>{" "}
              - Co-creator,{" "}
              <Link href="https://www.researchgate.net/profile/Henri-Mutsaerts" rel="nofollow" target="_blank">
                Researcher
              </Link>
            </li>
            <li>
              <Link href="mailto:j.petr@hzdr.de?subject=%5BGitHub%5D%20ExploreASL">Jan Petr</Link> - Co-creator,{" "}
              <Link href="https://www.researchgate.net/profile/Jan-Petr-2" rel="nofollow" target="_blank">
                Researcher
              </Link>
            </li>
            <li>
              <Link href="mailto:m.stritt@mediri.com?subject=%5BGitHub%5D%20ExploreASL">Michael Stritt</Link> - Software
              developer, Research Associate,{" "}
              <Link href="http://aspire-mri.eu/" rel="nofollow" target="_blank">
                ASPIRE
              </Link>
            </li>
            <li>
              <Link href="mailto:m.b.dijsselhof@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                Mathijs Dijsselhof
              </Link>{" "}
              - PhD student,{" "}
              <Link href="https://sites.google.com/view/exploreasl/projects" rel="nofollow" target="_blank">
                Cerebrovascular Age
              </Link>
            </li>
            <li>
              <Link href="mailto:b.estevespadrela@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                Beatriz Padrela
              </Link>{" "}
              - PhD student,{" "}
              <Link href="https://sites.google.com/view/exploreasl/projects" rel="nofollow" target="_blank">
                BBB-ASL
              </Link>
            </li>
            <li>
              <Link href="mailto:maurice.pasternak@mail.utoronto.ca?subject=%5BGitHub%5D%20ExploreASL">
                Maurice Pasternak
              </Link>{" "}
              - Developer ExploreASL User Interface
            </li>
            <li>
              <Link href="mailto:p.f.c.groot@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL">Paul Groot</Link> -
              Software developer, IT specialist,{" "}
              <Link href="https://www.researchgate.net/profile/Paul-Groot" rel="nofollow" target="_blank">
                Researcher
              </Link>
            </li>
            <li>
              <Link href="mailto:pieter.vandemaele@gmail.com?subject=%5BGitHub%5D%20ExploreASL">Pieter Vandemaele</Link>{" "}
              - Developer Matlab,{" "}
              <Link href="https://github.com/bids-standard" target="_blank">
                BIDS app
              </Link>
            </li>
            <li>
              <Link href="mailto:l.lorenzini@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                Luigi Lorenzini
              </Link>{" "}
              - Developer,{" "}
              <Link href="https://www.hzdr.de/publications/Publ-31929" rel="nofollow" target="_blank">
                ExploreQC
              </Link>
            </li>

            <li>
              <Link href="mailto:Sandeep.g.bio@gmail.com?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                Sandeep Ganji
              </Link>{" "}
              - Developer integration Philips ISD,{" "}
              <Link href="https://www.researchgate.net/profile/Sandeep-Ganji-3" rel="nofollow" target="_blank">
                Researcher
              </Link>
            </li>
            <li>
              <Link href="mailto:Patricia.Clement@ugent.be?subject=%5BGitHub%5D%20ExploreASL" target="_blank">
                Patricia Clement
              </Link>{" "}
              - Developer ASL-BIDS &amp; organizer,{" "}
              <Link href="https://www.researchgate.net/profile/Patricia-Clement" rel="nofollow" target="_blank">
                Researcher
              </Link>
            </li>
          </ul>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}

export default AboutExploreASLTeam;
