import React, { useState } from "react";
import Dialog, { DialogProps } from "@mui/material/Dialog";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import Fab, { FabProps } from "@mui/material/Fab";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

interface InfoDialogWrapperProps extends Omit<DialogProps, "open"> {
  children: React.ReactNode;
  icon?: React.ReactNode;
  iconText?: React.ReactNode;
  fullScreenWhen?: "xs" | "sm" | "md" | "lg";
  fabProps?: FabProps;
}

/**
 * Wrapper component for allowing a Fab button to open a dialog window at the location the Fab is placed.
 * @param icon Icon component to be displayed within the Fab component. Defaults to a HelpOutlineIcon.
 * @param iconText String or ReactNode for the text to the displayed within the Fab component.
 * @param fullScreenWhen The breakpoint below which the dialog's width will enter fullScreen. Defaults to "md".
 * @param fabProps Additional props to give to the Fab component.
 * @param ...dialogProps All remaining props are given to the underlying Dialog component that is opened.
 */
function FabDialogWrapper({
  children,
  icon = <HelpOutlineIcon fontSize="large" sx={{ mr: 1 }} />,
  iconText = "Help",
  fullScreenWhen = "sm",
  fabProps,
  ...dialogProps
}: InfoDialogWrapperProps) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down(fullScreenWhen));
  const handleClose = () => setOpen(false);
  const handleOpen = () => setOpen(true);

  return (
    <>
      <Dialog fullScreen={fullScreen} {...dialogProps} open={open} onClose={handleClose}>
        {children}
      </Dialog>
      <Fab variant="extended" color="primary" {...fabProps} onClick={handleOpen}>
        {icon}
        {iconText}
      </Fab>
    </>
  );
}

export default FabDialogWrapper;
