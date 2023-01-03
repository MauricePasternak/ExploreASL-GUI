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
import React, { useState, useEffect } from "react";
import { styled } from "@mui/material/styles";
import LinearProgress, { linearProgressClasses } from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
const BorderLinearProgress = styled(LinearProgress)(({ theme }) => ({
    height: 10,
    borderRadius: 5,
    [`&.${linearProgressClasses.colorPrimary}`]: {
        backgroundColor: theme.palette.grey[theme.palette.mode === "light" ? 200 : 800],
    },
    [`& .${linearProgressClasses.bar}`]: {
        borderRadius: 5,
        backgroundColor: theme.palette.mode === "light" ? "#1a90ff" : "#308fe8",
    },
}));
export const IPCProgressWithLabel = React.memo((_a) => {
    var { channelName, incrementType = "Increment" } = _a, props = __rest(_a, ["channelName", "incrementType"]);
    const [value, setValue] = useState(0);
    const { api } = window;
    // console.log(`IPCProgresWithLabel has re-rendered with value: ${value}`);
    useEffect(() => {
        api.on(`${channelName}:progressBarReset`, () => {
            setValue(0);
        });
        api.on(`${channelName}:progressBarIncrement`, value => {
            incrementType === "Increment" ? setValue(currVal => currVal + value) : setValue(value);
        });
        return () => {
            api.removeAllListeners(`${channelName}:progressBarReset`);
            api.removeAllListeners(`${channelName}:progressBarIncrement`);
        };
    }, [channelName]);
    return (React.createElement(Box, { sx: { display: "flex", alignItems: "center" } },
        React.createElement(Box, { sx: { width: "100%", mr: 1 } },
            React.createElement(BorderLinearProgress, Object.assign({ variant: "determinate", value: Math.round(value) }, props))),
        React.createElement(Box, { sx: { minWidth: 35 } },
            React.createElement(Typography, { variant: "body2", color: "text.secondary" }, `${Math.round(value)}%`))));
});
//# sourceMappingURL=IPCProgressWithLabel.js.map