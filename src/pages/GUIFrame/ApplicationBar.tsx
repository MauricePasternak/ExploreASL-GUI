import React from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import MenuIcon from "@mui/icons-material/Menu";
import WindowIcons from "./WindowIcons";
import Icon from "@mui/material/Icon";
import ExploreASLPNG from "../../assets/appIcons/ExploreASLIcon.png";
import { useSetAtom } from "jotai";
import { atomDrawerIsOpen } from "../../stores/GUIFrameStore";

function ApplicationBar() {
  const setDrawerOpen = useSetAtom(atomDrawerIsOpen)

  return (
    <AppBar className="GUI__AppBar" position="fixed" sx={{ boxShadow: "none" }}>
      <Toolbar variant="dense" disableGutters>
        <IconButton
          color="inherit"
          sx={{
            height: 48,
            borderRadius: 0,
            "&:hover": {
              backgroundColor: theme => theme.palette.primary.dark,
            },
          }}
          onClick={() => setDrawerOpen(open => !open)}
        >
          <MenuIcon />
        </IconButton>

        <Box className="drag-window" display="flex" alignItems="center" flexGrow={1} alignSelf="stretch">
          <Typography marginLeft="10px" variant="h6">
            ExploreASL GUI
          </Typography>
          <Icon sx={{ ml: 1, height: 36, width: 36 }}>
            <img src={ExploreASLPNG}></img>
          </Icon>
        </Box>
        <WindowIcons />
      </Toolbar>
    </AppBar>
  );
}

export default ApplicationBar;
