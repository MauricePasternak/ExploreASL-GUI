import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { dropRight as lodashDropRight, range as lodashRange } from "lodash";
import React, { useEffect } from "react";
import { useController, useWatch } from "react-hook-form";
import { DebouncedSlider } from "../../../components/DebouncedComponents";
function StructureByParts({ control, name, trigger }) {
    const { field, fieldState } = useController({ control, name });
    const hasError = !!fieldState.error;
    // Allow for reaction to errors in the StudyRootPath field
    const studyRootPath = useWatch({ control: control, name: "StudyRootPath" });
    useEffect(() => {
        if (!studyRootPath)
            return;
        trigger("SourcedataStructure");
    }, [studyRootPath]);
    const handleNumFieldsChange = (newNumFields) => {
        if (Array.isArray(newNumFields) || newNumFields === field.value.length)
            return;
        // The new number is greater than the current number of fields
        if (newNumFields > field.value.length) {
            const additionalFields = lodashRange(newNumFields - field.value.length).map(() => "");
            field.onChange([...field.value, ...additionalFields]);
        }
        else {
            // The new number is less than the current number of fields
            field.onChange(lodashDropRight(field.value, field.value.length - newNumFields));
        }
    };
    const handleFieldChange = (e, index) => {
        const newFields = field.value.map((v, i) => (i === index ? e.target.value : v));
        console.log(`StuctureByParts handleFieldChange -- newFields,`, newFields);
        field.onChange(newFields);
        trigger(field.name); // Due to the nature of the field, triggering has to be done manually
    };
    return (React.createElement(Stack, { rowGap: 5 },
        React.createElement(FormControl, { variant: "standard" },
            React.createElement(FormLabel, null, "Number of Folders between Sourcedata and DICOM files"),
            React.createElement(DebouncedSlider, { value: field.value.length, min: 2, max: 8, step: 1, marks: lodashRange(2, 9).map((v) => ({
                    label: v.toString(),
                    value: v,
                })), onChange: (v) => handleNumFieldsChange(v) })),
        React.createElement(FormControl, { error: hasError, variant: "standard" },
            React.createElement(FormLabel, null, "Folder Structure - Information at each level"),
            React.createElement(Box, { display: "flex" },
                React.createElement(Box, { display: "flex", flexGrow: 0, alignSelf: "start", alignItems: "center", mr: 1, minHeight: "75px" },
                    React.createElement(Typography, { variant: "h5" }, "sourcedata")),
                React.createElement(Box, { display: "flex", flexWrap: "wrap" }, field.value.map((folderInfo, index) => {
                    return (React.createElement(Box, { display: "flex", alignItems: "center", key: `Box__FolderLevel__${index}`, className: "Box__FolderLevel" },
                        React.createElement(Typography, { variant: "h2" }, "/"),
                        React.createElement(FormControl, { variant: "outlined", error: hasError },
                            React.createElement(Select, { variant: "outlined", name: field.name, 
                                // disabled={StudyRootPathIsInvalid}
                                onBlur: field.onBlur, value: folderInfo, sx: { minWidth: "150px", mx: 2 }, onChange: (e) => handleFieldChange(e, index) }, [
                                { label: "", value: "" },
                                { label: "Subject", value: "Subject", disabled: field.value.includes("Subject") },
                                { label: "Visit", value: "Visit", disabled: field.value.includes("Visit") },
                                { label: "Session", value: "Session", disabled: field.value.includes("Session") },
                                { label: "Scan", value: "Scan", disabled: field.value.includes("Scan") },
                                { label: "Ignore", value: "Ignore" },
                            ].map((option, index) => (React.createElement(MenuItem, Object.assign({ key: `SourceStructureMenuItem_${index}` }, option), option.label)))))));
                }))),
            hasError && React.createElement(FormHelperText, null, fieldState.error.message))));
}
export default StructureByParts;
//# sourceMappingURL=StructureByParts.js.map