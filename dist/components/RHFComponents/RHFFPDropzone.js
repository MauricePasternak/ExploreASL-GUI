var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
import DeleteIcon from "@mui/icons-material/Delete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import { styled } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import React, { useEffect, useRef, useState } from "react";
import { useController, useWatch } from "react-hook-form";
import FastIsEqual from "fast-deep-equal";
const customGradient = "linear-gradient(60deg, hsl(224, 85%, 66%), hsl(269, 85%, 66%), hsl(314, 85%, 66%), hsl(359, 85%, 66%), hsl(44, 85%, 66%), hsl(89, 85%, 66%), hsl(134, 85%, 66%), hsl(179, 85%, 66%))";
const DropzonePaper = styled(Paper, {
    shouldForwardProp: (p) => p !== "hasError" && p !== "isAcceptingDrop",
})(({ theme, hasError, isAcceptingDrop, maxHeight = 620, borderWidth = "4px" }) => {
    return {
        padding: "8px",
        maxHeight: maxHeight,
        borderRadius: "12px",
        borderWidth: "3px",
        position: "relative",
        "&::after": {
            position: "absolute",
            content: '""',
            top: `calc(-1 * ${borderWidth})`,
            left: `calc(-1 * ${borderWidth})`,
            zIndex: -1,
            width: `calc(100% + ${borderWidth} * 2)`,
            height: `calc(100% + ${borderWidth} * 2)`,
            background: isAcceptingDrop ? customGradient : hasError ? theme.palette.error.main : "transparent",
            backgroundSize: "300% 300%",
            backgroundPosition: "0 50%",
            borderRadius: `calc(4 * ${borderWidth})`,
            animation: "moveGradient 4s alternate infinite",
        },
    };
});
/**
 * Component meant for use in a react-hook-form context, specifically within fields that are an array of filepaths.
 *
 * ### Mandatory Props
 * - `name`: The name of the field.
 * - `control`: The control coming from react-hook-form.
 * - `filepathType`: The type of filepaths that this dropzone will accept. Can be "file", "dir", "other", or "all".
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
 * - `dialogOptions`: Electron dialog options. By default, the `properties` property is set to "openFile" or "openDirectory"
 *    depending on the value of `filepathType`.
 * - `overWriteOnDrop`: Whether to overwriting existing values during a drop event. Defaults to `false`.
 * - `baseNamesOnly`: Whether to only display the basename portion of filepaths that are dropped into the component.
 *    Defaults to `false` (full paths will be the values).
 * - `label`: The field label to render for the component.
 * - `helperText`: Additional text to render near the bottom of the component to help the end user understand the field.
 * - `placeholderText`: The text to display when no values have been accepted yet. Defaults to `"Drop Files Here"`.
 * - `formControlProps`: Props to pass to the wrapping FormControl component that wraps the child components such as the
 *    label, helperText, etc.
 * - `boxProps`: Props to pass to the Box component that is the main Dropzone target.
 * - `browseButtonText`: The text to render for the button responsible for opening the dialog window.
 *    Defaults to `"Browse"`.
 * - `browseButtonProps`: Props to pass to the button associated with opening the filepath dialog window.
 * - `clearButtonText`: The text to render for the button responsible for clearing the current values.
 * - `clearButtonProps`: Props to pass to the button associated with clearing the current values.
 */
