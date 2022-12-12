import SaveIcon from "@mui/icons-material/Save";
import Button from "@mui/material/Button";
import { useAtomValue, useSetAtom } from "jotai";
import { isPlainObject } from "lodash";
import React from "react";
import { atomBIDSRows } from "../../stores/BIDSDataGridStore";
import { atomBIDSDatagridSnackbar } from "../../stores/SnackbarStore";
import { BIDSRow } from "./BIDSColumnDefs";

export const BIDSSaveOverwriteSidecars = () => {
	const { api } = window;
	const BIDSRows = useAtomValue(atomBIDSRows);
	const setBIDSDatagridSnackbar = useSetAtom(atomBIDSDatagridSnackbar);

	async function handleWriteSingleRow(row: BIDSRow) {
		const { ID, Filename, Filepath, ...rest } = row;
		try {
			if (!(await api.path.filepathExists(Filepath)))
				return {
					success: false,
					error: `Filepath ending as ${Filename} does not exist in this study`,
				};

			// TODO: Add validation of the BIDS row here; Actually, this is up for discussion...maybe the user knows better?

			// We load in the old values and overwrite them with the new ones; this approach keeps the exisitng datagrid as
			// small as possible in order to accomodate larger datasets at the cost of longer export times.
			const origValues = await api.path.readJSON(Filepath);
			if (origValues == null || !isPlainObject(origValues) || Array.isArray(origValues)) {
				return {
					success: false,
					error:
						`Filepath ending as ${Filename} does not contain valid content for merging with the data grid's ` +
						` row values corresponding to it. Has this file been modified while the datagrid was open?`,
				};
			}

			const newValues = { ...origValues, ...rest };
			await api.path.writeJSON(Filepath, newValues, { spaces: 1 });
			return { success: true, error: null };
		} catch (error) {
			return {
				success: false,
				error: `Encountered an error while writing to file ending as ${Filename}: ${error.message}`,
			};
		}
	}

	async function handleWriteData() {
		try {
			const results = await Promise.all(BIDSRows.map(handleWriteSingleRow));
			const successfulResults = results.filter(({ success }) => success);
			const unsuccessfulResults = results.filter(({ success }) => !success);
			if (unsuccessfulResults.length > 0 && successfulResults.length === 0) {
				setBIDSDatagridSnackbar({
					severity: "error",
					message: [
						`Encountered ${unsuccessfulResults.length} error(s) while writing data to BIDS:`,
						" ",
						...unsuccessfulResults.map((res) => res.error),
					],
				});
			} else if (unsuccessfulResults.length > 0 && successfulResults.length > 0) {
				setBIDSDatagridSnackbar({
					severity: "warning",
					message: [
						`Encountered ${unsuccessfulResults.length} error(s) while writing data to BIDS:`,
						" ",
						...unsuccessfulResults.map((res) => res.error),
						" ",
						`However, the program did successfully write ${successfulResults.length} item(s) to BIDS files in the study.`,
						"If this outcome was anticipated, you can ignore this message.",
					],
				});
			} else {
				setBIDSDatagridSnackbar({
					severity: "success",
					title: "Data written successfully",
					message: `Successfully applied changes to all ${successfulResults.length} item(s) and wrote them to BIDS files in the study.`,
				});
			}
		} catch (error) {
			setBIDSDatagridSnackbar({
				severity: "error",
				title: "Error while applying changes",
				message: ["An error occurred while applying changes to BIDS files in the study."],
			});
		}
	}

	return (
		<Button size="small" variant="text" startIcon={<SaveIcon />} onClick={handleWriteData}>
			Save & Overwrite BIDS Sidecars
		</Button>
	);
};
