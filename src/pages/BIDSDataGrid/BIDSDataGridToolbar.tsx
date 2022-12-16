import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CachedIcon from "@mui/icons-material/Cached";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { Button } from "@mui/material";
import {
	GridToolbarColumnsButton,
	GridToolbarContainer,
	GridToolbarDensitySelector,
	GridToolbarFilterButton,
} from "@mui/x-data-grid";
import { useAtomValue, useSetAtom } from "jotai";
import React, { memo } from "react";
import {
	atomBIDSAddColumnDialogOpen,
	atomBIDSRemoveColumnDialogOpen,
	atomBIDSStudyRootPath,
	atomSetFetchBIDSDataFrame,
} from "../../stores/BIDSDataGridStore";
import { BIDSDataGridErrorPopover } from "./BIDSDataGridErrorPopover";
import { BIDSSaveOverwriteSidecars } from "./BIDSSaveOverwriteSidecars";

export const BIDSToolBar = memo(() => {
	const studyRootPath = useAtomValue(atomBIDSStudyRootPath);
	const setOpenAddColumnDialog = useSetAtom(atomBIDSAddColumnDialogOpen);
	const setOpenRemoveColumnDialog = useSetAtom(atomBIDSRemoveColumnDialogOpen);
	const handleFetchDataFrame = useSetAtom(atomSetFetchBIDSDataFrame);
	return (
		<GridToolbarContainer sx={{ gap: 2 }}>
			<GridToolbarColumnsButton />
			<GridToolbarFilterButton {...({} as any)} />
			<GridToolbarDensitySelector />
			<Button
				size="small"
				variant="text"
				startIcon={<CachedIcon fontSize="large" />}
				onClick={() => handleFetchDataFrame(studyRootPath)}
			>
				Reload Data
			</Button>
			<Button
				size="small"
				variant="text"
				startIcon={<AddCircleOutlineIcon />}
				onClick={() => setOpenAddColumnDialog(true)}
			>
				Add Column
			</Button>
			<Button
				size="small"
				variant="text"
				startIcon={<RemoveCircleOutlineIcon />}
				onClick={() => setOpenRemoveColumnDialog(true)}
			>
				Remove Column
			</Button>
			<BIDSSaveOverwriteSidecars />
			<BIDSDataGridErrorPopover />
		</GridToolbarContainer>
	);
});
