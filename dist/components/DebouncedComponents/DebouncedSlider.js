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
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import FastIsEqual from "fast-deep-equal";
import React, { useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
/**
 * MUI Slider component meant to capture a number or array of numbers and communicate it to a parent component
 * in a debounced manner.
 *
 * ### Mandatory Props
 * - `value`: The value of the slider as a number or array of numbers.
 * - `onChange`: The function to call when the slider value changes.
 * The first argument is expected to be a number or array of numbers.
 *
 * ### Optional Props
 * - `error`: Whether or not the slider is in an error state.
 * - `errorMessage`: Error message for the slider when it is in an error state.
 * - `helperText`: Helper text for the slider.
 * - `label`: Label for the slider.
 * - `debounceTime`: Debounce time for communicating changes to the parent component.
 * - `renderTextfields`: Whether or not to render adjacent text fields for the slider value.
 * - `textFieldProps`: Props to pass to the adjacent text fields if they are rendered.
 * - `formControlProps`: Props to pass to the FormControl component that wraps the slider and text fields.
 */
export const DebouncedSlider = (_a) => {
    var { value, onChange, error, errorMessage, helperText, label, renderTextfields = true, debounceTime = 500, textFieldProps, formControlProps } = _a, sliderProps = __rest(_a, ["value", "onChange", "error", "errorMessage", "helperText", "label", "renderTextfields", "debounceTime", "textFieldProps", "formControlProps"]);
    // Inner State
    const [innerValue, setInnerValue] = useState(value);
    // Debounce Callback
    const debouncedOnChange = useDebouncedCallback(onChange, debounceTime);
    // Misc
    const componentClassname = sliderProps.className
        ? `${sliderProps.className} DebouncedSlider__Slider`
        : "DebouncedSlider__Slider";
    // useEffect for keeping innerValue in sync with value
    // must use fast-deep-equal in case value is an array
    useEffect(() => {
        if (!FastIsEqual(value, innerValue))
            setInnerValue(value);
    }, [value]);
    /** Handler for changes to the value; updates the inner value and forwards the new value via provided onChange */
    const handleChange = (value) => {
        setInnerValue(value);
        debouncedOnChange(value);
    };
    const handleRenderTextfields = () => {
        var _a, _b, _c;
        return Array.isArray(innerValue) ? (
        // If innerValue is an array of numbers
        innerValue.map((val, idx) => {
            var _a, _b, _c;
            return (React.createElement(TextField, Object.assign({ key: `DebouncedSlider__TextField__${idx}`, type: "number", className: "DebouncedSlider__TextField", variant: textFieldProps === null || textFieldProps === void 0 ? void 0 : textFieldProps.variant }, textFieldProps, { onChange: (textEvent) => {
                    handleChange(innerValue.map((v, i) => (i === idx ? Number(textEvent.target.value) : v)));
                }, error: error, value: val, inputProps: Object.assign(Object.assign({}, textFieldProps === null || textFieldProps === void 0 ? void 0 : textFieldProps.inputProps), { min: (_a = sliderProps.min) !== null && _a !== void 0 ? _a : 0, max: (_b = sliderProps.max) !== null && _b !== void 0 ? _b : 100, step: (_c = sliderProps.step) !== null && _c !== void 0 ? _c : 1 }) })));
        })) : (
        // If innerValue is a number
        React.createElement(TextField, Object.assign({ type: "number", className: "DebouncedSlider__TextField", variant: textFieldProps === null || textFieldProps === void 0 ? void 0 : textFieldProps.variant }, textFieldProps, { onChange: (textEvent) => handleChange(Number(textEvent.target.value)), error: error, value: innerValue, inputProps: Object.assign(Object.assign({}, textFieldProps === null || textFieldProps === void 0 ? void 0 : textFieldProps.inputProps), { min: (_a = sliderProps.min) !== null && _a !== void 0 ? _a : 0, max: (_b = sliderProps.max) !== null && _b !== void 0 ? _b : 100, step: (_c = sliderProps.step) !== null && _c !== void 0 ? _c : 1 }) })));
    };
    return (React.createElement(FormControl, Object.assign({ fullWidth: true, variant: "standard", component: "fieldset", className: "DebouncedSlider__FormControl", disabled: sliderProps.disabled }, formControlProps, { error: error }),
        React.createElement(FormLabel, { component: "legend", className: "DebouncedSlider__FormLabel" }, label),
        React.createElement(Box, { display: "flex", gap: 2, alignItems: "center", className: "DebouncedSlider__FlexboxWrapper" },
            React.createElement(Slider, Object.assign({ className: componentClassname, sx: { color: error ? "error.main" : "default", flexGrow: 1 } }, sliderProps, { value: innerValue, onChange: (_, values) => handleChange(values) })),
            renderTextfields && handleRenderTextfields()),
        helperText && (React.createElement(FormHelperText, { className: "DebouncedSlider__HelperText", error: error }, helperText)),
        error && (React.createElement(FormHelperText, { className: "DebouncedSlider__ErrorText", error: true }, errorMessage))));
};
//# sourceMappingURL=DebouncedSlider.js.map