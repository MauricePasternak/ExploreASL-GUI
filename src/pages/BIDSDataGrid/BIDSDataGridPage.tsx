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
	return (
		<Box display="flex" className="currentMainPage" height={`calc(100% - ${APPBARHEIGHTPIXELS}px)`}>
			<Stack rowGap={2} sx={{ padding: 2, width: "100%" }}>
				<Card>
					<CardHeader
						title={<Typography variant="h4">Verify BIDS Sidecars</Typography>}
						subheader={<Typography>Validate an imported BIDS dataset & edit fields on a per-scan basis</Typography>}
						avatar={
							<Avatar sizes="large">
								<SvgIcon component={BIDSIcon} inheritViewBox />
							</Avatar>
						}
						action={
							<FabDialogWrapper maxWidth="xl" PaperProps={{ sx: { minWidth: "499px" } }} sx={{ marginTop: "40px" }}>
								<HelpBIDSDatagrid__BIDSDatagrid />
							</FabDialogWrapper>
						}
					/>
					<Divider />
					<Box
						pb={{
							sm: 7,
							md: 2,
						}}
						display="flex"
						alignItems="center"
					>
						<ListItem>
							<ListItemIcon>
								<InfoIcon color="primary" fontSize="large" />
							</ListItemIcon>
							<ListItemText primary="Note: When editing cell values, there is a ~0.3-1 second delay (due to validation) between the most recent change and the time the value can be submitted to the spreadsheet." />
						</ListItem>
					</Box>
				</Card>
				<BIDSDataForm />
				<BIDSDataGrid />
				<BIDSAddColumnDialog />
				<BIDSRemoveColumnDialog />
			</Stack>
			<AtomicSnackbarMessage atomConfig={atomBIDSDatagridSnackbar} />
		</Box>
	);
});
