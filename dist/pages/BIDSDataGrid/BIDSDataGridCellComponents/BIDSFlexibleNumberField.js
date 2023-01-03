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
import { useGridApiContext } from "@mui/x-data-grid";
import { isUndefined as lodashIsUndefined, range as lodashRange } from "lodash";
import { DebouncedBaseInput } from "../../../components/DebouncedComponents";
import { MultiNumericInput } from "./MultiNumericInput";
export function switchBIDSNumericType(currentValue, shouldSwitchToMulti, numberFieldsWhenMulti, defaultValue) {
    // Must handle 3 types: number | number[] | undefined
    if (lodashIsUndefined(currentValue)) {
        currentValue = shouldSwitchToMulti ? lodashRange(numberFieldsWhenMulti).map(() => defaultValue) : defaultValue;
    }
    // Value is not undefined; therefore either number or number[]; must handle cases where a switch is necessary
    else {
        // Case 1: switch from single to multi; pad with default values
        if (shouldSwitchToMulti && !Array.isArray(currentValue)) {
            const foo = currentValue;
            currentValue = [foo, ...lodashRange(numberFieldsWhenMulti - 1).map(() => defaultValue)];
        }
        // Case 2: switch from multi to single; take first value
        else if (!shouldSwitchToMulti && Array.isArray(currentValue)) {
            currentValue = currentValue[0];
        }
    }
    return currentValue;
}
export function BIDSFlexibleNumberField(_a) {
    var { shouldRenderMultiNumeric, numberFieldsWhenMulti, defaultValue, min, max, step } = _a, params = __rest(_a, ["shouldRenderMultiNumeric", "numberFieldsWhenMulti", "defaultValue", "min", "max", "step"]);
    const apiRef = useGridApiContext();
    const shouldRenderMulti = shouldRenderMultiNumeric(params);
    console.log("🚀 ~ file: BIDSFlexibleNumberField.tsx:46 ~ shouldRenderMulti", shouldRenderMulti);
    const currentValue = switchBIDSNumericType(params.value, shouldRenderMulti, numberFieldsWhenMulti, defaultValue);
    console.log("🚀 ~ file: BIDSFlexibleNumberField.tsx:47 ~ currentValue", currentValue);
    const handleMultiNumericChange = (newValue) => {
        console.log("🚀 ~ file: BIDSFlexibleNumberField.tsx:52 ~ handleMultiNumericChange ~ newValue", newValue);
        apiRef.current.setEditCellValue({ id: params.id, field: params.field, value: newValue, debounceMs: 250 });
    };
    const handleSingleNumericChange = (newValue) => {
        console.log("🚀 ~ file: BIDSFlexibleNumberField.tsx:56 ~ handleSingleNumericChange ~ newValue", newValue);
        apiRef.current.setEditCellValue({ id: params.id, field: params.field, value: newValue });
    };
    return Array.isArray(currentValue) ? (React.createElement(MultiNumericInput, { inputProps: { min: min, max: max, step: step }, value: currentValue, onChange: handleMultiNumericChange, debounceTime: 0 })) : (React.createElement(DebouncedBaseInput, { fullWidth: true, type: "number", value: currentValue, inputProps: { min: min, max: max, step: step }, onChange: (e) => handleSingleNumericChange(Number(e.target.value)) }));
}
//# sourceMappingURL=BIDSFlexibleNumberField.js.map