export function RHFFPDropzone(_a) {
    var _b;
    var { name, control, trigger, triggerTarget, watchTarget, onWatchedChange, onChange, filepathType, dialogOptions, baseNamesOnly = false, overWriteOnDrop = false, label, extraFilterFunction, formControlProps, placeholderText = "Drop Filepaths Here", helperText, browseButtonProps, clearButtonProps, browseButtonText = "Browse", clearButtonText = "Clear" } = _a, boxProps = __rest(_a, ["name", "control", "trigger", "triggerTarget", "watchTarget", "onWatchedChange", "onChange", "filepathType", "dialogOptions", "baseNamesOnly", "overWriteOnDrop", "label", "extraFilterFunction", "formControlProps", "placeholderText", "helperText", "browseButtonProps", "clearButtonProps", "browseButtonText", "clearButtonText"]);
    const { api } = window;
    // Refs
    const enterCounter = useRef(0); // We use this to keep track of enter/exit drop state
    const isDialogOpened = useRef(false); // We use this to keep track of dialog state
    // RHF Variables
    const { field, fieldState, formState } = useController({ name, control }); // field & fieldState
    const hasError = !!fieldState.error;
    const errorMessage = hasError ? (_b = fieldState.error) === null || _b === void 0 ? void 0 : _b.message : "";
    // Watch-related variables
    const isWatching = watchTarget && onWatchedChange;
    const watchParams = isWatching ? { control, name: watchTarget } : { control };
    const watchedValue = useWatch(watchParams);
    // Inner State
    const [innerVal, setInnerVal] = useState(field.value);
    const [isAcceptingDrop, setIsAcceptingDrop] = React.useState(false);
    // Setup default dialog options if a dialogOptions object was not provided and a button is to be presented
    if (!dialogOptions) {
        dialogOptions = {
            properties: filepathType === "all"
                ? ["openFile", "openDirectory"]
                : filepathType === "file"
                    ? ["openFile"]
                    : ["openDirectory"],
        };
    }
    /**
     * useEffect handler for responding to external changes to `field.value`
     * 1) Updates the internal value if it doesn't match field.value
     * 2) Triggers the validation of other fields
     */
    useEffect(() => {
        if (FastIsEqual(field.value, innerVal))
            return;
        // Update self and trigger target validation
        console.log(`InterdepFPTextfield ${field.name} is syncing with field.value and triggering ${triggerTarget}`, {
            fieldValue: field.value,
            innerVal,
        });
        setInnerVal(field.value);
        trigger && trigger(triggerTarget);
    }, [field.value]);
    // Sanity checks regarding the dialogOptions object
    if (dialogOptions && filepathType === "file" && dialogOptions.properties.includes("openDirectory")) {
        throw new Error("RHFFilepathTextField: Cannot use openDirectory with filepathType=file");
    }
    if (dialogOptions && filepathType === "dir" && dialogOptions.properties.includes("openFile")) {
        throw new Error("RHFFilepathTextField: Cannot use openFile with filepathType=dir");
    }
    /** Utility function to ensure that the encountered filepath fits the requirement of the `filepathType` */
    const filterFiles = (files) => __awaiter(this, void 0, void 0, function* () {
        const filteredList = [];
        for (let index = 0; index < files.length; index++) {
            const element = files[index];
            const filepath = typeof element === "string" ? element : element.path;
            const pathType = yield api.path.getFilepathType(filepath);
            // Basic filtering; the determined path type must be compatible with the filepathType prop
            if (!pathType || // Filepath doesn't exist
                (pathType === "file" && !["file", "all"].includes(filepathType)) || // File type when not requested
                (pathType === "dir" && !["dir", "all"].includes(filepathType)) || // Dir type when not requested
                (pathType === "other" && !["other", "all"].includes(filepathType)) // Other type when not requested
            ) {
                continue;
            }
            // Apply user-specified additional validation
            if (extraFilterFunction && !(yield extraFilterFunction(filepath)))
                continue;
            // Finally, if all is clear, append the appropriate fullpath or basename to the filteredList
            filteredList.push(baseNamesOnly ? api.path.getBasename(filepath) : filepath);
        }
        return filteredList;
    });
    /** Handler for entering with a filepath object */
    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterCounter.current++;
        !isAcceptingDrop && setIsAcceptingDrop(true);
    };
    /** Required handlier for persisting the droppable state */
    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    /** Handler for leaving the dropzone while still dragging a filepath */
    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterCounter.current--;
        if (enterCounter.current === 0) {
            isAcceptingDrop && setIsAcceptingDrop(false);
        }
    };
    /** Handler for dropping filepaths into the dropzone */
    const handleDrop = (e) => __awaiter(this, void 0, void 0, function* () {
        e.preventDefault();
        e.stopPropagation();
        const filePaths = Array.from(e.dataTransfer.files);
        // Filter the filepaths
        const filteredList = yield filterFiles(filePaths);
        const finalItemset = overWriteOnDrop ? filteredList : [...innerVal, ...filteredList];
        // Update the field value
        handleChange(finalItemset);
    });
    /** Handler for changing the value of the field, triggering validation, and resetting drop-related variables */
    const handleChange = (newValue) => {
        console.log("🚀 ~ file: RHFFPDropzone.tsx:250 ~ handleChange ~ newValue", newValue);
        console.log("🚀 ~ file: RHFFPDropzone.tsx:250 ~ handleChange ~ fieldState", JSON.stringify(fieldState));
        field.onChange(newValue);
        trigger && trigger(field.name); // hack; otherwise, the field doesn't get validated...
        field.onBlur();
        onChange && onChange(newValue);
        enterCounter.current = 0;
        isAcceptingDrop && setIsAcceptingDrop(false);
        setInnerVal(newValue);
    };
    /** Handler for opening a file dialog */
    const handleDialog = () => __awaiter(this, void 0, void 0, function* () {
        if (isDialogOpened.current)
            return;
        if (!dialogOptions)
            throw new Error("dialogOptions were not specified");
        // Get the filepaths from the dialog and early exit if no files were selected
        isDialogOpened.current = true;
        const { canceled, filePaths } = yield api.invoke("Dialog:OpenDialog", dialogOptions);
        isDialogOpened.current = false;
        if (canceled)
            return;
        // Filter the filepaths
        const filteredList = yield filterFiles(filePaths);
        const finalItemset = overWriteOnDrop ? filteredList : [...innerVal, ...filteredList];
        // Update the field value
        handleChange(finalItemset);
    });
    /** Handler for choosing to delete a particular item within innerVal */
    const handleDelete = (index) => {
        const newValue = innerVal.filter((_, i) => i !== index);
        handleChange(newValue);
    };
    function render() {
        return (React.createElement(FormControl, Object.assign({ className: "RHFFPDropzone__FormControl", fullWidth: true, variant: "standard" }, formControlProps, { component: "fieldset", error: hasError }),
            React.createElement(FormLabel, { component: "legend", className: "RHFFPDropZone__FormLabel" }, label),
            React.createElement(DropzonePaper, { className: "RHFFPDropzone__Paper", elevation: 2, hasError: hasError, isAcceptingDrop: isAcceptingDrop },
                React.createElement(Box, Object.assign({ className: "RHFFPDropzone__Box__Dropzone", onDrop: handleDrop, onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDragEnter: handleDragEnter, onBlur: field.onBlur, sx: {
                        width: "100%",
                        height: "clamp(400px, 500px, 600px)",
                        borderRadius: "8px",
                        backgroundColor: (theme) => theme.palette.mode === "dark" ? theme.palette.background.default : theme.palette.grey[100],
                        marginBottom: "8px",
                        position: "relative",
                    } }, boxProps, { overflow: "auto" }),
                    React.createElement(List, { className: "RHFFPDropzone__List" }, Array.isArray(innerVal) &&
                        innerVal.map((listItem, idx) => (React.createElement(ListItem, { key: `RHFFPDropzone__ListItem__${listItem}_${idx}`, className: "RHFFPDropzone__ListItem", divider: idx !== innerVal.length - 1, secondaryAction: React.createElement(IconButton, { className: "RHFFPDropzone__IconButton", onClick: () => handleDelete(idx) },
                                React.createElement(DeleteIcon, { className: "RHFFPDropzone__DeleteIcon" })) },
                            React.createElement(ListItemText, { className: "RHFFPDropzone__ListItemText", primary: React.createElement(Typography, { noWrap: true }, listItem) }))))),
                    innerVal.length === 0 && (React.createElement(Typography, { className: "RHFFPDropzone__Typography__PlaceholderText", variant: "subtitle1", sx: {
                            fontSize: "1.5rem",
                            color: (theme) => theme.palette.text.secondary,
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            textAlign: "center",
                        } }, placeholderText))),
                dialogOptions && (React.createElement(Button, Object.assign({ className: "RHFFPDropzone__Button__Browse", sx: { borderRadius: "12px", mb: 0.5 }, color: hasError ? "error" : "primary", fullWidth: true, variant: "contained" }, browseButtonProps, { onClick: handleDialog }), browseButtonText)),
                React.createElement(Button, Object.assign({ className: "RHFFPDropzone__Button__Clear", sx: { borderRadius: "12px" }, color: hasError ? "error" : "warning", fullWidth: true, variant: "contained" }, clearButtonProps, { onClick: () => {
                        innerVal.length > 0 && handleChange([]);
                    } }), clearButtonText)),
            helperText && React.createElement(FormHelperText, { className: "RHFFPDropzone__HelperText" }, helperText),
            hasError && (React.createElement(FormHelperText, { className: "RHFFPDropzone__ErrorText", error: true }, errorMessage))));
    }
    return isWatching ? (onWatchedChange(watchedValue) ? render() : null) : render();
}
//# sourceMappingURL=RHFFPDropzone.js.map