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
import React from "react";
import { filter as lodashFilter, isPlainObject as lodashIsPlainObject, pickBy as lodashPickBy, sortBy as lodashSortBy, } from "lodash";
import { SchemaMin_BIDS, Schema_BIDS } from "../../common/schemas/BIDSSchema";
import { YupValidate } from "../../common/utils/formFunctions";
import { isBIDSField, isBIDSNonMiscField } from "./BIDSColumnDefs";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
const { api } = window;
/**
 * Parses an object into a semi-validated BIDSRow.
 * At minimum, it is guarenteed to have keys are BIDS fields and values of the correct type.
 * What is **not** guaranteed is that all the values are 100% valid BIDS values (i.e. interdependent fields).
 *
 * @param dirtyRow An item to be ascertained as a BIDSRow
 * @param rowIdx The index of the row for the ID column
 * @param filepath The filepath from the JSON file that the row came from
 * @param filename The basename of the JSON file that the row came from
 * @returns a {@link ParseDirtyResult} object that contains the cleaned row, the columns, and the result of the parsing
 */
function _parseDirtyBIDSRow(dirtyRow, rowIdx, filepath, filename) {
    return __awaiter(this, void 0, void 0, function* () {
        // Early exit if the row is not an object
        if (!dirtyRow || !lodashIsPlainObject(dirtyRow))
            return { cleanedRow: null, cols: null, errors: null, filename, result: "invalidJSON" };
        const cols = ["ID", "Filepath", "Filename"];
        const { values: validatedRow, errors } = yield YupValidate(SchemaMin_BIDS, dirtyRow);
        // If there are errors
        if (Object.keys(errors).length > 0) {
            return { cleanedRow: null, cols: null, errors, filename, result: "invalidBIDS" };
        }
        // At this point, we know that of the BIDS fields that are in there, they are valid; we can pick them out
        const cleanedRow = lodashPickBy(validatedRow, (_, key) => {
            if (isBIDSNonMiscField(key)) {
                cols.push(key); // We update the columns as a side effect
                return true;
            }
            return false;
        });
        const newBIDSRow = Object.assign({ ID: rowIdx, Filename: filename, Filepath: filepath }, cleanedRow);
        return { cleanedRow: newBIDSRow, cols, filename, errors: null, result: "success" };
    });
}
function _parseSingleBIDSJSONSidecar(jsonPath, basename, jsonIndex) {
    return __awaiter(this, void 0, void 0, function* () {
        const { error, payload } = yield api.path.readJSONSafe(jsonPath);
        if (error || !payload || Array.isArray(payload) || !lodashIsPlainObject(payload))
            return {
                cleanedRow: null,
                cols: null,
                errors: null,
                filename: basename,
                result: "invalidJSON",
            };
        return _parseDirtyBIDSRow(payload, jsonIndex, jsonPath, basename);
    });
}
/**
 * Given a study root path, fetches the BIDS data from the rawdata folder
 * @param studyRootPath The root path of the study
 *
 * @returns a {@link FetchBIDSDataResult} object with fields:
 * - `BIDSRows`: the rows of the BIDS data that passed minimal validation
 * - `BIDSColumns`: the columns of the BIDS data that passed minimal validation
 * - `invalidItems`: an array of length-2 tuples of the filename and either a string error message or a {@link FieldError} object
 */
