import Backdrop from "@mui/material/Backdrop";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import React from "react";

export function DeletingInProgressBackdrop({ isDeleting }: { isDeleting: boolean }) {
	return (
		<Backdrop
			sx={{
				color: "white",
				zIndex: (theme) => theme.zIndex.drawer + 1,
				display: "flex",
				flexDirection: "column",
				gap: 2,
			}}
			open={isDeleting}
		>
			<Typography variant="h6">Deleting In Progress...</Typography>
			<CircularProgress color="inherit" size={100} />
		</Backdrop>
	);
}
