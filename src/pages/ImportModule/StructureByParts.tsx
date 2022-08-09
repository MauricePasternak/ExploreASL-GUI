import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import MenuItem from "@mui/material/MenuItem";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { dropRight as lodashDropRight, range as lodashRange } from "lodash";
import React, { useEffect } from "react";
import { useController, UseFormTrigger, useWatch } from "react-hook-form";
import { RHFControlAndNameType } from "../../common/types/formTypes";
import { ImportSchemaType } from "../../common/types/ImportSchemaTypes";

type StructureByPartsProps = RHFControlAndNameType<ImportSchemaType, "SourcedataStructure"> & {
  trigger: UseFormTrigger<ImportSchemaType>;
};

function StructureByParts({ control, name, trigger }: StructureByPartsProps) {
  const { field, fieldState, formState } = useController({ control, name });

  const hasError = !!fieldState.error;

  // Allow for reaction to errors in the StudyRootPath field
  const studyRootPath = useWatch({ control: control, name: "StudyRootPath" });

  useEffect(() => {
    if (!studyRootPath) return;
    trigger("SourcedataStructure");
  }, [studyRootPath]);

  const handleNumFieldsChange = (newNumFields: number | number[]) => {
    if (Array.isArray(newNumFields) || newNumFields === field.value.length) return;

    // The new number is greater than the current number of fields
    if (newNumFields > field.value.length) {
      const additionalFields = lodashRange(newNumFields - field.value.length).map(() => "");
      field.onChange([...field.value, ...additionalFields]);
    } else {
      // The new number is less than the current number of fields
      field.onChange(lodashDropRight(field.value, field.value.length - newNumFields));
    }
  };

  const handleFieldChange = (e: SelectChangeEvent, index: number) => {
    const newFields = field.value.map((v, i) => (i === index ? e.target.value : v));
    console.log(`StuctureByParts handleFieldChange -- newFields,`, newFields);
    field.onChange(newFields);
    trigger(field.name); // Due to the nature of the field, triggering has to be done manually
  };

  return (
    <Stack rowGap={5}>
      <FormControl variant="standard">
        <FormLabel>Number of Folders between Sourcedata and DICOM files</FormLabel>
        <Slider
          value={field.value.length}
          min={2}
          max={8}
          // disabled={StudyRootPathIsInvalid}
          step={1}
          marks={lodashRange(2, 9).map(v => ({
            label: v.toString(),
            value: v,
          }))}
          onChange={(e, v) => handleNumFieldsChange(v)}
        />
      </FormControl>
      <FormControl error={hasError} variant="standard">
        <FormLabel>Folder Structure - Information at each level</FormLabel>
        <Box display="flex">
          <Box display="flex" flexGrow={0} alignSelf="start" alignItems="center" mr={1} minHeight="75px">
            <Typography variant="h5">sourcedata</Typography>
          </Box>
          <Box display="flex" flexWrap="wrap">
            {field.value.map((folderInfo, index) => {
              return (
                <Box display="flex" alignItems="center" key={`Box__FolderLevel__${index}`} className="Box__FolderLevel">
                  <Typography variant="h2">{"/"}</Typography>
                  <FormControl variant="outlined" error={hasError}>
                    <Select
                      variant="outlined"
                      name={field.name}
                      // disabled={StudyRootPathIsInvalid}
                      onBlur={field.onBlur}
                      value={folderInfo}
                      sx={{ minWidth: "150px", mx: 2 }}
                      onChange={e => handleFieldChange(e, index)}
                    >
                      {[
                        { label: "", value: "" },
                        { label: "Subject", value: "Subject", disabled: field.value.includes("Subject") },
                        { label: "Visit", value: "Visit", disabled: field.value.includes("Visit") },
                        { label: "Session", value: "Session", disabled: field.value.includes("Session") },
                        { label: "Scan", value: "Scan", disabled: field.value.includes("Scan") },
                        { label: "Ignore", value: "Ignore" },
                      ].map((option, index) => (
                        <MenuItem key={`SourceStructureMenuItem_${index}`} {...option}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              );
            })}
          </Box>
        </Box>
        {hasError && <FormHelperText>{fieldState.error.message}</FormHelperText>}
      </FormControl>
    </Stack>
  );
}

export default StructureByParts;
