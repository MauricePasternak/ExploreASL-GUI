import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useAtomValue } from "jotai";
import React from "react";
import { APPBARHEIGHTPIXELS } from "../common/GLOBALS";
import { atomDarkMode } from "../stores/GlobalSettingsStore";
import { atomCurrentGUIPage } from "../stores/GUIFrameStore";
import { AboutPage } from "./About/AboutPage";
import { BIDSDataGridPage } from "./BIDSDataGrid/BIDSDataGridPage";
import { DataParPage } from "./DataPar/DataParPage";
import { DataVisualizationPage } from "./DataVisualization/DataVisualizationPage";
import { GUIFrame } from "./GUIFrame/GUIFrame";
import { ImportModulePage } from "./ImportModule/ImportModulePage";
import { ProcessStudiesPage } from "./ProcessStudies/ProcessStudiesPage";
import { SettingsPage } from "./Settings/SettingsPage";

function Main() {
	const isDarkMode = useAtomValue(atomDarkMode);
	const currentGUIPage = useAtomValue(atomCurrentGUIPage);
	const AppTheme = React.useMemo(
		() =>
			createTheme({
				palette: {
					mode: isDarkMode ? "dark" : "light",
					orange: {
						main: "#ff3d00",
						light: "#FF6333",
						dark: "#B22A00",
						contrastText: "#fff",
					},
				},
				additionalThemeProperty: "foobar", // see common/types/declarations.d.ts for more info
			}),
		[isDarkMode]
	);

	return (
		<ThemeProvider theme={AppTheme}>
			<CssBaseline />
			<GUIFrame />
			<Box
				className="currentMainPage"
				height={`calc(100% - ${APPBARHEIGHTPIXELS}px)`}
				display={currentGUIPage === "Import" ? "block" : "none"}
			>
				<ImportModulePage />
			</Box>
			<Box
				className="currentMainPage"
				height={`calc(100% - ${APPBARHEIGHTPIXELS}px)`}
				display={currentGUIPage === "DataPar" ? "block" : "none"}
			>
				<DataParPage />
			</Box>
			<Box
				className="currentMainPage"
				height={`calc(100% - ${APPBARHEIGHTPIXELS}px)`}
				display={currentGUIPage === "ProcessStudies" ? "block" : "none"}
			>
				<ProcessStudiesPage />
			</Box>
			{currentGUIPage === "BIDSDatagrid" && <BIDSDataGridPage />}
			{currentGUIPage === "DataVisualization" && <DataVisualizationPage />}
			{currentGUIPage === "About" && <AboutPage />}
      {currentGUIPage === "Settings" && <SettingsPage />}
		</ThemeProvider>
	);
}

export default Main;
