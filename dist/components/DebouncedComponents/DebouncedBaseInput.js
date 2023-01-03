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
import InputBase from "@mui/material/InputBase";
import { useCallback, useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
/**
 * Material UI InputBase component that debounces the onChange event
 */
export function DebouncedBaseInput(_a) {
    var { value, onChange, debounceTime = 500 } = _a, inputBaseProps = __rest(_a, ["value", "onChange", "debounceTime"]);
    // Component State
    const [innerValue, setInnerValue] = useState(value !== null && value !== void 0 ? value : "");
    // Keep in sync with parent components
    useEffect(() => {
        if (value === innerValue)
            return;
        setInnerValue(value);
    }, [value]);
    // Define an onChange handler that propagates the event to the parent component
    // then create the debounced version of that handler for the component
    const handleChange = useCallback((event) => {
        const newValue = event.target.value;
        // console.log("🚀 ~ file: DebouncedBaseInput.tsx:31 ~ handleChange ~ newValue", newValue);
        setInnerValue(newValue);
        onChange && debouncedHandleChange(event);
    }, [onChange]);
    const debouncedHandleChange = useDebouncedCallback(onChange, debounceTime);
    return React.createElement(InputBase, Object.assign({ sx: { paddingX: 1 }, fullWidth: true }, inputBaseProps, { value: innerValue, onChange: handleChange }));
}
//# sourceMappingURL=DebouncedBaseInput.js.map