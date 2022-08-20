import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import React from "react";
import BIDSAddColumnDialog from "./BIDSAddColumnDialog";
import BIDSDataActions from "./BIDSDataActions";
import BIDSDataForm from "./BIDSDataForm";
import BIDSDG from "./BIDSDG";
import SvgIcon from "@mui/material/SvgIcon";
import BIDSIcon from "../../assets/svg/BIDSIcon.svg";

function BIDSDataGrid() {
  return (
    <Box display="flex">
      <Box
        display="flex"
        flexDirection="column"
        gap={2}
        padding={2}
        // mr={40}
        width="100%"
        // width="calc(100% - 350px)"
      >
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
                <SvgIcon component={BIDSIcon} inheritViewBox />
              </Avatar>
            }
          />
          <Divider />
        </Card>
        <BIDSDataForm />
        <BIDSDG />
      </Box>
      <BIDSAddColumnDialog />
      <BIDSDataActions />
    </Box>
  );
}

export default React.memo(BIDSDataGrid);
