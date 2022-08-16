import AppRegistrationIcon from "@mui/icons-material/AppRegistration";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import React from "react";
import BIDSDataActions from "./BIDSDataActions";
import BIDSDataForm from "./BIDSDataForm";
import BIDSDG from "./BIDSDG";

function BIDSDataGrid() {
  return (
    <Box display="flex" flexDirection="column" gap={2} padding={2} height="100%">
      <Card>
        <CardHeader
          title={<Typography variant="h4">Edit BIDS Fields</Typography>}
          subheader={
            <Typography>
              Adjust ASL-related BIDS fields on a per-scan basis to adjust processing for that particular scan
            </Typography>
          }
          avatar={
            <Avatar sizes="large">
              <AppRegistrationIcon />
            </Avatar>
          }
        />
        <Divider />
      </Card>
      <BIDSDataForm />
      <BIDSDG />
      <BIDSDataActions />
    </Box>
  );
}

export default React.memo(BIDSDataGrid);
