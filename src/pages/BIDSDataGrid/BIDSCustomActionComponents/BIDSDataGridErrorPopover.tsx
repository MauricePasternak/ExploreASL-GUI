import ErrorIcon from "@mui/icons-material/Error";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import { useAtomValue } from "jotai";
import React, { memo, useState } from "react";
import { atomBIDSColumnNames, atomBIDSErrors } from "../../../stores/BIDSDataGridStore";
import { BIDSAllFieldsNameType, BIDSFieldNameToDisplayName } from "../BIDSColumnDefs";

type BIDSParsedError = {
	fieldName: BIDSAllFieldsNameType;
	rowIndex: string;
	errorMessage: string;
};

export const BIDSDataGridErrorPopover = memo(() => {
	// Local State
	const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

	// Atomic State
	const bidsErrorMapping = useAtomValue(atomBIDSErrors);
	const bidsColumnNames = new Set(useAtomValue(atomBIDSColumnNames));

	// ? Is there a better way to do this???
	const parsedErrors: BIDSParsedError[] = [];
	for (const [fieldName, rowErrorMapping] of Object.entries(bidsErrorMapping)) {
		for (const [rowIndex, errorMessage] of Object.entries(rowErrorMapping)) {
			parsedErrors.push({
				fieldName,
				rowIndex,
				errorMessage,
			} as BIDSParsedError);
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
							<ListItem key={`${error.fieldName}__${error.rowIndex}`}>
								<ListItemIcon>
									<ErrorIcon sx={{ color: "error.main", fontSize: "2rem" }} />
								</ListItemIcon>
								<ListItemText
									primary={error.errorMessage}
									secondary={
										bidsColumnNames.has(error.fieldName) ? (
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
										) : (
											<>
												<Typography variant="subtitle2" component="span">
													This would normally be found in column
												</Typography>{" "}
												<Typography variant="subtitle2" component="span" sx={{ fontWeight: 800 }}>
													{BIDSFieldNameToDisplayName[error.fieldName as BIDSAllFieldsNameType]}
												</Typography>
												{` at row ID ${error.rowIndex}.`}
												<Typography variant="subtitle2">
													However this column is currently not present in the spreadsheet. Use the "ADD COLUMN" button
													to add this column in if necessary.
												</Typography>
											</>
										)
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
