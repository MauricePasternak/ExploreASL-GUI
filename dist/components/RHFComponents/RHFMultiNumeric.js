import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import React from "react";
import { useController, useWatch } from "react-hook-form";
import { DebouncedInput } from "../DebouncedComponents";
/**
 * A collection of MaterialUI numeric TextField components meant to be used in a react-hook-form context, specifically
 * for fields that require a tuple of numbers.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
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
 * - `flexWrapperProps`: Props to apply to the Box component that acts as a flexbox container around the TextFields.
 * - `formControlProps`: Props to apply to the FormControl component that wraps the flexWrapper and other child
 *    components such as the label, helperText, etc.
 * - `min`: The minimum value that inputs should allow.
 * - `max`: The maximum value that inputs should allow.
 * - `step`: The step by which inputs should increment.
 */
export function RHFMultiNumeric({ name, control, trigger, triggerTarget, watchTarget, onWatchedChange, onChange, label, helperText, flexWrapperProps, formControlProps, min = 0, max = 100, step = 1, }) {
    var _a;
    // RHF Variables
    const { field, fieldState } = useController({ name, control }); // get the field and fieldState from react-hook-form
    const hasError = !!fieldState.error;
    const errorMessage = hasError ? (_a = fieldState.error) === null || _a === void 0 ? void 0 : _a.message : "";
    // Watch-related variables
    const isWatching = watchTarget && onWatchedChange;
    const watchParams = isWatching ? { control, name: watchTarget } : { control };
    const watchedValue = useWatch(watchParams);
    const handleChange = (value, index, currArr) => {
        const valAsNumber = typeof value === "string" ? Number(value) : value;
        const newValues = currArr.map((currVal, i) => (i === index ? valAsNumber : currVal));
        field.onChange(newValues);
        trigger && trigger(triggerTarget); // trigger the validation
        onChange && onChange(newValues);
    };
    // Sanity Check
    if (!Array.isArray(field.value)) {
        throw new Error(`RHFMultiNumeric with field name ${field.name} received an error: field value must be an array of numbers`);
    }
    function render() {
        return (React.createElement(FormControl, Object.assign({ className: "RHFMultiNumeric__FormControl", variant: "standard" }, formControlProps, { component: "fieldset", error: hasError }),
            React.createElement(FormLabel, { className: "RHFMultiNumeric__FormLabel", component: "legend" }, label),
            React.createElement(Box, Object.assign({ className: "RHFMultiNumeric__Box", display: "flex", gap: 1, flexDirection: { xs: "column", sm: "row" } }, flexWrapperProps), field.value.map((value, index, arr) => (React.createElement(DebouncedInput, { key: `${field.name}_${index}`, boxProps: { flexGrow: 1 }, sx: { flexGrow: 1 }, onBlur: field.onBlur, value: value, error: hasError, onChange: (v) => handleChange(v, index, arr), type: "number", InputProps: { ref: field.ref }, inputProps: { min, max, step } })))),
            helperText && React.createElement(FormHelperText, { className: "RHFMultiNumeric__HelperText" }, helperText),
            hasError && React.createElement(FormHelperText, { className: "RHFMultiNumeric__ErrorText" }, errorMessage)));
    }
    return isWatching ? (onWatchedChange(watchedValue) ? render() : null) : render();
}
//# sourceMappingURL=RHFMultiNumeric.js.map