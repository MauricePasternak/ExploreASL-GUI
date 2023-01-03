import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import React from "react";
import { useController, useWatch, } from "react-hook-form";
/**
 * A MaterialUI RadioGroup meant to be used in a react-hook-form context, specifically for fields where there are few
 * options, but the values can vary in type significantly.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `options`: Options for the label, value, etc. of the Radio button child components.
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
 * - `row`: Whether the radio button group should be arranged in a row (true) or a column (false).
 *    Defaults to column arrangement.
 */
export function RHFRadioGroup({ name, control, trigger, triggerTarget, watchTarget, onWatchedChange, options, onChange, label, // label to display above the radio buttons
helperText, // helper text to display below the checkbox
row, // display options in a row instead of a column
 }) {
    var _a;
    // RHF Variables
    const { field, fieldState } = useController({ name, control }); // get the field and fieldState from react-hook-form
    const hasError = !!fieldState.error;
    const errorMessage = hasError ? (_a = fieldState.error) === null || _a === void 0 ? void 0 : _a.message : "";
    // Watch-related variables
    const isWatching = watchTarget && onWatchedChange;
    const watchParams = isWatching ? { control, name: watchTarget } : { control };
    const watchedValue = useWatch(watchParams);
    const handleChange = (idx) => {
        const newValue = options[idx].value;
        field.onChange(newValue);
        trigger && trigger(triggerTarget); // trigger validation
        onChange && onChange(newValue); // call onChange callback
    };
    function render() {
        return (React.createElement(FormControl, { onBlur: field.onBlur, fullWidth: true, error: hasError, variant: "standard", component: "fieldset", className: "RHFRadioGroup__FormControl" },
            React.createElement(FormLabel, { component: "legend", className: "RHFRadioGroup__FormLabel" }, label),
            React.createElement(RadioGroup, { row: row, className: "RHFRadioGroup__RadioGroup" }, options.map((option, idx) => {
                var _a;
                return (React.createElement(FormControlLabel, { key: `RHFRadioGroup__FormControlLabel__${field.name}__${idx}`, className: "RHFRadioGroup__FormControlLabel", label: option.label, checked: field.value === option.value, onChange: () => handleChange(idx), control: React.createElement(Radio, Object.assign({}, option, { color: hasError ? "error" : (_a = option === null || option === void 0 ? void 0 : option.color) !== null && _a !== void 0 ? _a : "primary" })) }));
            })),
            helperText && (React.createElement(FormHelperText, { className: "RHFRadioGroup__HelperText", error: hasError }, helperText)),
            hasError && (React.createElement(FormHelperText, { className: "RHFRadioGroup__ErrorText", error: true }, errorMessage))));
    }
    return isWatching ? (onWatchedChange(watchedValue) ? render() : null) : render();
}
//# sourceMappingURL=RHFRadioGroup.js.map