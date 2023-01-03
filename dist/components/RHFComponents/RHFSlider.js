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
import { DebouncedSlider } from "../DebouncedComponents";
/**
 * Altered MaterialUI Slider component meant to be used in a react-hook-form context, specifically for fields that are
 * either a single number or an array of different numbers.
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
 * - `onChange`: A callback function to be called when the component changes. Expected to take in the new value of the
 * 		field as the first argument.
 * - `helperText`: Additional text to render near the bottom of the component to help the end user understand the field.
 * - `label`: The field label to render for the component.
 * - `formControlProps`: Props to pass to the wrapping FormControl component that wraps the child components such as the
 *    label, helperText, etc.
 * - `renderTextfields`: Whether or not to render the textfields that display the current value of the slider.
 *    Defaults to true.
 * - `textFieldProps`: Props to pass to the TextField components that are rendered when `renderTextfields` is true.
 * - `debounceTime`: The amount of time to wait before triggering the `onChange` callback. Defaults to 500 milliseconds.
 * - `...sliderProps`: All other props are passed to the underlying MaterialUI Slider component.
 */
export function RHFSlider(_a) {
    var { name, control, trigger, triggerTarget, watchTarget, onWatchedChange, onChange, debounceTime = 500, renderTextfields = true } = _a, sliderProps = __rest(_a, ["name", "control", "trigger", "triggerTarget", "watchTarget", "onWatchedChange", "onChange", "debounceTime", "renderTextfields"]);
    // RHF Variables
    const { field, fieldState } = useController({ name, control }); // field & fieldState
    const hasError = !!fieldState.error;
    const errorMessage = hasError ? parseFieldError(fieldState.error) : "";
    // Watch-related variables
    const isWatching = watchTarget && onWatchedChange;
    const watchProps = watchTarget && onWatchedChange ? { control, name: watchTarget } : { control };
    const watchedValue = useWatch(watchProps);
    /** Handles changes to the input and triggers validation of dependent fields */
    const handleChange = (value) => {
        field.onChange(value);
        trigger && trigger(triggerTarget);
        onChange && onChange(value);
    };
    // Slider doesn't take in a ref
    const { ref } = field, fixedField = __rest(field, ["ref"]);
    function render() {
        return (React.createElement(DebouncedSlider, Object.assign({}, sliderProps, fixedField, { error: hasError, errorMessage: errorMessage, onChange: handleChange, debounceTime: debounceTime, renderTextfields: renderTextfields })));
    }
    return isWatching ? (onWatchedChange(watchedValue) ? render() : null) : render();
}
//# sourceMappingURL=RHFSlider.js.map