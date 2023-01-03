import Toolbar from "@mui/material/Toolbar";
import React from "react";
import ApplicationBar from "./ApplicationBar";
import ApplicationDrawer from "./ApplicationDrawer";
export const GUIFrame = React.memo(() => {
    return (React.createElement(React.Fragment, null,
        React.createElement(ApplicationBar, null),
        React.createElement(Toolbar, { variant: "dense" }),
        React.createElement(ApplicationDrawer, null)));
});
//# sourceMappingURL=GUIFrame.js.map