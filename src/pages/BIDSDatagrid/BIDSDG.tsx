import { Skeleton } from "@mui/material";
import Box from "@mui/material/Box";
import { styled } from "@mui/material/styles";
import { DataFrame } from "data-forge";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useEffect, useRef } from "react";
import DataGrid, { CalculatedColumn, RowsChangeData } from "react-data-grid";
import { BIDSFieldNames } from "../../common/schemas/BIDSDataGridSchemas/BIDSDatagridConfigurationSchemas";
import { BIDSColumnName, BIDSFieldNamesType, BIDSRow } from "../../common/types/BIDSDatagridTypes";
import {
	atomBIDSDataframe,
	atomBIDSStudyRootPath,
	atomDataframeColumns,
	atomDeleteDataframeCell,
	atomFetchDataframe,
	atomRDGColumnConfigs,
} from "../../stores/BIDSDatagridStore";

const RGDContainer = styled(Box)(({ theme }) => ({
	"& .rdg": {
		backgroundColor: theme.palette.mode === "dark" ? "#272727" : "#f5f5f5",
		height: "100%",
		overflow: "auto",
	},
	"& .rdg-cell": {
		backgroundColor: theme.palette.mode === "dark" ? "#121212" : theme.palette.background.default,
		color: theme.palette.text.primary,
		fontSize: theme.typography.htmlFontSize,
		borderRadius: 0,
		paddingInline: 0,
	},
	"& .rdg-header-row > *": {
		backgroundColor: theme.palette.primary.main,
		color: theme.palette.mode === "dark" ? "#333" : "white",
		display: "flex",
		minWidth: "200px",
	},
}));

function BIDSDG() {
	const { api } = window;
	const StudyRootPath = useAtomValue(atomBIDSStudyRootPath);
	const [dataframe, setDataframe] = useAtom(atomBIDSDataframe);
	const fetchDataFrame = useSetAtom(atomFetchDataframe);
	const deleteDataFrameCell = useSetAtom(atomDeleteDataframeCell);
	const RDGColumnConfig = useAtomValue(atomRDGColumnConfigs);
	const selectedCell = useRef<{ selectedRow: number; selectedColumn: BIDSColumnName }>(null); // Keep track for deleting cells
	const deleteIsRegistered = useRef(false);
	console.log("🚀 ~ file: BIDSDG.tsx:44 ~ BIDSDG ~ dataframe", dataframe);
	console.log("🚀 ~ file: BIDSDG.tsx:47 ~ BIDSDG ~ RDGColumnConfig", RDGColumnConfig);

	/**
	 * useEffect for registering IPC events for the BIDS datagrid. At the current time, events include:
	 * - `BIDSDataGridDeleteChannel` - for deleting the currently-selected cell when the delete key is pressed.
	 */
	useEffect(() => {
		api.on(`BIDSDataGridDeleteChannel:shortcutTriggered`, () => {
			// Sanity check
			if (selectedCell.current === null) return;

			// We need to use the setter atom instead of `setDataframe` due to `dataframe` not being properly updated in this
			// event callback. The setter atom's "get" callback properly fetches to updated dataframe each time.
			const { selectedRow, selectedColumn } = selectedCell.current;
			deleteDataFrameCell({ cellRow: selectedRow, cellCol: selectedColumn });
		});

		// Cleanup
		return () => {
			api.removeAllListeners(`BIDSDataGridDeleteChannel:shortcutTriggered`);
		};
	}, []);

	/**
	 * We only want the delete shortcut to be registered when the mouse is actively within the datagrid.
	 * Otherwise, this application will prevent its proper functionality in the OS.
	 */
	const handleMouseEnter = async (e: React.MouseEvent<HTMLDivElement>) => {
		e.stopPropagation();
		!deleteIsRegistered.current && (await api.invoke("Shortcut:Register", "BIDSDataGridDeleteChannel", "Delete"));
		deleteIsRegistered.current = true;
	};

	/**
	 * We want to unregister the delete shortcut when the mouse leaves the datagrid so that the OS can properly react to
	 * delete key events.
	 */
	const handleMouseLeave = async (e: React.MouseEvent<HTMLDivElement>) => {
		e.stopPropagation();
		deleteIsRegistered.current && (await api.invoke("Shortcut:Unregister", "Delete"));
		deleteIsRegistered.current = false;
	};

	/** useEffect for loading the dataframe from the BIDS json files whenever StudyRootPath changes. */
	useEffect(() => {
		const fetchData = async () => {
			console.log(`Fetching dataframe for ${StudyRootPath}`);
			await fetchDataFrame(StudyRootPath);
			selectedCell.current = null;
		};
		fetchData();
	}, [StudyRootPath]);

	const handleRowsChange = (rows: BIDSRow[], data: RowsChangeData<BIDSRow, unknown>) => {
		// console.log(`handleRowsChange:`, rows, data, dataframe.count());
		setDataframe(new DataFrame(rows));
	};

	const handleRowClick = (row: BIDSRow, column: CalculatedColumn<BIDSRow, unknown>) => {
		if (column.key === "ID" || column.key === "Filename" || column.key === "File") return; // No editing key columns
		// console.log(`handleRowClick:`, row, column);
		selectedCell.current = { selectedRow: row.ID, selectedColumn: column.key as BIDSColumnName };
	};

	return dataframe.count() > 0 ? (
		<RGDContainer
			className="RGDMainContainer"
			height="calc(100vh - 370px)"
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			<DataGrid
				columns={RDGColumnConfig}
				rows={dataframe.toArray()}
				rowHeight={56}
				rowKeyGetter={(i) => i.ID}
				onRowsChange={handleRowsChange}
				onRowClick={handleRowClick}
			/>
		</RGDContainer>
	) : (
		<Skeleton variant="rectangular" height="calc(100vh - 400px)" />
	);
}

export default BIDSDG;
