import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import React from "react";
import MoodIcon from "@mui/icons-material/Mood";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import { useAtom } from "jotai";
import { atomDarkMode } from "../../stores/GlobalSettingsStore";
import ButtonGroup from "@mui/material/ButtonGroup";
import InputLabel from "@mui/material/InputLabel";
import Button from "@mui/material/Button";
import DarkModeSharpIcon from "@mui/icons-material/DarkModeSharp";
import LightModeSharpIcon from "@mui/icons-material/LightModeSharp";
import Typography from "@mui/material/Typography";
export function PreferredAestheticsSettings() {
    const [isDarkMode, setIsDarkMode] = useAtom(atomDarkMode);
    return (React.createElement(Card, null,
        React.createElement(CardHeader, { title: "Aesthetic Settings", titleTypographyProps: { variant: "h4" }, subheader: "Change the look and feel of the software", avatar: React.createElement(Avatar, null,
                React.createElement(MoodIcon, null)) }),
        React.createElement(Divider, { variant: "middle" }),
        React.createElement(CardContent, null,
            React.createElement(Grid, { container: true, rowSpacing: 2, columnSpacing: 3 },
                React.createElement(Grid, { item: true, xs: 12, lg: 6 },
                    React.createElement(InputLabel, null, "Light/Dark Mode"),
                    React.createElement(ButtonGroup, { size: "large", sx: { my: 1 } },
                        React.createElement(Button, { variant: isDarkMode ? "outlined" : "contained", startIcon: React.createElement(LightModeSharpIcon, null), onClick: () => setIsDarkMode(false) }, "Light"),
                        React.createElement(Button, { variant: isDarkMode ? "contained" : "outlined", startIcon: React.createElement(DarkModeSharpIcon, null), onClick: () => setIsDarkMode(true) }, "Dark")),
                    React.createElement(Typography, { variant: "subtitle2" },
                        "Currently selected: ",
                        isDarkMode ? "Dark Mode" : "Light Mode"))))));
}
//# sourceMappingURL=PreferredAestheticsSettings.js.map