export function fetchBIDSData(studyRootPath) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`Fetching BIDS data from ${studyRootPath}...`);
        // Get the ASL json files
        let jsonPaths = yield api.path.glob(`${studyRootPath}/rawdata`, "/**/*asl.json", { onlyFiles: true });
        if (jsonPaths.length === 0)
            return null;
        jsonPaths = lodashSortBy(jsonPaths, "path"); // Globing order not guaranteed, so sort by path
        // Parse the JSON files
        const parsedRows = yield Promise.all(jsonPaths.map((jsonPath, jsonIndex) => _parseSingleBIDSJSONSidecar(jsonPath.path, jsonPath.basename, jsonIndex)));
        // Extract the valid results first; if there are none, return null
        const validResults = lodashFilter(parsedRows, (row) => row.result === "success");
        if (validResults.length === 0)
            return null;
        // Extract the valid rows and columns from the valid results
        const validRows = validResults.map((row) => row.cleanedRow);
        const validColumns = new Set(validResults.map((row) => row.cols).flat(1));
        // For possible future feedback, extract the invalid files
        const invalidItems = [];
        for (const { filename, result, errors } of parsedRows) {
            if (result === "success")
                continue;
            if (result === "invalidJSON") {
                invalidItems.push([filename, "Invalid JSON syntax (i.e. missing comma, unquoted key, etc.)"]);
            }
            else {
                invalidItems.push([filename, errors]);
            }
        }
        return { BIDSRows: validRows, BIDSColumns: validColumns, invalidItems };
    });
}
export function parseInvalidFetchItems(invalidItems) {
    return (React.createElement(Stack, { gap: 1 },
        React.createElement(Typography, null, "The following ASL BIDS sidecar files (end in \"asl.json\") found in the rawdata folder could not be loaded into the spreadsheet:"),
        React.createElement(Divider, { sx: { borderColor: "white" } }),
        React.createElement(List, null, invalidItems.map(([filename, error]) => {
            if (typeof error === "string") {
                return (React.createElement(ListItem, { sx: { borderBottom: "1px solid white" }, key: filename },
                    React.createElement(ListItemText, { primary: filename, secondary: error, secondaryTypographyProps: { color: "error.contrastText" } })));
            }
            else {
                return (React.createElement(ListItem, { sx: { borderBottom: "1px solid white" }, key: filename },
                    React.createElement(ListItemText, { sx: { alignSelf: "start" }, primary: filename, secondary: "Had one or more invalid BIDS fields (shown on the right)", secondaryTypographyProps: { color: "error.contrastText" } }),
                    React.createElement(List, null, Object.entries(error).map(([fieldName, fieldError]) => {
                        return (React.createElement(ListItem, { key: fieldName },
                            React.createElement(ListItemText, { primary: fieldName, secondary: fieldError.message, secondaryTypographyProps: { color: "error.contrastText" } })));
                    })),
                    React.createElement(Divider, { sx: { borderColor: "white" } })));
            }
        }))));
}
export function updateAddBIDSErrorsFromRowError(currentBIDSErrors, newErrors, ID) {
    for (const [fieldName, error] of Object.entries(newErrors)) {
        if (!isBIDSField(fieldName))
            continue;
        // If the field already exists in the currentBIDSErrors, then we can just push the new error
        if (fieldName in currentBIDSErrors) {
            currentBIDSErrors[fieldName][ID] = error.message;
        }
        // Otherwise, we need to create a new entry in the currentBIDSErrors
        else {
            currentBIDSErrors[fieldName] = {
                [ID]: error.message,
            };
        }
    }
    return currentBIDSErrors;
}
/**
 * Validates a collection of {@link BIDSRow} objects using the strict validation pipeline. This function is used
 * when all the rows need to be validated at once (i.e. fetching the data, adding/removing a column, etc.)
 * @param BIDSRows The {@link BIDSRow} array to validate.
 * @returns A Promise resolving into a {@link BIDSErrorMapping} object with the errors for each field.
 */
export function strictValidateAllBIDSRows(BIDSRows) {
    return __awaiter(this, void 0, void 0, function* () {
        // Put the new fetched data through through the strict validation pipeline that also tests for BIDS compliance
        const validationResults = yield Promise.all(BIDSRows.map((row) => __awaiter(this, void 0, void 0, function* () {
            const { ID } = row, rest = __rest(row, ["ID"]);
            // console.log("🚀 ~ file: BIDSDataGridStore.ts:132 ~ atomSetFetchBIDSDataFrame ~ row", row);
            const validation = yield YupValidate(Schema_BIDS, rest);
            // console.log("🚀 ~ file: BIDSDataGridStore.ts:134 ~ atomSetFetchBIDSDataFrame ~ validation", validation);
            return { ID, validation };
        })));
        // Collect the errors into a BIDSErrorMapping
        const validationErrors = validationResults.reduce((acc, { ID, validation }) => {
            const { errors } = validation;
            if (Object.keys(errors).length === 0)
                return acc; // Early return if there are no errors
            for (const [fieldName, fieldError] of Object.entries(errors)) {
                if (!isBIDSField(fieldName))
                    continue;
                // If the field already exists in the currentBIDSErrors, then we can just push the new error
                if (fieldName in acc) {
                    acc[fieldName][ID] = fieldError.message;
                }
                // Otherwise, we need to create a new entry in the currentBIDSErrors
                else {
                    acc[fieldName] = {
                        [ID]: fieldError.message,
                    };
                }
            }
            return acc;
        }, {});
        return validationErrors;
    });
}
//# sourceMappingURL=BIDSDataGridFunctions.js.map