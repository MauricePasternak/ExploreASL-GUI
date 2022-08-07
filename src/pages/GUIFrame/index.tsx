import Toolbar from "@mui/material/Toolbar";
import React from "react";
import ApplicationBar from "./ApplicationBar";
import ApplicationDrawer from "./ApplicationDrawer";

function GUIFrame() {
  return (
    <>
      <ApplicationBar />
      <Toolbar variant="dense" />
      <ApplicationDrawer />
    </>
  );
}

export default GUIFrame;
