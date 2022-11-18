import Toolbar from "@mui/material/Toolbar";
import React from "react";
import ApplicationBar from "./ApplicationBar";
import ApplicationDrawer from "./ApplicationDrawer";

export const GUIFrame = React.memo(() => {
  return (
    <>
      <ApplicationBar />
      <Toolbar variant="dense" />
      <ApplicationDrawer />
    </>
  );
});
