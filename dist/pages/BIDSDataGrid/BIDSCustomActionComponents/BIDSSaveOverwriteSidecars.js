var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import SaveIcon from "@mui/icons-material/Save";
import Button from "@mui/material/Button";
import { useAtomValue, useSetAtom } from "jotai";
import { isPlainObject } from "lodash";
import React from "react";
import { atomBIDSColumnsToPermanentDelete, atomBIDSRows } from "../../../stores/BIDSDataGridStore";
import { atomBIDSDatagridSnackbar } from "../../../stores/SnackbarStore";
import { pickBy as lodashPickBy } from "lodash";
export const BIDSSaveOverwriteSidecars = () => {
    const { api } = window;
    const BIDSRows = useAtomValue(atomBIDSRows);
    const setBIDSDatagridSnackbar = useSetAtom(atomBIDSDatagridSnackbar);
    const BIDSColumnsToPermaDelete = useAtomValue(atomBIDSColumnsToPermanentDelete);
    const BIDSSetColsToPermaDelete = new Set(BIDSColumnsToPermaDelete); // We use a set for faster lookup
    function handleWriteSingleRow(row) {
        return __awaiter(this, void 0, void 0, function* () {
            const { ID, Filename, Filepath } = row, rest = __rest(row, ["ID", "Filename", "Filepath"]);
            try {
                if (!(yield api.path.filepathExists(Filepath)))
                    return {
                        success: false,
                        error: `Filepath ending as ${Filename} does not exist in this study`,
                    };
                // We load in the old values and overwrite them with the new ones; this approach keeps the exisitng datagrid as
                // small as possible in order to accomodate larger datasets at the cost of longer export times.
                const origValues = yield api.path.readJSON(Filepath);
                if (origValues == null || !isPlainObject(origValues) || Array.isArray(origValues)) {
                    return {
                        success: false,
                        error: `Filepath ending as ${Filename} does not contain valid content for merging with the data grid's ` +
                            ` row values corresponding to it. Has this file been modified while the datagrid was open?`,
                    };
                }
                // We remove any keys that are in the set of columns to permanently delete
                const origWithoutPermaDelete = lodashPickBy(origValues, (_, key) => !BIDSSetColsToPermaDelete.has(key));
                const newValues = Object.assign(Object.assign({}, origWithoutPermaDelete), rest);
                yield api.path.writeJSON(Filepath, newValues, { spaces: 1 });
                return { success: true, error: null };
            }
            catch (error) {
                return {
                    success: false,
                    error: `Encountered an error while writing to file ending as ${Filename}: ${error.message}`,
                };
            }
        });
    }
    function handleWriteData() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const results = yield Promise.all(BIDSRows.map(handleWriteSingleRow));
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
                }
                else if (unsuccessfulResults.length > 0 && successfulResults.length > 0) {
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
                }
                else {
                    setBIDSDatagridSnackbar({
                        severity: "success",
                        title: "Data written successfully",
                        message: `Successfully applied changes to all ${successfulResults.length} item(s) and wrote them to BIDS files in the study.`,
                    });
                }
            }
            catch (error) {
                setBIDSDatagridSnackbar({
                    severity: "error",
                    title: "Error while applying changes",
                    message: ["An error occurred while applying changes to BIDS files in the study."],
                });
            }
        });
    }
    return (React.createElement(Button, { size: "small", variant: "text", startIcon: React.createElement(SaveIcon, null), onClick: handleWriteData }, "Save & Overwrite BIDS Sidecars"));
};
//# sourceMappingURL=BIDSSaveOverwriteSidecars.js.map