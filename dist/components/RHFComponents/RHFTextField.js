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
import { useController, useWatch, } from "react-hook-form";
import { parseFieldError } from "../../common/utils/formFunctions";
import { DebouncedInput } from "../DebouncedComponents";
/**
 * Altered MaterialUI TextField component meant to be used in a react-hook-form context, specifically for text input.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The react-hook-form control object.
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
 * - `fieldToInner`: A function converting the field value to the inner value of this component.
 * - `innerToField`: A function converting the inner value of this component to the field value.
 * - `debounceTime`: The time in milliseconds to debounce the onChange event. Defaults to 500 milliseconds.
 * - `muiTextFieldProps`: All other props are passed to the underlying MaterialUI TextField component.
 */
export function RHFTextField(_a) {
    var { name, control, trigger, triggerTarget, watchTarget, onWatchedChange, fieldToInner, innerToField, onChange, debounceTime = 500 } = _a, // in ms
    muiTextFieldProps = __rest(_a, ["name", "control", "trigger", "triggerTarget", "watchTarget", "onWatchedChange", "fieldToInner", "innerToField", "onChange", "debounceTime"]);
    // RHF Variables
    const { field, fieldState } = useController({ name, control }); // field & fieldState
    const hasError = !!fieldState.error;
    const errorMessage = hasError ? parseFieldError(fieldState.error) : null;
    // Watch-related variables
    const isWatching = watchTarget && onWatchedChange;
    const watchParams = isWatching ? { control, name: watchTarget } : { control };
    const watchedValue = useWatch(watchParams);
    /** Handles changes to the input and triggers validation of dependent fields */
    const handleChange = (value) => {
        const newValue = innerToField ? innerToField(value) : value;
        field.onChange(newValue); // update the field value
        trigger && trigger(triggerTarget); // trigger the validation
        onChange && onChange(newValue); // call the onChange callback
    };
    // It is necessary to convert the field value to a compatible string type for the Input component
    const asStringValue = fieldToInner ? fieldToInner(field.value) : field.value;
    // console.log(`RHFTextField with name ${name} has asStringValue: `, asStringValue);
    function render() {
        return (React.createElement(DebouncedInput, Object.assign({ className: "RHFTextField__TextField" }, muiTextFieldProps, field, { error: hasError, errorMessage: errorMessage, value: asStringValue, onChange: handleChange, debounceTime: debounceTime })));
    }
    return isWatching ? (onWatchedChange(watchedValue) ? render() : null) : render();
}
//# sourceMappingURL=RHFTextField.js.map