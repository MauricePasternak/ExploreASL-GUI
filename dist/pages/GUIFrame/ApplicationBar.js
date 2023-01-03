import MenuIcon from "@mui/icons-material/Menu";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import SvgIcon from "@mui/material/SvgIcon";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { useSetAtom } from "jotai";
import React from "react";
// import ExploreASLPNG from "../../assets/appIcons/ExploreASLIcon.png";
import ExploreASLGUISVG from "../../assets/svg/ExploreASLGUIIcon.svg";
import { atomDrawerIsOpen } from "../../stores/GUIFrameStore";
import WindowIcons from "./WindowIcons";
function ApplicationBar() {
    const setDrawerOpen = useSetAtom(atomDrawerIsOpen);
    return (React.createElement(AppBar, { className: "GUI__AppBar", position: "fixed", sx: { boxShadow: "none" } },
        React.createElement(Toolbar, { variant: "dense", disableGutters: true },
            React.createElement(IconButton, { color: "inherit", sx: {
                    height: 48,
                    borderRadius: 0,
                    "&:hover": {
                        backgroundColor: (theme) => theme.palette.primary.dark,
                    },
                }, onClick: () => setDrawerOpen((open) => !open) },
                React.createElement(MenuIcon, null)),
            React.createElement(Box, { className: "drag-window", display: "flex", alignItems: "center", flexGrow: 1, alignSelf: "stretch" },
                React.createElement(SvgIcon, { component: ExploreASLGUISVG, inheritViewBox: true, sx: { mx: 1 } }),
                React.createElement(Typography, { variant: "h6" }, "ExploreASL GUI")),
            React.createElement(WindowIcons, null))));
}
export default ApplicationBar;
//# sourceMappingURL=ApplicationBar.js.map