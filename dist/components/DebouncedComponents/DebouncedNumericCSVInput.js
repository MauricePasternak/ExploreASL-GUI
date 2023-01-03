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
import { getNumbersFromDelimitedString } from "../../common/utils/stringFunctions";
import { DebouncedBaseInput } from "./DebouncedBaseInput";
import { DebouncedInput } from "./DebouncedInput";
export function DebouncedNumericCSVBaseInput(_a) {
    var { value, onChange, shouldSort = true, uniqueOnly = false } = _a, rest = __rest(_a, ["value", "onChange", "shouldSort", "uniqueOnly"]);
    const asStringCSVs = Array.isArray(value) ? value.join(", ") : value.toString();
    const handleChange = (event) => {
        const rawStringValue = event.target.value;
        const numericValues = getNumbersFromDelimitedString(rawStringValue, { sort: shouldSort, unique: uniqueOnly });
        onChange(numericValues);
    };
    console.log("🚀 ~ file: DebouncedNumericCSVBaseInput ~ asStringCSVs", asStringCSVs);
    return React.createElement(DebouncedBaseInput, Object.assign({}, rest, { value: asStringCSVs, onChange: handleChange }));
}
export function DebouncedNumericCSVInput(_a) {
    var { value, onChange, shouldSort = true, uniqueOnly = false } = _a, rest = __rest(_a, ["value", "onChange", "shouldSort", "uniqueOnly"]);
    const asStringCSVs = Array.isArray(value) ? value.join(", ") : value.toString();
    const handleChange = (rawStringValue) => {
        const numericValues = getNumbersFromDelimitedString(rawStringValue, { sort: shouldSort, unique: uniqueOnly });
        onChange(numericValues);
    };
    console.log("🚀 ~ file: DebouncedNumericCSVInput ~ asStringCSVs", asStringCSVs);
    return React.createElement(DebouncedInput, Object.assign({}, rest, { value: asStringCSVs, onChange: handleChange }));
}
//# sourceMappingURL=DebouncedNumericCSVInput.js.map