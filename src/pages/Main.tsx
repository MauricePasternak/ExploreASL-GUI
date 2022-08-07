import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useAtomValue } from "jotai";
import React from "react";
import { APPBARHEIGHTPIXELS } from "../common/GLOBALS";
import { atomDarkMode } from "../stores/DarkModeStore";
import { atomCurrentGUIPage } from "../stores/GUIFrameStore";
import AboutPage from "./About";
import DataParPage from "./DataPar";
import GUIFrame from "./GUIFrame";
import ImportModulePage from "./ImportModule";
import ProcessStudiesPage from "./ProcessStudies";
import DataVisualizationPage from "./DataVisualization";

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
      <Box
        className="currentMainPage"
        height={`calc(100% - ${APPBARHEIGHTPIXELS}px)`}
        display={currentGUIPage === "About" ? "block" : "none"}
      >
        <AboutPage />
      </Box>
      <Box
        className="currentMainPage"
        height={`calc(100% - ${APPBARHEIGHTPIXELS}px)`}
        display={currentGUIPage === "DataVisualization" ? "block" : "none"}
      >
        <DataVisualizationPage />
      </Box>
    </ThemeProvider>
  );
}


export default Main;
