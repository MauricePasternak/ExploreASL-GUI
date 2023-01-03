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
    const AppTheme = React.useMemo(() => createTheme({
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
    }), [isDarkMode]);
    return (React.createElement(ThemeProvider, { theme: AppTheme },
        React.createElement(CssBaseline, null),
        React.createElement(GUIFrame, null),
        React.createElement(Box, { className: "currentMainPage", height: `calc(100% - ${APPBARHEIGHTPIXELS}px)`, display: currentGUIPage === "Import" ? "block" : "none" },
            React.createElement(ImportModulePage, null)),
        React.createElement(Box, { className: "currentMainPage", height: `calc(100% - ${APPBARHEIGHTPIXELS}px)`, display: currentGUIPage === "DataPar" ? "block" : "none" },
            React.createElement(DataParPage, null)),
        React.createElement(Box, { className: "currentMainPage", height: `calc(100% - ${APPBARHEIGHTPIXELS}px)`, display: currentGUIPage === "ProcessStudies" ? "block" : "none" },
            React.createElement(ProcessStudiesPage, null)),
        currentGUIPage === "BIDSDatagrid" && React.createElement(BIDSDataGridPage, null),
        currentGUIPage === "DataVisualization" && React.createElement(DataVisualizationPage, null),
        currentGUIPage === "About" && React.createElement(AboutPage, null),
        currentGUIPage === "Settings" && React.createElement(SettingsPage, null)));
}
export default Main;
//# sourceMappingURL=Main.js.map