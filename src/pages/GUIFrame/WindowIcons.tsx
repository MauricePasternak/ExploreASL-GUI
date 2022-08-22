import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import { useAtom } from "jotai";
import React from "react";
import { atomDarkMode } from "../../stores/DarkModeStore";
// ICONS
import CloseIcon from "@mui/icons-material/Close";
import DarkModeSharpIcon from "@mui/icons-material/DarkModeSharp";
import LightModeSharpIcon from "@mui/icons-material/LightModeSharp";
import MinimizeIcon from "@mui/icons-material/Minimize";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

function WindowIcons() {
  const [isDarkMode, setIsDarkMode] = useAtom(atomDarkMode);

  return (
    <Box sx={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
      <IconButton
        color="inherit"
        sx={{
          height: 48,
          borderRadius: 0,
          "&:hover": {
            backgroundColor: theme => theme.palette.primary.dark,
          },
        }}
        onClick={() => setIsDarkMode(!isDarkMode)}
      >
        {isDarkMode ? <DarkModeSharpIcon /> : <LightModeSharpIcon />}
      </IconButton>
      <IconButton
        color="inherit"
        sx={{
          height: 48,
          borderRadius: 0,
          "&:hover": {
            backgroundColor: theme => theme.palette.primary.dark,
          },
        }}
        onClick={() => window.api.invoke("App:Minimize")}
      >
        <MinimizeIcon />
      </IconButton>
      <IconButton
        color="inherit"
        sx={{
          height: 48,
          borderRadius: 0,
          "&:hover": {
            backgroundColor: theme => theme.palette.primary.dark,
          },
        }}
        onClick={() => window.api.invoke("App:Maximize")}
      >
        <OpenInNewIcon />
      </IconButton>
      <IconButton
        color="inherit"
        sx={{
          height: 48,
          borderRadius: 0,
          "&:hover": {
            backgroundColor: "#D71526",
          },
        }}
        onClick={() => window.api.invoke("App:Quit")}
      >
        <CloseIcon className="easl__closeIcon" sx={{ color: "white" }} />
      </IconButton>
    </Box>
  );
}

export default WindowIcons;
