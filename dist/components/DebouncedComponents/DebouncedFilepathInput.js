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
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import React, { forwardRef, useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import FormHelperText from "@mui/material/FormHelperText";
import ClearIcon from "@mui/icons-material/Clear";
/**
 * MUI TextField + Button component meant to capture a string representing a filepath and communicate it
 * to a parent component in a debounced manner.
 *
 * ### Mandatory Props:
 * - `value`: the value of the field
 * - `onChange`: a callback function to update the value of the field. The first argument is expected to be a string.
 * - `filepathType`: the type of filepath that this component is expected to take. One of "file", "dir", "other", "all".
 *
 * ### Optional Props:
 * - `dialogOptions`: options to pass to the Electron dialog when the button is clicked.
 *    [See the Electron docs for more info.](https://www.electronjs.org/docs/latest/api/dialog#dialogshowopendialogbrowserwindow-options)
 * - `errorMessage`: an error message to display below the field.
 * - `debounceTime`: the debounce time in milliseconds. Defaults to 500.
 * - `includeButton`: whether to include the Browse button. Defaults to true.
 * - `buttonText`: the text featured on the Browse button. Defaults to "Browse".
 * - `buttonProps`: additional props to pass to the Button component if it is rendered.
 * - `onValidateDrop`: a callback function to run and validate the value of a filepath. If it returns true, the value
 *    is forwarded to onChange, otherwise it is silently dropped
 * - `boxProps`: additional props to pass to the Box component that wraps the text field and error text
 * - all other props are forwarded to the TextField component
 */
export const DebouncedFilepathInput = forwardRef((_a, ref) => {
    var _b;
    var { value, onChange, filepathType, dialogOptions, errorMessage, debounceTime = 500, includeButton = true, buttonText = "Browse", buttonProps, onValidateDrop, boxProps, helperText } = _a, textFieldProps = __rest(_a, ["value", "onChange", "filepathType", "dialogOptions", "errorMessage", "debounceTime", "includeButton", "buttonText", "buttonProps", "onValidateDrop", "boxProps", "helperText"]);
    // Misc
    const componentClassName = textFieldProps.className
        ? `${textFieldProps.className} "DebouncedInput__TextField"`
        : "DebouncedInput__TextField";
    const { api } = window;
    // Inner State
    const [innerValue, setInnerValue] = useState(value);
    // Refs
    const isDialogOpened = useRef(false);
    // Debounce Callback
    const debouncedHandleChange = useDebouncedCallback(onChange, debounceTime);
    /** Handler for changes to the value; updates the inner value and forwards the new value via provided onChange */
    const handleChange = (newValue) => {
        // console.log("🚀 ~ file: DebouncedFilepathInput.tsx:91 ~ handleChange ~ newValue", newValue);
        setInnerValue(newValue);
        debouncedHandleChange(newValue);
    };
    // useEffect for keeping innerVal in sync with value prop
    useEffect(() => {
        if (value !== innerValue)
            setInnerValue(value);
    }, [value]);
    // Sanity Check for valid Props
    if (!dialogOptions && includeButton) {
        dialogOptions = {
            properties: filepathType === "all"
                ? ["openFile", "openDirectory"]
                : filepathType === "file"
                    ? ["openFile"]
                    : ["openDirectory"],
        };
    }
    if (dialogOptions && filepathType === "file" && dialogOptions.properties.includes("openDirectory")) {
        throw new Error("DebouncedFilepathInput: Cannot use openDirectory with filepathType=file");
    }
    if (dialogOptions && filepathType === "dir" && dialogOptions.properties.includes("openFile")) {
        throw new Error("DebouncedFilepathInput: Cannot use openFile with filepathType=dir");
    }
    /** Handler for dragging in a filepath */
    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    /** Handler for aborting in a drag */
    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    /** Handler for dropping a filepath */
    const handleDrop = (e) => __awaiter(void 0, void 0, void 0, function* () {
        e.preventDefault();
        e.stopPropagation();
        // Early exist
        if (!e.dataTransfer.files || e.dataTransfer.files.length === 0)
            return;
        const dndPath = e.dataTransfer.files[0];
        const droppedFilepathType = yield api.path.getFilepathType(dndPath.path);
        // Basic Filetype Checks
        // Exit if the filepathType doesn't match the given status
        if (!droppedFilepathType ||
            !(filepathType === droppedFilepathType ||
                (filepathType === "all" && ["file", "dir", "other"].includes(droppedFilepathType))))
            return;
        // Custom additional validation implemented, as necessary
        if (onValidateDrop) {
            const validationStatus = yield onValidateDrop(dndPath.path);
            if (!validationStatus)
                return;
        }
        handleChange(dndPath.path);
    });
    //* Handler for opening the file dialog */
    const handleOpenFileDialog = () => __awaiter(void 0, void 0, void 0, function* () {
        if (isDialogOpened.current)
            return; // Early return if already opened
        isDialogOpened.current = true;
        const { canceled, filePaths } = yield api.invoke("Dialog:OpenDialog", dialogOptions);
        isDialogOpened.current = false;
        !canceled && handleChange(filePaths[0]);
    });
    return (React.createElement(Box, Object.assign({ className: "DebouncedFilepathInput__Box__MainWrapper" }, boxProps),
        React.createElement(Box, { className: "DebouncedFilepathInput__Box__TextFieldButtonWrapper", display: "flex", width: "100%", gap: 1 },
            React.createElement(TextField, Object.assign({ className: componentClassName, fullWidth: true, variant: textFieldProps.variant }, textFieldProps, { inputRef: ref, InputProps: {
                    endAdornment: (React.createElement(IconButton, { className: "DebouncedFilepathInput__IconButton", color: textFieldProps.error ? "error" : "inherit", disabled: textFieldProps.disabled, onClick: () => innerValue && handleChange("") },
                        React.createElement(ClearIcon, { className: "DebouncedFilepathInput__ClearIcon" }))),
                }, error: textFieldProps.error, onDrop: handleDrop, onDragLeave: handleDragLeave, onDragEnter: handleDragEnter, onChange: (e) => handleChange(e.target.value), value: innerValue })),
            includeButton && (React.createElement(Button, Object.assign({ className: "DebouncedFilepathInput__Button", variant: "contained", disabled: textFieldProps.disabled, color: textFieldProps.error ? "error" : (_b = buttonProps === null || buttonProps === void 0 ? void 0 : buttonProps.color) !== null && _b !== void 0 ? _b : "primary" }, buttonProps, { onClick: handleOpenFileDialog }), buttonText))),
        helperText && (React.createElement(FormHelperText, { className: "DebouncedFilepathInput__HelperText", disabled: textFieldProps.disabled, variant: textFieldProps.variant }, helperText)),
        textFieldProps.error && (React.createElement(FormHelperText, { className: "DebouncedFilepathInput__ErrorText", disabled: textFieldProps.disabled, variant: textFieldProps.variant, error: true }, errorMessage))));
});
//# sourceMappingURL=DebouncedFilepathInput.js.map