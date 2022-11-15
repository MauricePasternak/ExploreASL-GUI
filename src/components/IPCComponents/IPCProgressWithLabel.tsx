import React, { useState, useEffect } from "react";
import { styled } from "@mui/material/styles";
import LinearProgress, { LinearProgressProps, linearProgressClasses } from "@mui/material/LinearProgress";
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

type IPCProgressWithLabelProps = {
  channelName: string;
  incrementType?: "Increment" | "SetAsNewValue";
} & LinearProgressProps;

export const IPCProgressWithLabel = React.memo(
  ({ channelName, incrementType = "Increment", ...props }: IPCProgressWithLabelProps) => {
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

    return (
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <Box sx={{ width: "100%", mr: 1 }}>
          <BorderLinearProgress variant="determinate" value={Math.round(value)} {...props} />
        </Box>
        <Box sx={{ minWidth: 35 }}>
          <Typography variant="body2" color="text.secondary">{`${Math.round(value)}%`}</Typography>
        </Box>
      </Box>
    );
  }
);
