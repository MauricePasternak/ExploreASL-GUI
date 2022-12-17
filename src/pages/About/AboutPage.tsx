import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import React from "react";
import ExploreASLGUIIconDarkMode from "../../assets/appIcons/ExploreASLGUIIconDarkMode.png";
import ExploreASLGUIIconLightMode from "../../assets/appIcons/ExploreASLGUIIconLightMode.png";
import {
	AboutAcknowledgements,
	AboutDescription,
	AboutExploreASLTeam,
	AboutGettingStarted,
	AboutOverview,
	AboutWorkflow,
} from "./AboutSections";

export const AboutPage = React.memo(() => {
	const theme = useTheme();
	return (
		<Box
			display="flex"
			flexDirection="column"
			alignItems="center"
			gap={2}
			className="currentMainPage"
			// height={`calc(100% - ${APPBARHEIGHTPIXELS}px)`}
			padding={2}
			// border="1px solid red"
		>
			<Box
				component="img"
				src={theme.palette.mode === "dark" ? ExploreASLGUIIconDarkMode : ExploreASLGUIIconLightMode}
				sx={{
					height: 250,
					width: 250,
				}}
			/>
			<AboutDescription />
			<AboutGettingStarted />
			<AboutOverview />
			<AboutWorkflow />
			<AboutExploreASLTeam />
			<AboutAcknowledgements />
		</Box>
	);
});
