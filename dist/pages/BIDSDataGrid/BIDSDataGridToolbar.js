import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CachedIcon from "@mui/icons-material/Cached";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { Button } from "@mui/material";
import { GridToolbarColumnsButton, GridToolbarContainer, GridToolbarDensitySelector, GridToolbarFilterButton, } from "@mui/x-data-grid";
import { useAtomValue, useSetAtom } from "jotai";
import React, { memo } from "react";
import { atomBIDSAddColumnDialogOpen, atomBIDSRemoveColumnDialogOpen, atomBIDSStudyRootPath, atomSetFetchBIDSDataFrame, } from "../../stores/BIDSDataGridStore";
import { BIDSDataGridErrorPopover, BIDSSaveOverwriteSidecars } from "./BIDSCustomActionComponents";
export const BIDSToolBar = memo(() => {
    const studyRootPath = useAtomValue(atomBIDSStudyRootPath);
    const setOpenAddColumnDialog = useSetAtom(atomBIDSAddColumnDialogOpen);
    const setOpenRemoveColumnDialog = useSetAtom(atomBIDSRemoveColumnDialogOpen);
    const handleFetchDataFrame = useSetAtom(atomSetFetchBIDSDataFrame);
    return (React.createElement(GridToolbarContainer, { sx: { gap: 2 } },
        React.createElement(GridToolbarColumnsButton, null),
        React.createElement(GridToolbarFilterButton, Object.assign({}, {})),
        React.createElement(GridToolbarDensitySelector, null),
        React.createElement(Button, { size: "small", variant: "text", startIcon: React.createElement(CachedIcon, { fontSize: "large" }), onClick: () => handleFetchDataFrame(studyRootPath) }, "Reload Data"),
        React.createElement(Button, { size: "small", variant: "text", startIcon: React.createElement(AddCircleOutlineIcon, null), onClick: () => setOpenAddColumnDialog(true) }, "Add Column"),
        React.createElement(Button, { size: "small", variant: "text", startIcon: React.createElement(RemoveCircleOutlineIcon, null), onClick: () => setOpenRemoveColumnDialog(true) }, "Remove Column"),
        React.createElement(BIDSSaveOverwriteSidecars, null),
        React.createElement(BIDSDataGridErrorPopover, null)));
});
//# sourceMappingURL=BIDSDataGridToolbar.js.map