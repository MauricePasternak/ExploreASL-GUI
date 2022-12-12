import React from "react";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";
import { BIDSAllFieldsNameType, BIDSFieldNameToDisplayName } from "./BIDSColumnDefs";
import { atomBIDSErrors } from "../../stores/BIDSDataGridStore";
import ErrorIcon from "@mui/icons-material/Error";
type BIDSParsedError = {
	fieldName: string;
	rowIndex: string;
	errorMessage: string;
};

export const BIDSDataGridErrorPopover = memo(() => {
	// Local State
	const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

	// Atomic State
	const bidsErrorMapping = useAtomValue(atomBIDSErrors);

	// ? Is there a better way to do this???
	const parsedErrors: BIDSParsedError[] = [];
	for (const [fieldName, rowErrorMapping] of Object.entries(bidsErrorMapping)) {
		for (const [rowIndex, errorMessage] of Object.entries(rowErrorMapping)) {
			parsedErrors.push({
				fieldName,
				rowIndex,
				errorMessage,
			});
		}
	}
	const hasError = parsedErrors.length > 0;
	const open = Boolean(anchorEl);
	const id = open ? "BIDSErrorPopover" : undefined;

	return (
		<>
			<Button
				aria-describedby={id}
				disabled={!hasError}
				size="small"
				variant={hasError ? "contained" : "text"}
				startIcon={
					<>
						<SearchOffIcon />
						{hasError && <span style={{ color: "" }}>{parsedErrors.length}</span>}
					</>
				}
				color="error"
				onClick={(event) => setAnchorEl(event.currentTarget)}
			>
				View Errors
			</Button>
			<Popover
				id={id}
				open={!!anchorEl}
				anchorEl={anchorEl}
				onClose={() => setAnchorEl(null)}
				anchorOrigin={{
					vertical: "bottom",
					horizontal: "left",
				}}
			>
				<Box padding={1}>
					<Typography variant="subtitle1">The following errors were found within the BIDS Dataframe:</Typography>
					<List sx={{ maxHeight: 300 }}>
						{parsedErrors.map((error) => (
							<ListItem key={`${error.fieldName}-${error.rowIndex}`}>
								<ListItemButton>
									<ErrorIcon sx={{ color: "error.main" }} />
								</ListItemButton>
								<ListItemText
									primary={error.errorMessage}
									secondary={
										<>
											<Typography variant="subtitle2" component="span">
												Found in column
											</Typography>{" "}
											<Typography variant="subtitle2" component="span" sx={{ fontWeight: 800 }}>
												{BIDSFieldNameToDisplayName[error.fieldName as BIDSAllFieldsNameType]}
											</Typography>{" "}
											<Typography variant="subtitle2" component="span">
												at row ID {error.rowIndex}
											</Typography>
										</>
									}
								/>
							</ListItem>
						))}
					</List>
				</Box>
			</Popover>
		</>
	);
});
