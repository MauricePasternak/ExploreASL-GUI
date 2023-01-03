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
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import React from "react";
import { useController, useWatch } from "react-hook-form";
import { DebouncedInput } from "../DebouncedComponents";
/**
 * Component meant for use in a react-hook-form context, specifically for fields that need a "key: value" mapping.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `type`: Either a "textfield" or "select". This determines the type of component used for the value portion.
 * - `options`: An array of MenuItem options for when the type is "select".
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
 * - `title`: The overall label of the component.
 * - `keysSubtitle`: The text to render as the subtitle denoting what the keys represent.
 * - `valuesSubtitle`: The text to render as the subtitle denoting what the values represent.
 * - `maxHeight`: The maximum height of the component before it begins overflowing scroll.
 * - `helperText`: Will appear as the subtitle beneath the main label of the component.
 *    Used to provide additional clarification for the end user.
 * - `cardHeaderProps`: Additional props to provide to the CardHeader component.
 * - `headerColor`: The default non-error color of the CardHeader component.
 */
export function RHFMapping(_a) {
    var _b;
    var { name, control, trigger, triggerTarget, watchTarget, onWatchedChange, onChange, type, title, keysSubtitle, valuesSubtitle, placeholder, maxHeight = "600px", helperText, // helper text for the whole mapping
    cardHeaderProps, // options for the CardHeader component
    headerColor = "primary.main" } = _a, // color for the CardHeader component
    props = __rest(_a, ["name", "control", "trigger", "triggerTarget", "watchTarget", "onWatchedChange", "onChange", "type", "title", "keysSubtitle", "valuesSubtitle", "placeholder", "maxHeight", "helperText", "cardHeaderProps", "headerColor"]);
    // RHF Variables
    const { field, fieldState } = useController({ name, control });
    // Sanity Check for field.value
    if (field.value == null || typeof field.value !== "object") {
        throw new Error(`Encountered an error for RHFMapping in field ${field.name}. Expected field value to be an object, but got ${field.value}`);
    }
    const hasError = !!fieldState.error;
    const errorMessage = hasError ? (_b = fieldState.error) === null || _b === void 0 ? void 0 : _b.message : "";
    // Watch-related variables
    const isWatching = watchTarget && onWatchedChange;
    const watchParams = isWatching ? { control, name: watchTarget } : { control };
    const watchedValue = useWatch(watchParams);
    // Inner State
    const mappingEntries = Object.entries(field.value); // convert to array of [key, value] pairs
    /** Handler for changes coming from rendered Select child components */
    const handleSelectChange = (v, key) => {
        console.log(`handleSelectChange: ${key} = ${v}`); // v is a string or number or undefined
        const newValues = Object.assign(Object.assign({}, field.value), { [key]: v }); // create new object with updated value
        field.onChange(newValues); // update field value
        trigger && trigger(triggerTarget); // trigger any target validation fields
        onChange && onChange(newValues); // call onChange callback
    };
    /** Handler for changes coming from rendered DebouncedInput components */
    const handleTextFieldChange = (v, key) => {
        const newValues = Object.assign(Object.assign({}, field.value), { [key]: v }); // create new object with updated value
        field.onChange(newValues); // update the field value
        trigger && trigger(triggerTarget); // trigger the validation
    };
    // Fix sx prop for the CardHeader component
    const _c = cardHeaderProps || {}, { sx: cardHeaderSx } = _c, cardHeaderPropsWithoutSx = __rest(_c, ["sx"]); // extract sx prop from cardHeaderProps
    const defaultCardHeaderSx = {
        backgroundColor: hasError ? "error.main" : headerColor,
        color: "primary.contrastText",
        "& .MuiCardHeader-subheader": {
            color: "primary.contrastText", // helper text for the whole mapping
        },
    };
    const fixedHeaderSx = Object.assign(Object.assign({}, defaultCardHeaderSx), cardHeaderSx); // merge default and custom sx props
    /** Handler for rendering the keys subtitle */
    function renderKeysSubtitle() {
        return typeof keysSubtitle === "string" ? (React.createElement(Typography, { className: "RHFMapping__FirstRow__KeyTitle", variant: "h6" }, keysSubtitle)) : (keysSubtitle);
    }
    /** Handler for rendering the values subtitle */
    function renderValuesSubtitle() {
        return typeof valuesSubtitle === "string" ? (React.createElement(Typography, { className: "RHFMapping__FirstRow__ValueTitle", variant: "h6" }, valuesSubtitle)) : (valuesSubtitle);
    }
    function render() {
        return (React.createElement(Card, { className: "RHFMapping__Card" },
            title && (React.createElement(CardHeader, Object.assign({ className: "RHFMapping__CardHeader", title: title, subheader: helperText, sx: fixedHeaderSx }, cardHeaderPropsWithoutSx))),
            React.createElement(CardContent, { className: "RHFMapping__CardContent" },
                React.createElement(List, { className: "RHFMapping__List", sx: { maxHeight: { maxHeight }, overflowY: "auto" } },
                    (keysSubtitle || valuesSubtitle) && (React.createElement(ListItem, { className: "RHFMapping__FirstRow__ListItem", sx: { justifyContent: "space-between" } },
                        renderKeysSubtitle(),
                        renderValuesSubtitle())),
                    mappingEntries.length > 0
                        ? mappingEntries.map(([key, value], index) => {
                            var _a;
                            return (React.createElement(ListItem, { key: `RHFMapping__ListItem__${index}`, className: "RHFMapping__ListItem", sx: {
                                    display: "grid",
                                    gridTemplateColumns: "minmax(min(100px, 100%), 0.5fr) minmax(min(200px, 100%), 1fr)",
                                }, divider: index < mappingEntries.length - 1 },
                                React.createElement(Typography, { className: "RHFMapping__Key__Typography", sx: { marginRight: "10px", wordWrap: "break-word" } }, key),
                                type === "select" ? (React.createElement(Select, { className: "RHFMapping__Value__Select", value: value, onChange: (e) => handleSelectChange(e.target.value, key) }, (_a = props.options) === null || _a === void 0 ? void 0 : _a.map((option, optionIndex) => (React.createElement(MenuItem, { className: "RHFMapping__Value__MenuItem", key: `RHFMapping__Value__MenuItem__${optionIndex}`, value: option.value }, option.label))))) : (React.createElement(DebouncedInput, { className: "RHFMapping__Value__TextField", fullWidth: true, value: value, type: "text", onChange: (v) => handleTextFieldChange(v, key) }))));
                        })
                        : placeholder)),
            hasError && (React.createElement(CardActions, { className: "RHFMapping__CardActions" },
                React.createElement(Typography, { className: "RHFMapping__ErrorText", color: "error" }, errorMessage)))));
    }
    return isWatching ? (onWatchedChange(watchedValue) ? render() : null) : render();
}
//# sourceMappingURL=RHFMapping.js.map