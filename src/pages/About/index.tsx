import Box from "@mui/material/Box";
import React from "react";

import ExploreASLBannerImage from "../../assets/img/ExploreASLBanner.png";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import AboutAcknowledgements from "./AboutAcknowledgements";
import AboutDescription from "./AboutDescription";
import AboutExploreASLTeam from "./AboutExploreASLTeam";
import AboutGettingStarted from "./AboutGettingStarted";
import AboutOverview from "./AboutOverview";
import AboutWorkflow from "./AboutWorkflow";

function AboutPage() {
  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      gap={2}
      className="currentMainPage"
      height={`calc(100% - ${APPBARHEIGHTPIXELS}px)`}
      padding={2}
    >
      <img src={ExploreASLBannerImage} style={{ maxWidth: "800px" }} />
      <AboutDescription />
      <AboutGettingStarted />
      <AboutOverview />
      <AboutWorkflow />
      <AboutExploreASLTeam />
      <AboutAcknowledgements />
    </Box>
  );
}

export default React.memo(AboutPage);
