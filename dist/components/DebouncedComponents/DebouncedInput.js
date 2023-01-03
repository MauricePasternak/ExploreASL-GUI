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
import ClearIcon from "@mui/icons-material/Clear";
import Box from "@mui/material/Box";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import React, { forwardRef, useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
/**
 * MUI TextField component meant to capture a string as its value and communicate it to a parent component
 * in a debounced manner.
 *
 * ### Mandatory Props:
 * - `value`: the value of the field
 * - `onChange`: a callback function to update the value of the field. The first argument is expected to be a string.
 *
 * ### Optional Props:
 * - `errorMessage`: error message for the text field
 * - `boxProps`: props to pass to the Box component that wraps the text field and error text
 * - `debounceTime`: debounce time for communicating changes to the parent component
 * All other props are passed to the underlying [TextField](https://mui.com/material-ui/api/text-field/) component.
 */
export const DebouncedInput = forwardRef((_a, ref) => {
    var { value, onChange, errorMessage, boxProps, debounceTime = 400, variant = "outlined" } = _a, textFieldProps = __rest(_a, ["value", "onChange", "errorMessage", "boxProps", "debounceTime", "variant"]);
    // Inner State
    const [innerValue, setInnerValue] = useState(value);
    // Debounce Callback
    const debouncedOnChange = useDebouncedCallback(onChange, debounceTime);
    // useEffect for keeping innerValue in sync with value
    useEffect(() => {
        if (value !== innerValue) {
            setInnerValue(value);
        }
    }, [value]);
    /** Handler for changes to the value; updates the inner value and forwards the new value via provided onChange */
    const handleChange = (newValue) => {
        setInnerValue(newValue);
        debouncedOnChange(newValue);
    };
    // Misc
    const componentClassName = textFieldProps.className
        ? `${textFieldProps.className} "DebouncedInput__TextField"`
        : "DebouncedInput__TextField";
    return (React.createElement(Box, Object.assign({ className: "DebouncedInput__Box" }, boxProps),
        React.createElement(TextField, Object.assign({ className: componentClassName, variant: variant, fullWidth: true, inputRef: ref, InputProps: {
                className: "DebouncedInput__Input",
                endAdornment: (React.createElement(IconButton, { className: "DebouncedInput__IconButton", disabled: textFieldProps.disabled, onClick: () => innerValue && handleChange(""), color: textFieldProps.error ? "error" : "inherit" },
                    React.createElement(ClearIcon, { className: "DebouncedInput__ClearIcon" }))),
            } }, textFieldProps, { onChange: (e) => handleChange(e.target.value), value: innerValue })),
        (textFieldProps === null || textFieldProps === void 0 ? void 0 : textFieldProps.error) && (React.createElement(FormHelperText, { className: "DebouncedInput__ErrorText", variant: variant, error: true }, errorMessage))));
});
//# sourceMappingURL=DebouncedInput.js.map