import InfoIcon from "@mui/icons-material/Info";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import React from "react";
import BIDSIcon from "../../assets/svg/BIDSIcon.svg";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import { AtomicSnackbarMessage } from "../../components/AtomicComponents";
import { FabDialogWrapper } from "../../components/WrapperComponents";
import { atomBIDSDatagridSnackbar } from "../../stores/SnackbarStore";
import HelpBIDSDatagrid__BIDSDatagrid from "../Help/HelpBIDSDatagrid__BIDSDatagrid";
import { BIDSAddColumnDialog } from "./BIDSCustomActionComponents/BIDSAddColumnDialog";
import { BIDSRemoveColumnDialog } from "./BIDSCustomActionComponents/BIDSRemoveColumnDialog";
import BIDSDataForm from "./BIDSDataForm";
import { BIDSDataGrid } from "./BIDSDataGrid";
export const BIDSDataGridPage = React.memo(() => {
    return (React.createElement(Box, { display: "flex", className: "currentMainPage", height: `calc(100% - ${APPBARHEIGHTPIXELS}px)` },
        React.createElement(Stack, { rowGap: 2, sx: { padding: 2, width: "100%" } },
            React.createElement(Card, null,
                React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h4" }, "Verify BIDS Sidecars"), subheader: React.createElement(Typography, null, "Validate an imported BIDS dataset & edit fields on a per-scan basis"), avatar: React.createElement(Avatar, { sizes: "large" },
                        React.createElement(SvgIcon, { component: BIDSIcon, inheritViewBox: true })), action: React.createElement(FabDialogWrapper, { maxWidth: "xl", PaperProps: { sx: { minWidth: "499px" } }, sx: { marginTop: "40px" } },
                        React.createElement(HelpBIDSDatagrid__BIDSDatagrid, null)) }),
                React.createElement(Divider, null),
                React.createElement(Box, { pb: {
                        sm: 7,
                        md: 2,
                    }, display: "flex", alignItems: "center" },
                    React.createElement(ListItem, null,
                        React.createElement(ListItemIcon, null,
                            React.createElement(InfoIcon, { color: "primary", fontSize: "large" })),
                        React.createElement(ListItemText, { primary: "Note: When editing cell values, there is a ~0.3-1 second delay (due to validation) between the most recent change and the time the value can be submitted to the spreadsheet." })))),
            React.createElement(BIDSDataForm, null),
            React.createElement(BIDSDataGrid, null),
            React.createElement(BIDSAddColumnDialog, null),
            React.createElement(BIDSRemoveColumnDialog, null)),
        React.createElement(AtomicSnackbarMessage, { atomConfig: atomBIDSDatagridSnackbar })));
});
//# sourceMappingURL=BIDSDataGridPage.js.map