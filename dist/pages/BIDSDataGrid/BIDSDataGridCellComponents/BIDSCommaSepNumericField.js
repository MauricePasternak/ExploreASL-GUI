import InputBase from "@mui/material/InputBase";
import { useGridApiContext } from "@mui/x-data-grid";
import { sortBy as lodashSortBy } from "lodash";
import React, { useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { getNumbersFromDelimitedString } from "../../../common/utils/stringFunctions";
/**
 * BIDS DataGrid cell component meant to represent either a single number or an array of numbers.
 *
 * Properties include:
 * - `params`: The GridRenderCellParams object passed to the cell component
 * - `defaultValue`: The default value to use if the value is empty. Defaults to `undefined`.
 * - `emptyValueStrategy`: How to handle an empty string value:
 * 	- `toUndefined`: Set the value to undefined
 * 	- `toZero`: Set the value to 0
 * 	- `toEmptyArray`: Set the value to an empty array
 * 	- `toDefaultValue`: Set the value to the `defaultValue` property
 * 		Defaults to `toUndefined`
 * - `coerceSingleValueToNumber`: If the length of the numbers array parsed from text is of length 1,
 * 		should it be coerced to a number type? Defaults to `true`.
 * - `shouldSortValues`: For a numeric array outcome, should the values be sorted? Defaults to `true`.
 * - `uniqueOnly`: For a numeric array outcome, should the values be unique? Defaults to `false`.
 */
export function BIDSCommaSepNumericField({ params, defaultValue, emptyValueStrategy = "toUndefined", coerceSingleValueToNumber = true, shouldSortValues = true, uniqueOnly = false, }) {
    const { id, field, value } = params;
    const [innerValue, setInnerValue] = useState(value !== null && value !== void 0 ? value : "");
    const apiRef = useGridApiContext();
    console.log(`BIDSCommaSepNumericField of row ${id} in field ${field} is rendering with value: ${value}`);
    const handleDebouncedChange = useDebouncedCallback((strValue) => {
        const newNumericValue = getNumbersFromDelimitedString(strValue, { sort: shouldSortValues, unique: uniqueOnly });
        // We must be able to handle a blank value accordingly
        if (newNumericValue.length === 0) {
            switch (emptyValueStrategy) {
                case "toEmptyArray":
                    apiRef.current.setEditCellValue({ id, field, value: newNumericValue });
                    return;
                case "toUndefined":
                    apiRef.current.setEditCellValue({ id, field, value: undefined });
                    return;
                case "toZero":
                    apiRef.current.setEditCellValue({ id, field, value: 0 });
                    return;
                case "toDefaultValue":
                    apiRef.current.setEditCellValue({ id, field, value: defaultValue });
                default:
                    return;
            }
        }
        // Otherwise, handle the numeric array
        if (coerceSingleValueToNumber && newNumericValue.length === 1) {
            console.log("🚀 ~ file: BIDSCommaSepNumericField.tsx:14 ~ handleChange ~  communicating value", newNumericValue[0]);
            apiRef.current.setEditCellValue({ id, field, value: newNumericValue[0] });
        }
        else {
            console.log("🚀 ~ file: BIDSCommaSepNumericField.tsx:14 ~ handleChange ~  communicating value", newNumericValue);
            apiRef.current.setEditCellValue({
                id,
                field,
                value: shouldSortValues ? lodashSortBy(newNumericValue) : newNumericValue,
            });
        }
    }, 200);
    const handleChange = (event) => {
        const strValue = event.target.value;
        setInnerValue(strValue);
        handleDebouncedChange(strValue);
    };
    return React.createElement(InputBase, { fullWidth: true, value: innerValue, onChange: handleChange });
}
//# sourceMappingURL=BIDSCommaSepNumericField.js.map