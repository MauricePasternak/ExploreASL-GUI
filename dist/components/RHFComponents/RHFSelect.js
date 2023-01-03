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
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import React from "react";
import { useController, useWatch, } from "react-hook-form";
/**
 * A MaterialUI Select component meant to be used in a react-hook-form context, specifically for fields that either
 * feature multiple options of varying types or an array of such multiple options.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `options`: Options for the label, value, etc. of the MenuItem child components.
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
 * - `onChange`: A callback function to be called when the component changes. Expected to take in the new value of the
 * 		field as the first argument.
 * - `helperText`: Additional text to render near the bottom of the component to help the end user understand the field.
 * - `label`: The field label to render for the component.
 * - `formControlProps`: Props to pass to the wrapping FormControl component that wraps the child components such as the
 *    label, helperText, etc.
 * - Additional props are passed to the Select component.
 */
export function RHFSelect(_a) {
    var _b;
    var { name, control, trigger, triggerTarget, watchTarget, onWatchedChange, options, onChange, label, formControlProps, helperText } = _a, muiSelectProps = __rest(_a, ["name", "control", "trigger", "triggerTarget", "watchTarget", "onWatchedChange", "options", "onChange", "label", "formControlProps", "helperText"]);
    // RHF Variables
    const { field, fieldState } = useController({ name, control });
    const hasError = !!fieldState.error;
    const errorMessage = hasError ? (_b = fieldState.error) === null || _b === void 0 ? void 0 : _b.message : "";
    // Watch-related variables
    const isWatching = watchTarget && onWatchedChange;
    const watchParams = isWatching ? { control, name: watchTarget } : { control };
    const watchedValue = useWatch(watchParams);
    const handleChange = (e) => {
        field.onChange(e);
        trigger && triggerTarget && trigger(triggerTarget);
        onChange && onChange(e.target.value);
    };
    function render() {
        return (React.createElement(FormControl, Object.assign({ className: "RHFSelect__FormControl", fullWidth: true }, formControlProps, { variant: muiSelectProps.variant, error: hasError, disabled: muiSelectProps.disabled, component: "fieldset" }),
            React.createElement(InputLabel, { className: "RHFSelect__InputLabel" }, label),
            React.createElement(Select, Object.assign({ className: "RHFSelect__Select" }, muiSelectProps, field, { onChange: handleChange, label: label }), options.map((option, index) => {
                return (React.createElement(MenuItem, Object.assign({ className: "RHFSelect__MenuItem", key: `RHFSelect__MenuItem__${index}` }, option), option.label));
            })),
            helperText && (React.createElement(FormHelperText, { className: "RHFSelect__HelperText", error: hasError }, helperText)),
            hasError && (React.createElement(FormHelperText, { className: "RHFSelect__ErrorText", error: true }, errorMessage))));
    }
    return isWatching ? (onWatchedChange(watchedValue) ? render() : null) : render();
}
//# sourceMappingURL=RHFSelect.js.map