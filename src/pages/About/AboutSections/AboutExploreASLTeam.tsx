import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import React from "react";
import { SecureLink } from "../../../components/NavComponents";

export function AboutExploreASLTeam() {
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
            <SecureLink href="https://github.com/MauricePasternak">Maurice Pasternak</SecureLink>
            .
            <br />
            <br />
            For questions, suggestions for improvement, and issues regarding the use of this graphical program, please
            contact him at{" "}
            <SecureLink data-fr-linked="true" href="mailto:maurice.pasternak@utoronto.ca">
              maurice.pasternak@utoronto.ca
            </SecureLink>{" "}
            or submit an issue at{" "}
            <SecureLink href="https://github.com/MauricePasternak/ExploreASLJS/issues/new/choose">
              the GitHub repository of this program
            </SecureLink>
            .
            <br />
            For questions regarding error messages that originate from the ExploreASL pipeline, please contact the main
            ExploreASL team at <SecureLink href="exploreasl.lab@gmail.com">exploreasl.lab@gmail.com</SecureLink>
          </p>
          <br />
          <Typography variant="h5" component="h2">
            ExploreASL Members
          </Typography>
          <br />
          <ul style={{ listStylePosition: "inside", textIndent: 2, marginLeft: "1rem" }}>
            <li>
              <SecureLink href="mailto:h.j.mutsaerts@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL">
                Henk Mutsaerts
              </SecureLink>{" "}
              - Co-creator,{" "}
              <SecureLink href="https://www.researchgate.net/profile/Henri-Mutsaerts">Researcher</SecureLink>
            </li>
            <li>
              <SecureLink href="mailto:j.petr@hzdr.de?subject=%5BGitHub%5D%20ExploreASL">Jan Petr</SecureLink> -
              Co-creator, <SecureLink href="https://www.researchgate.net/profile/Jan-Petr-2">Researcher</SecureLink>
            </li>
            <li>
              <SecureLink href="mailto:m.stritt@mediri.com?subject=%5BGitHub%5D%20ExploreASL">
                Michael Stritt
              </SecureLink>{" "}
              - Software developer, Research Associate, <SecureLink href="http://aspire-mri.eu/">ASPIRE</SecureLink>
            </li>
            <li>
              <SecureLink href="mailto:m.b.dijsselhof@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL">
                Mathijs Dijsselhof
              </SecureLink>{" "}
              - PhD student,{" "}
              <SecureLink href="https://sites.google.com/view/exploreasl/projects">Cerebrovascular Age</SecureLink>
            </li>
            <li>
              <SecureLink href="mailto:b.estevespadrela@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL">
                Beatriz Padrela
              </SecureLink>{" "}
              - PhD student, <SecureLink href="https://sites.google.com/view/exploreasl/projects">BBB-ASL</SecureLink>
            </li>
            <li>
              <SecureLink href="mailto:maurice.pasternak@mail.utoronto.ca?subject=%5BGitHub%5D%20ExploreASL">
                Maurice Pasternak
              </SecureLink>{" "}
              - Developer ExploreASL User Interface
            </li>
            <li>
              <SecureLink href="mailto:p.f.c.groot@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL">
                Paul Groot
              </SecureLink>{" "}
              - Software developer, IT specialist,{" "}
              <SecureLink href="https://www.researchgate.net/profile/Paul-Groot">Researcher</SecureLink>
            </li>
            <li>
              <SecureLink href="mailto:pieter.vandemaele@gmail.com?subject=%5BGitHub%5D%20ExploreASL">
                Pieter Vandemaele
              </SecureLink>{" "}
              - Developer Matlab, <SecureLink href="https://github.com/bids-standard">BIDS app</SecureLink>
            </li>
            <li>
              <SecureLink href="mailto:l.lorenzini@amsterdamumc.nl?subject=%5BGitHub%5D%20ExploreASL">
                Luigi Lorenzini
              </SecureLink>{" "}
              - Developer, <SecureLink href="https://www.hzdr.de/publications/Publ-31929">ExploreQC</SecureLink>
            </li>

            <li>
              <SecureLink href="mailto:Sandeep.g.bio@gmail.com?subject=%5BGitHub%5D%20ExploreASL">
                Sandeep Ganji
              </SecureLink>{" "}
              - Developer integration Philips ISD,{" "}
              <SecureLink href="https://www.researchgate.net/profile/Sandeep-Ganji-3">Researcher</SecureLink>
            </li>
            <li>
              <SecureLink href="mailto:Patricia.Clement@ugent.be?subject=%5BGitHub%5D%20ExploreASL">
                Patricia Clement
              </SecureLink>{" "}
              - Developer ASL-BIDS &amp; organizer,{" "}
              <SecureLink href="https://www.researchgate.net/profile/Patricia-Clement">Researcher</SecureLink>
            </li>
          </ul>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}
