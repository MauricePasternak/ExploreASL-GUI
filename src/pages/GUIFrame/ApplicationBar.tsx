import MenuIcon from "@mui/icons-material/Menu";
import { Typography } from "@mui/material";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Icon from "@mui/material/Icon";
import IconButton from "@mui/material/IconButton";
import Toolbar from "@mui/material/Toolbar";
import { useSetAtom } from "jotai";
import React from "react";
import ExploreASLPNG from "../../assets/appIcons/ExploreASLIcon.png";
import { atomDrawerIsOpen } from "../../stores/GUIFrameStore";
import WindowIcons from "./WindowIcons";

function ApplicationBar() {
  const setDrawerOpen = useSetAtom(atomDrawerIsOpen);

  return (
    <AppBar className="GUI__AppBar" position="fixed" sx={{ boxShadow: "none" }}>
      <Toolbar variant="dense" disableGutters>
        <IconButton
          color="inherit"
          sx={{
            height: 48,
            borderRadius: 0,
            "&:hover": {
              backgroundColor: (theme) => theme.palette.primary.dark,
            },
          }}
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <MenuIcon />
        </IconButton>

        <Box className="drag-window" display="flex" alignItems="center" flexGrow={1} alignSelf="stretch">
          <Icon sx={{ mx: 1, height: 36, width: 36 }}>
            <img src={ExploreASLPNG} />
          </Icon>
          <Typography variant="h6">ExploreASL GUI</Typography>
        </Box>
        <WindowIcons />
      </Toolbar>
    </AppBar>
  );
}

export default ApplicationBar;
