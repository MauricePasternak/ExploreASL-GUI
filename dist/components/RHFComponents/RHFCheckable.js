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
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Switch from "@mui/material/Switch";
import React, { useEffect } from "react";
import { useController, useWatch } from "react-hook-form";
/**
 * A MaterialUI Checkbox or Switch checkable component meant to be used in a react-hook-form context, specifically
 * for fields with a binary set of values.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `valWhenChecked`: The value of the field when it is in a checked state.
 * - `valWhenUnchecked`: The value of the field when it is in an unchecked state.
 *
 * ### RHF-related Optional Props
 * - `trigger`: The trigger function from react-hook-form, allowing changes to this component to trigger validation
 *    in other fields.
 * - `triggerTarget`: The fields whose validation should be triggered when this component changes.
 * - `watchTarget`: The fields whose values should be watched for changes which affect the rendering of this component.
 * - `onWatchedChange`: A callback function to be called when the watched fields change. Expected to return a boolean
 *    indicating whether the component should be rendered.
 *
 * ### Other Optional Props
 * - `helperText`: Additional text to render near the bottom of the component to help the end user understand the field.
 * - `label`: The field label to render for the component.
 * - `isSwitch`: Whether the component to render is a Switch (true) or a Checkbox (false). Defaults to the latter.
 * - `checkableProps`: Props to pass to the checkable component.
 * - `...muiFormControlLabelProps`: All additional props are forwarded to the FormControlLabel component.
 */
export function RHFCheckable(_a) {
    var _b;
    var { name, control, trigger, triggerTarget, watchTarget, onWatchedChange, onChange, valWhenChecked, // value to set when checked
    valWhenUnchecked, // value to set when unchecked
    label, // label to display next to the checkbox/switch
    helperText, // helper text to display below the checkbox/switch
    isSwitch = false, // display as a switch instead of a checkbox
    checkableProps } = _a, // props to pass to the checkbox/switch
    muiFormControlLabelProps = __rest(_a, ["name", "control", "trigger", "triggerTarget", "watchTarget", "onWatchedChange", "onChange", "valWhenChecked", "valWhenUnchecked", "label", "helperText", "isSwitch", "checkableProps"]) // props to pass to the FormControlLabel
    ;
    // RHF Variables
    const { field, fieldState } = useController({ name, control }); // field & fieldState
    const hasError = !!fieldState.error;
    const errorMessage = hasError ? (_b = fieldState.error) === null || _b === void 0 ? void 0 : _b.message : "";
    const isChecked = field.value === valWhenChecked;
    // Watch-related variables
    const isWatching = watchTarget && onWatchedChange;
    const watchParams = isWatching ? { control, name: watchTarget } : { control };
    const watchedValue = useWatch(watchParams);
    /**
     * When field.value changes, trigger the triggerTarget.
     */
    useEffect(() => {
        trigger && trigger(triggerTarget);
    }, [JSON.stringify(field.value)]);
    const handleChange = (checked) => {
        const newValue = checked ? valWhenChecked : valWhenUnchecked;
        field.onChange(newValue);
        field.onBlur();
        trigger && trigger(triggerTarget); // trigger the triggerTarget
        onChange && onChange(newValue);
    };
    function render() {
        return (React.createElement(Box, { display: "flex", flexDirection: "column", alignItems: "start", className: "RHFCheckable__BoxWrapper" },
            React.createElement(FormControlLabel, Object.assign({ className: "RHFCheckable__FormControlLabel", componentsProps: {
                    typography: { color: hasError ? "error" : "default" },
                } }, muiFormControlLabelProps, { inputRef: field.ref, onBlur: field.onBlur, name: field.name, label: label, checked: isChecked, control: isSwitch === true ? (React.createElement(Switch, Object.assign({ className: "RHFCheckable__Switch" }, checkableProps, { onChange: (_, checked) => handleChange(checked), color: hasError ? "error" : "primary" }))) : (React.createElement(Checkbox, Object.assign({ className: "RHFCheckable__Checkbox" }, checkableProps, { onChange: (_, checked) => handleChange(checked), color: hasError ? "error" : "primary" }))) })),
            helperText && React.createElement(FormHelperText, { error: hasError }, helperText),
            errorMessage && React.createElement(FormHelperText, { error: hasError }, errorMessage)));
    }
    return isWatching ? (onWatchedChange(watchedValue) ? render() : null) : render();
}
//# sourceMappingURL=RHFCheckable.js.map