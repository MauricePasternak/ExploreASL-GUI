var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import { DataGrid } from "@mui/x-data-grid";
import { useAtomValue, useSetAtom } from "jotai";
import React, { memo } from "react";
import { Schema_BIDS } from "../../common/schemas/BIDSSchema";
import { YupValidate } from "../../common/utils/formFunctions";
import { atomBIDSErrors, atomBIDSRows, atomGetBIDSColumnConfigs, atomSetBIDSUpdateDataFrameFromCell, atomSetBIDSUpdateDataFrameFromRow, atomSetBIDSUpdateErrors, } from "../../stores/BIDSDataGridStore";
import { isBIDSField } from "./BIDSColumnDefs";
import { BIDSToolBar } from "./BIDSDataGridToolbar";
export const BIDSDataGrid = memo(() => {
    // State Atoms
    const bidsRows = useAtomValue(atomBIDSRows);
    const bidsColumnConfigs = useAtomValue(atomGetBIDSColumnConfigs);
    const bidsErrorMapping = useAtomValue(atomBIDSErrors);
    // Setter Atoms
    const handleEditFromRow = useSetAtom(atomSetBIDSUpdateDataFrameFromRow);
    const handleEditFromCell = useSetAtom(atomSetBIDSUpdateDataFrameFromCell);
    const handleUpdateBIDSErrors = useSetAtom(atomSetBIDSUpdateErrors);
    return bidsRows.length > 0 ? (React.createElement(Box, { sx: {
            height: "calc(100vh - 320px)",
            width: "100%",
            "& .BIDSError": {
                backgroundColor: "error.main",
                color: "error.contrastText",
            },
        } },
        React.createElement(DataGrid, { columns: bidsColumnConfigs, rows: bidsRows, getRowId: (row) => row.ID, showCellRightBorder: true, components: {
                Toolbar: BIDSToolBar,
            }, experimentalFeatures: { newEditingApi: true }, getCellClassName: (params) => {
                const { field, row: { ID }, } = params;
                if (field in bidsErrorMapping && ID in bidsErrorMapping[field]) {
                    return "BIDSError";
                }
                return "";
            }, onCellKeyDown: (params, event) => __awaiter(void 0, void 0, void 0, function* () {
                // console.log("🚀 ~ onCellKeyDown ~ event", event);
                // For editable cells, pressing the delete key should force the cell to take on an undefined value
                if (event.key === "Delete" && params.isEditable && isBIDSField(params.field)) {
                    // deletingColumn.current = params.field;
                    event.defaultMuiPrevented = true;
                    event.preventDefault();
                    // * Since this won't trigger processRowUpdate, we need to do validation and updating of errors here
                    const newRow = Object.assign(Object.assign({}, params.row), { [params.field]: undefined });
                    const { errors } = yield YupValidate(Schema_BIDS, newRow);
                    console.log("🚀 ~ onCellKeyDown ~ errors", errors);
                    // Communicate the changes to external state
                    handleEditFromCell({ ID: params.row.ID, colName: params.field, value: undefined });
                    handleUpdateBIDSErrors({ ID: params.row.ID, errors, bidsRow: newRow });
                }
            }), editMode: "cell", rowsPerPageOptions: [10, 20, 100], onCellFocusOut: (params, event, details) => {
                console.log("🚀 ~ onCellFocusOut ~ params", params);
            }, onCellEditStart: (params, event, details) => {
                console.log("🚀 ~ onCellEditStart ~ params", params);
            }, processRowUpdate: (newRow, oldRow) => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    // This function is called after other events like onCellKeyDown, onCellFocusOut have occurred
                    // * Validate the new row
                    console.log("🚀 ~ processRowUpdate ~ newRow", newRow);
                    const { errors } = yield YupValidate(Schema_BIDS, newRow);
                    console.log("🚀 ~ processRowUpdate ~ errors", errors);
                    // Communicate the changes to external state to keep the data in sync
                    handleEditFromRow(newRow);
                    handleUpdateBIDSErrors({ ID: newRow.ID, errors, bidsRow: newRow });
                    // * This function must return the new row for the grid to properly lose focus
                    // * If you don't return a new row, the grid will not lose focus
                    return newRow;
                }
                catch (error) {
                    console.error("🚀 ~ processRowUpdate trycatch received an Error ~ error", error);
                    return newRow;
                }
            }) }))) : (React.createElement(Skeleton, { variant: "rectangular", height: "calc(100vh - 300px)" }));
});
//# sourceMappingURL=BIDSDataGrid.js.map