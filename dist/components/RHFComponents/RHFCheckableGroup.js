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
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Switch from "@mui/material/Switch";
import FastIsEqual from "fast-deep-equal";
import React, { useEffect, useState } from "react";
import { useController, useWatch, } from "react-hook-form";
import { parseFieldError } from "../../common/utils/formFunctions";
/**
 * A collection of MaterialUI Checkbox/Switch components meant for use in a react-hook-form context,
 * specifically for array fields containing primitives. Has two behaviors:
 * - be a fixed-length tuple which has a stand-in default value at unchecked positions
 * - be a variable-length array whose values only include checked values, in no particular order.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `type`: Which MUI component to use. One of "checkbox" or "switch".
 * - `options`: A collection of {@link RHFCheckableOption} objects that describe the labels,
 *    checked values, etc. for each checkable.
 * - `keepUncheckedValue`: The behavior of this component as described above. Will act as a tuple if true, otherwise
 *    will act like an array.
 * - `uncheckedValue`: The value to use for the unchecked state. This is still mandatory even when the behavior of the
 *    component is meant to be an array instead of a tuple.
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
 * - `row`: Whether the checkables should be arranged in a row (true) or a column (false).
 *    Defaults to column arrangement.
 */
export function RHFCheckableGroup({ name, control, trigger, triggerTarget, watchTarget, onWatchedChange, type, options, keepUncheckedValue, uncheckedValue, onChange, helperText, label, row = false, }) {
    // RHF Variables
    const { field, fieldState } = useController({ name, control }); // get the field and fieldState from react-hook-form
    const hasError = !!fieldState.error;
    const errorMessage = hasError ? parseFieldError(fieldState.error) : "";
    // Watch-related variables
    const isWatching = watchTarget && onWatchedChange;
    const watchParams = isWatching ? { control, name: watchTarget } : { control };
    const watchedValue = useWatch(watchParams);
    /**
     * Parses the current field.value to into what innerValue should be based on options given to the component.
     */
    function getNewInnerValue() {
        return options.map((option, idx) => {
            if (keepUncheckedValue) {
                return option.value === field.value[idx] ? option.value : uncheckedValue;
            }
            else {
                return field.value.includes(option.value) ? option.value : uncheckedValue;
            }
        });
    }
    // Inner State
    const [innerValue, setInnerVal] = useState(() => (field.value && getNewInnerValue()) || []);
    /** Keep innerValue and field.value synced (i.e. if field.value is programatically changed) */
    useEffect(() => {
        const paddedInnerValue = getNewInnerValue();
        if (field.value != null && !FastIsEqual(paddedInnerValue, innerValue))
            setInnerVal(paddedInnerValue);
    }, [JSON.stringify(field.value)]);
    /** Handler for updating  */
    const handleChange = (index, checked) => {
        // Need to make a copy of the innerValue to avoid mutating the state directly
        const innerValCopy = [...innerValue];
        // Mutate the copy at the indicated location
        innerValCopy[index] = checked ? options[index].value : uncheckedValue;
        // Filter out the filler value if indicated
        const finalVal = keepUncheckedValue
            ? innerValCopy
            : innerValCopy.filter((val) => val !== uncheckedValue);
        // Update the state and trigger the onChange callback with the final value
        setInnerVal(innerValCopy);
        field.onChange(finalVal);
        trigger && trigger(triggerTarget);
        onChange && onChange(finalVal);
    };
    function render() {
        return (React.createElement(FormControl, { onBlur: field.onBlur, error: hasError, fullWidth: true, component: "fieldset", variant: "standard", className: "RHFMultiCheckable__FormControl" },
            React.createElement(FormLabel, { component: "legend", className: "RHFMultiCheckable__FormLabel" }, label),
            React.createElement(FormGroup, { row: row, className: "RHFMultiCheckable__FormGroup" }, options.map((rawOption, optionIdx) => {
                const { value } = rawOption, option = __rest(rawOption, ["value"]);
                return (React.createElement(FormControlLabel, { key: `RHFMultiCheckable__${option.label}__${optionIdx}`, className: "RHFMultiCheckable__FormControlLabel", label: option.label, control: type === "checkbox" ? (React.createElement(Checkbox, Object.assign({ className: "RHFMultiCheckable__Checkbox" }, option, { value: value, checked: keepUncheckedValue ? innerValue[optionIdx] !== uncheckedValue : innerValue.includes(value), onChange: (_, checked) => handleChange(optionIdx, checked) }))) : (React.createElement(Switch, Object.assign({ className: "RHFMultiCheckable__Switch" }, option, { value: value, checked: keepUncheckedValue ? innerValue[optionIdx] !== uncheckedValue : innerValue.includes(value), onChange: (_, checked) => handleChange(optionIdx, checked) }))) }));
            })),
            hasError && (React.createElement(FormHelperText, { className: "RHFMultiCheckable__ErrorText", error: true }, errorMessage)),
            helperText && (React.createElement(FormHelperText, { className: "RHFMultiCheckable__HelperText", error: hasError }, helperText))));
    }
    return isWatching ? (onWatchedChange(watchedValue) ? render() : null) : render();
}
//# sourceMappingURL=RHFCheckableGroup.js.map