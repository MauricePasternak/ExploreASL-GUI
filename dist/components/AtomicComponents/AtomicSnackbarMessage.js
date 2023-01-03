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
import React from "react";
import { useAtom } from "jotai";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";
import AlertTitle from "@mui/material/AlertTitle";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
/**
 * Modified Snackbar that displays an alert message.
 */
const BaseAtomicSnackbarMessage = (_a) => {
    var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    var { atomConfig, variant = "filled", zIndex = 1400 } = _a, snackbarProps = __rest(_a, ["atomConfig", "variant", "zIndex"]);
    const [config, setConfig] = useAtom(atomConfig);
    const isOpen = !!config.message; // closed when message is an empty string or empty array
    /**
     * Parses the config message into Typography components.
     */
    const parseConfigMessage = (message) => {
        if (Array.isArray(message)) {
            return message.map((msg, idx) => {
                const key = `AtomicSnackbarMessageLine_${idx}`;
                // Array of strings
                if (typeof msg === "string")
                    return /^\s+$/gm.test(msg) ? React.createElement("br", { key: key }) : React.createElement(Typography, { key: key }, msg);
                // Array of SnackbarMessageType objects
                return msg;
            });
        }
        else if (typeof message === "string") {
            return /^\s+$/gm.test(message) ? (React.createElement("br", { key: `AtomicSnackbarMessageLine` })) : (React.createElement(Typography, { key: `AtomicSnackbarMessageLine` }, message));
        }
        else {
            return message;
        }
    };
    return isOpen ? (React.createElement(Snackbar, Object.assign({ open: isOpen, autoHideDuration: null, onClose: () => setConfig(Object.assign(Object.assign({}, config), { title: "", message: "" })), anchorOrigin: { horizontal: "center", vertical: "bottom" }, 
        // Allows for the snackbar to pop up right in the middle of the window
        sx: {
            top: "1rem",
            minWidth: "max(450px, 80%)",
            maxWidth: "80%",
            left: "50%",
            bottom: "24px",
            right: "auto",
            transform: "translateX(-50%)",
            zIndex: zIndex,
        } }, snackbarProps),
        React.createElement(Alert, { variant: variant, severity: config.severity, sx: {
                "& .MuiAlert-action": {
                    mr: -1.5,
                    p: 0,
                },
                width: "100%",
            }, iconMapping: {
                error: React.createElement(ErrorOutlineOutlinedIcon, { fontSize: (_c = (_b = config.extraDisplayProps) === null || _b === void 0 ? void 0 : _b.alertIconSize) !== null && _c !== void 0 ? _c : "large" }),
                info: React.createElement(InfoOutlinedIcon, { fontSize: (_e = (_d = config.extraDisplayProps) === null || _d === void 0 ? void 0 : _d.alertIconSize) !== null && _e !== void 0 ? _e : "large" }),
                warning: React.createElement(WarningAmberOutlinedIcon, { fontSize: (_g = (_f = config.extraDisplayProps) === null || _f === void 0 ? void 0 : _f.alertIconSize) !== null && _g !== void 0 ? _g : "large" }),
                success: React.createElement(CheckCircleOutlinedIcon, { fontSize: (_j = (_h = config.extraDisplayProps) === null || _h === void 0 ? void 0 : _h.alertIconSize) !== null && _j !== void 0 ? _j : "large" }),
            }, action: React.createElement(IconButton, { "aria-label": "close", color: "inherit", onClick: () => setConfig(Object.assign(Object.assign({}, config), { title: "", message: "" })) },
                React.createElement(CloseIcon, { fontSize: (_l = (_k = config.extraDisplayProps) === null || _k === void 0 ? void 0 : _k.closeIconSize) !== null && _l !== void 0 ? _l : "large" })) },
            React.createElement(AlertTitle, null,
                React.createElement(Typography, { variant: (_m = config.titleVariant) !== null && _m !== void 0 ? _m : "h4" }, config.title)),
            React.createElement(Box, { maxHeight: (_p = (_o = config.extraDisplayProps) === null || _o === void 0 ? void 0 : _o.maxHeight) !== null && _p !== void 0 ? _p : "400px", p: 1, sx: { overflowY: "auto" } }, isOpen && parseConfigMessage(config.message))))) : null;
};
export const AtomicSnackbarMessage = React.memo(BaseAtomicSnackbarMessage);
//# sourceMappingURL=AtomicSnackbarMessage.js.map