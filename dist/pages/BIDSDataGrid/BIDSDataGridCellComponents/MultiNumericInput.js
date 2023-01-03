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
import Box from "@mui/material/Box";
import React from "react";
import { DebouncedBaseInput, } from "../../../components/DebouncedComponents";
export function MultiNumericInput(_a) {
    var { value, onChange, boxProps } = _a, inputProps = __rest(_a, ["value", "onChange", "boxProps"]);
    const handleChange = (event, index) => {
        const newValue = value.map((v, i) => (i === index ? Number(event.target.value) : v));
        onChange(newValue);
    };
    return (React.createElement(Box, Object.assign({ display: "flex" }, boxProps), value.map((v, i) => (React.createElement(DebouncedBaseInput, Object.assign({ key: `DebouncedBaseInput_${i}`, className: `DebouncedBaseInput`, type: "number", value: v, onChange: (event) => handleChange(event, i) }, inputProps))))));
}
//# sourceMappingURL=MultiNumericInput.js.map