var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import React, { useState } from "react";
import Dialog from "@mui/material/Dialog";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import Fab from "@mui/material/Fab";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
/**
 * Wrapper component for allowing a Fab button to open a dialog window at the location the Fab is placed.
 * @param icon Icon component to be displayed within the Fab component. Defaults to a HelpOutlineIcon.
 * @param iconText String or ReactNode for the text to the displayed within the Fab component.
 * @param fullScreenWhen The breakpoint below which the dialog's width will enter fullScreen. Defaults to "md".
 * @param fabProps Additional props to give to the Fab component.
 * @param ...dialogProps All remaining props are given to the underlying Dialog component that is opened.
 */
export function FabDialogWrapper(_a) {
    var { children, icon = React.createElement(HelpOutlineIcon, { fontSize: "large", sx: { mr: 1 } }), iconText = "Help", fullScreenWhen = "sm", fabProps } = _a, dialogProps = __rest(_a, ["children", "icon", "iconText", "fullScreenWhen", "fabProps"]);
    const [open, setOpen] = useState(false);
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down(fullScreenWhen));
    const handleClose = () => setOpen(false);
    const handleOpen = () => setOpen(true);
    return (React.createElement(React.Fragment, null,
        React.createElement(Dialog, Object.assign({ fullScreen: fullScreen }, dialogProps, { open: open, onClose: handleClose }), children),
        React.createElement(Fab, Object.assign({ variant: "extended", color: "primary" }, fabProps, { onClick: handleOpen }),
            icon,
            iconText)));
}
//# sourceMappingURL=FabDialogWrapper.js.map