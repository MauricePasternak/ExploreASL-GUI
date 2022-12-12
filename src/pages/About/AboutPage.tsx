import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import React from "react";
import ExploreASLGUIIconDarkMode from "../../assets/appIcons/ExploreASLGUI_Logo_DarkMode.png";
import ExploreASLGUIIconLightMode from "../../assets/appIcons/ExploreASLGUI_Logo_LightMode.png";
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
					mb: 2
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
