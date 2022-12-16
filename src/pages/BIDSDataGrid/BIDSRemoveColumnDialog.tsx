import React from "react";
import WarningIcon from "@mui/icons-material/Warning";
import { Typography } from "@mui/material";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useState } from "react";
import {
	atomBIDSColumnNames,
	atomBIDSRemoveColumnDialogOpen,
	atomSetBIDSRemoveColumn,
} from "../../stores/BIDSDataGridStore";
import { BIDSAllNonMiscFieldsNameType, isBIDSNonMiscField } from "./BIDSColumnDefs";

export const BIDSRemoveColumnDialog = memo(() => {
	// Atomic State
	const [open, setOpen] = useAtom(atomBIDSRemoveColumnDialogOpen);
	const currentColumnNames = useAtomValue(atomBIDSColumnNames);
	const removeBIDSColumn = useSetAtom(atomSetBIDSRemoveColumn);

	// Local State
	const [selectedFields, setSelectedFields] = useState<BIDSAllNonMiscFieldsNameType[]>([]);
	const [userUnderstandsRisk, setUserUnderstandsRisk] = useState<boolean>(false);

	const handleSelectedFieldChange = (event: SelectChangeEvent<BIDSAllNonMiscFieldsNameType[]>) => {
		if (typeof event.target.value === "string") {
			console.log(
				"🚀 ~ file: BIDSRemoveColumnDialog.tsx:32 ~ handleSelectedFieldChange ~ event.target.value",
				event.target.value
			);
			setSelectedFields([]);
		} else {
			setSelectedFields(event.target.value);
		}
	};

	const handleRemoveColumn = () => {
		removeBIDSColumn(selectedFields);
		setOpen(false);
		setSelectedFields([]);
		setUserUnderstandsRisk(false);
	};

	const handleCloseDialog = () => {
		setOpen(false);
		selectedFields.length > 0 && setSelectedFields([]);
		setUserUnderstandsRisk(false);
	};

	const renderChoices = () => {
		const choices = currentColumnNames.map((name) => {
			if (isBIDSNonMiscField(name)) {
				return (
					<MenuItem key={name} value={name}>
						{name}
					</MenuItem>
				);
			}
		});
		return choices;
	};

	return (
		<Dialog open={open} maxWidth="md">
			<DialogTitle>Remove a BIDS Field</DialogTitle>
			<DialogContent>
				<Stack rowGap={2}>
					<DialogContentText>
						Indicate the BIDS Field that you'd like to have removed from the spreadsheet.
					</DialogContentText>
					<Select
						fullWidth
						multiple
						value={selectedFields}
						onChange={handleSelectedFieldChange}
						MenuProps={{
							sx: { maxHeight: 300 },
						}}
					>
						{renderChoices()}
					</Select>
					<div>
						<div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
							<WarningIcon color="warning" />
							<Typography sx={{ color: "warning.main", fontWeight: 800 }}>WARNING:</Typography>
						</div>
						<DialogContentText>
							Removal of data carries risk of creating an unprocessable dataset if critical fields are removed. Note
							that the removal will not be permanent if the spreadsheet is not saved after the removal and can be
							recovered by requesting a spreadsheet refresh. Saving after a removal, however, will result in permanent
							changes until the Import Module is re-run or the column is added back in and all cells filled to their
							previous values.
						</DialogContentText>
					</div>
					<FormControlLabel
						label="I confirm that I am aware of how this action will affect my dataset based on the explanation above."
						labelPlacement="end"
						control={
							<Checkbox checked={userUnderstandsRisk} onChange={() => setUserUnderstandsRisk(!userUnderstandsRisk)} />
						}
					/>
				</Stack>
			</DialogContent>
			<DialogActions>
				<Button onClick={handleCloseDialog}>Cancel</Button>
				<Button disabled={selectedFields.length === 0 || !userUnderstandsRisk} onClick={handleRemoveColumn}>
					Remove Column from Spreadsheet
				</Button>
			</DialogActions>
		</Dialog>
	);
});
