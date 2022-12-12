import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
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
import BIDSDataForm from "./BIDSDataForm";
import { BIDSDataGrid } from "./BIDSDataGrid";
import { BIDSRemoveColumnDialog } from "./BIDSCustomActionComponents/BIDSRemoveColumnDialog";

export const BIDSDataGridPage = React.memo(() => {
	return (
		<Box display="flex" className="currentMainPage" height={`calc(100% - ${APPBARHEIGHTPIXELS}px)`}>
			<Box display="flex" flexDirection="column" gap={2} padding={2} width="100%">
				<Card>
					<CardHeader
						title={<Typography variant="h4">Verify BIDS Sidecars</Typography>}
						subheader={
							<Typography>
								Validate an imported BIDS dataset & edit fields on a per-scan basis to ensure that the dataset is valid
								against ASL-BIDS specification.
							</Typography>
						}
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
				</Card>
				<BIDSDataForm />
				<BIDSDataGrid />
				<BIDSAddColumnDialog />
				<BIDSRemoveColumnDialog />
			</Box>
			<AtomicSnackbarMessage atomConfig={atomBIDSDatagridSnackbar} />
		</Box>
	);
});
