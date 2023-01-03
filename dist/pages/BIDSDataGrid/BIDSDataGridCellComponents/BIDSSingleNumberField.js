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
import InputBase from "@mui/material/InputBase";
import { useGridApiContext } from "@mui/x-data-grid";
import { isUndefined as lodashIsUndefined } from "lodash";
import React, { useEffect } from "react";
export function BIDSSingleNumberField(_a) {
    var { defaultValue, params } = _a, inputProps = __rest(_a, ["defaultValue", "params"]);
    const { value, field, id } = params;
    const apiRef = useGridApiContext();
    const [innerValue, setInnerValue] = React.useState(value);
    const handleChange = (event) => {
        const newValue = Number(event.target.value);
        apiRef.current.setEditCellValue({ id, field, value: newValue, debounceMs: 2000 });
        setInnerValue(newValue);
    };
    // ^ This useEffect will run when the cell is focused; it will set the value to the default value if the value is
    // ^ undefined
    useEffect(() => {
        if (lodashIsUndefined(value)) {
            console.log("🚀 ~ file: BIDSSingleNumberField.tsx:31 ~ useEffect ~ value", value);
            setInnerValue(defaultValue);
            apiRef.current.setEditCellValue({ id, field, value: defaultValue, debounceMs: 2000 });
        }
    }, [value]);
    // * Hack to get around the possibility that the value is undefined due to a Delete keypress
    if (lodashIsUndefined(innerValue)) {
        return (React.createElement(InputBase, Object.assign({ fullWidth: true, sx: { paddingX: 1 } }, inputProps, { value: defaultValue, onChange: handleChange, type: "number" })));
    }
    else {
        return (React.createElement(InputBase, Object.assign({ fullWidth: true, sx: { paddingX: 1 } }, inputProps, { value: innerValue, onChange: handleChange, type: "number" })));
    }
}
//# sourceMappingURL=BIDSSingleNumberField.js.map