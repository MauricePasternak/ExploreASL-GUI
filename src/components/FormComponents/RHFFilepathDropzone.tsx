import React, { useRef, useState, useEffect } from "react";
import { OpenDialogOptions } from "electron";
import { Controller, FieldValues, Path, PathValue, UseFormStateReturn } from "react-hook-form";
import { styled } from "@mui/material/styles";
import Paper from "@mui/material/Paper";
import FormControl, { FormControlProps } from "@mui/material/FormControl";
import Button, { ButtonProps } from "@mui/material/Button";
import Box, { BoxProps } from "@mui/material/Box";
import FormLabel from "@mui/material/FormLabel";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import IconButton from "@mui/material/IconButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import DeleteIcon from "@mui/icons-material/Delete";
import FormHelperText from "@mui/material/FormHelperText";
import { RHFFieldAndFieldStateType, RHFFieldValueType, RHFControlAndNameType } from "../../common/types/formTypes";
import FastIsEqual from "fast-deep-equal";

type ControlledFilepathDropzoneBaseProps<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>> = {
  /**
   * The type of filepaths that this dropzone will accept.
   */
  filepathType: "file" | "dir" | "other" | "all";
  /**
   * Electron dialog options. By default, the `properties` property is set to "openFile" or "openDirectory"
   * depending on the value of `filepathType`.
   */
  dialogOptions?: OpenDialogOptions;
  /**
   * Whether the existing filepath values should be cleared on each drop/dialogue-confirmation.
   * @default false -- existing filepath values are not cleared.
   */
  overWrite?: boolean;
  /**
   * Whether only the basenames of filepaths should be taken into account.
   * @default false -- full paths are taken into account.
   */
  baseNamesOnly?: boolean;
  /**
   * The label to display above the dropzone.
   */
  label?: string;
  /**
   * The text that should be visible when no filepaths have been dropped in yet.
   * @default "Drop Filepaths Here"
   */
  placeholderText?: string | React.ReactNode;
  /**
   * Additional text located between any error messages and the main body of the component, which should give a short
   * description of what the component does in the scheme of the application.
   */
  helperText?: string | React.ReactNode;
  /**
   * A function to use when converting from the form field value into this component's string array inner value.
   */
  handleFieldToInnerVal?: (fieldValue: RHFFieldValueType<TValues, TName>, ...args: any[]) => string[];
  /**
   * A function to use when converting from this component's inner string array value to the form field value.
   */
  handleInnerValToField?: (innerVal: string[], ...args: any[]) => RHFFieldValueType<TValues, TName>;
  /**
   * An optional additional function to use to filter out unwanted file paths. Is expected to take in a string filepath (full absolute path)
   * and return true if the filepath should be included in the list of file paths.
   */
  extraFilterFunction?: (filepath: string, ...args: any[]) => boolean | Promise<boolean>;
  /**
   * Props to pass to the FormControl outermost component
   */
  formControlProps?: Omit<FormControlProps, "error">;
  /**
   * Additional props to pass to the penultimate bottom dialog button.
   */
  browseButtonProps?: ButtonProps;
  /**
   * Text to display on the button which opens the file dialog.
   * @default "Browse"
   */
  browseButtonText?: string;
  /**
   * Additional props to pass to the bottom clear MUI button
   */
  clearButtonProps?: ButtonProps;
  /**
   * Text to display on the lower clear button.
   * @default "Clear"
   */
  clearButtonText?: string;
};

type ControlledFilepathDropzoneProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledFilepathDropzoneBaseProps<TValues, TName> & RHFFieldAndFieldStateType<TValues, TName> & BoxProps;

type ControlledFilepathDropzonePropsNoField<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = Omit<ControlledFilepathDropzoneProps<TValues, TName>, "field" | "fieldState" | "formState">;

type RHFFilepathDropzoneProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledFilepathDropzonePropsNoField<TValues, TName> & RHFControlAndNameType<TValues, TName>;

const customGradient =
  "linear-gradient(60deg, hsl(224, 85%, 66%), hsl(269, 85%, 66%), hsl(314, 85%, 66%), hsl(359, 85%, 66%), hsl(44, 85%, 66%), hsl(89, 85%, 66%), hsl(134, 85%, 66%), hsl(179, 85%, 66%))";

const DropzonePaper = styled(Paper, { shouldForwardProp: p => p !== "hasError" && p !== "isAcceptingDrop" })<{
  hasError: boolean;
  isAcceptingDrop: boolean;
  borderWidth?: number | string;
}>(({ theme, hasError, isAcceptingDrop, borderWidth = "4px" }) => {
  return {
    padding: "8px",
    maxHeight: 620,
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

function ControlledFilepathDropzone<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  filepathType,
  dialogOptions,
  baseNamesOnly = false,
  overWrite = false,
  label,
  extraFilterFunction,
  handleFieldToInnerVal,
  handleInnerValToField,
  formControlProps,
  placeholderText = "Drop Filepaths Here",
  helperText,
  browseButtonProps,
  clearButtonProps,
  browseButtonText = "Browse",
  clearButtonText = "Clear",
  ...boxProps
}: ControlledFilepathDropzoneProps<TValues, TName>) {
  const [innerVal, setInnerVal] = useState(() =>
    handleFieldToInnerVal ? handleFieldToInnerVal(field.value) : field.value
  );
  const { api } = window;
  const hasError = !!fieldState.error;
  const [isAcceptingDrop, setIsAcceptingDrop] = React.useState(false);
  const enterCounter = useRef(0); // We use this to keep track of enter/exit drop state
  const isDialogOpened = useRef(false); // We use this to keep track of dialog state

  // console.log(
  //   `RHFFIlepathDropzone with fieldname ${field.name} has rendered with value and innerValue:`,
  //   field.value,
  //   innerVal
  // );


  useEffect(() => {
    if (field.value != null && !FastIsEqual(field.value, innerVal)) {
      setInnerVal(() => (handleFieldToInnerVal ? handleFieldToInnerVal(field.value) : field.value));
    }
  }, [JSON.stringify(field.value)]);

  // Setup default dialog options if a dialogOptions object was not provided and a button is to be presented
  if (!dialogOptions) {
    dialogOptions = {
      properties:
        filepathType === "all"
          ? ["openFile", "openDirectory"]
          : filepathType === "file"
          ? ["openFile"]
          : ["openDirectory"],
    };
  }

  // Sanity checks regarding the dialogOptions object
  if (dialogOptions && filepathType === "file" && dialogOptions.properties.includes("openDirectory")) {
    throw new Error("RHFFilepathTextField: Cannot use openDirectory with filepathType=file");
  }
  if (dialogOptions && filepathType === "dir" && dialogOptions.properties.includes("openFile")) {
    throw new Error("RHFFilepathTextField: Cannot use openFile with filepathType=dir");
  }

  /**
   * Utility function to ensure that the encountered filepath fits the requirement of the `filepathType`
   */
  const filterFiles = async (files: Array<File | string>) => {
    const filteredList = [];

    for (let index = 0; index < files.length; index++) {
      const element = files[index];
      const filepath = typeof element === "string" ? element : element.path;
      const pathType = await api.path.getFilepathType(filepath);

      // Basic filtering; the determined path type must be compatible with the filepathType prop
      if (
        !pathType || // Filepath doesn't exist
        (pathType === "file" && !["file", "all"].includes(filepathType)) || // File type when not requested
        (pathType === "dir" && !["dir", "all"].includes(filepathType)) || // Dir type when not requested
        (pathType === "other" && !["other", "all"].includes(filepathType)) // Other type when not requested
      ) {
        continue;
      }

      // Apply user-specified additional validation
      if (extraFilterFunction && !(await extraFilterFunction(filepath))) continue;

      // Finally, if all is clear, append the appropriate fullpath or basename to the filteredList
      filteredList.push(baseNamesOnly ? api.path.getBasename(filepath) : filepath);
    }
    return filteredList;
  };

  /**
   * Handler for entering with a filepath object. Counter is incremented on enter, decremented on exit and the element
   * is re-rendered to show the accepting state.
   */
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement | HTMLLIElement>) => {
    e.preventDefault();
    e.stopPropagation();
    enterCounter.current++;
    !isAcceptingDrop && setIsAcceptingDrop(true);
  };

  /**
   * Required handlier for persisting the droppable state
   */
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  /**
   * Handler for exiting with a filepath object. Counter is decremented on exit. Only re-render if the counter is 0 to
   * indicate a true exit has occurred. A ref is used to keep track of this, otherwise the element's re-rendering would
   * not be able to capture the exit event if it is too quick.
   */
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement | HTMLLIElement>) => {
    e.preventDefault();
    e.stopPropagation();
    enterCounter.current--;
    if (enterCounter.current === 0) {
      isAcceptingDrop && setIsAcceptingDrop(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement | HTMLLIElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const filePaths = Array.from(e.dataTransfer.files);
    // console.log("filePaths", filePaths);
    const filteredList: string[] = await filterFiles(filePaths);
    const finalItemset = overWrite ? filteredList : [...innerVal, ...filteredList];
    // console.log(finalItemset);
    handleChange(finalItemset as PathValue<TValues, TName>);
  };

  /**
   * Handler for communicating a valid filepath(s) drop/dialog-submission to the form.
   * Updates the innerVal state, communicates the value to the form, and resets the drop counter/state to default.
   * @param newValue The new value to set.
   */
  const handleChange = (newValue: string[]) => {
    setInnerVal(newValue);
    field.onChange(handleInnerValToField ? handleInnerValToField(newValue) : newValue);
    field.onBlur();
    enterCounter.current = 0;
    isAcceptingDrop && setIsAcceptingDrop(false);
  };

  const handleDialog = async () => {
    if (isDialogOpened.current) return;
    if (!dialogOptions) throw new Error("dialogOptions were not specified");

    // Get the filepaths from the dialog and early exit if no files were selected
    isDialogOpened.current = true;
    const { canceled, filePaths } = await api.invoke("Dialog:OpenDialog", dialogOptions);
    isDialogOpened.current = false;
    if (canceled) return;

    // Filter the filepaths and update the innerVal state
    const filteredList = await filterFiles(filePaths);
    const finalItemset = overWrite ? filteredList : [...innerVal, ...filteredList];
    handleChange(finalItemset as PathValue<TValues, TName>);
  };

  const handleDelete = (index: number) => {
    const newValue = innerVal.filter((_: unknown, i: number) => i !== index);
    handleChange(newValue);
  };

  return (
    <FormControl fullWidth variant="standard" {...formControlProps} error={hasError}>
      <FormLabel className="FPDropZone__Label">{label}</FormLabel>
      <DropzonePaper className="FPDropZone__Paper" elevation={2} hasError={hasError} isAcceptingDrop={isAcceptingDrop}>
        <Box
          className="FPDropZone__Dropzone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDragEnter={handleDragEnter}
          sx={{
            width: "100%",
            height: "clamp(400px, 500px, 600px)",
            borderRadius: "8px",
            backgroundColor: theme =>
              theme.palette.mode === "dark" ? theme.palette.background.default : theme.palette.grey[100],
            marginBottom: "8px",
            position: "relative",
          }}
          {...boxProps}
          overflow="auto"
        >
          <List>
            {innerVal.map((listItem, idx) => (
              <ListItem
                key={`${listItem}_${idx}`}
                divider={idx !== innerVal.length - 1}
                secondaryAction={
                  <IconButton onClick={() => handleDelete(idx)}>
                    <DeleteIcon />
                  </IconButton>
                }
              >
                <ListItemText primary={<Typography noWrap>{listItem}</Typography>} />
              </ListItem>
            ))}
          </List>
          {innerVal.length === 0 && (
            <Typography
              variant="subtitle1"
              sx={{
                fontSize: "1.5rem",
                color: theme => theme.palette.text.secondary,
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                textAlign: "center",
              }}
            >
              {placeholderText}
            </Typography>
          )}
        </Box>
        {dialogOptions && (
          <Button
            sx={{ borderRadius: "12px", mb: 0.5 }}
            color={hasError ? "error" : "primary"}
            fullWidth
            variant="contained"
            {...browseButtonProps}
            onClick={handleDialog}
          >
            {browseButtonText}
          </Button>
        )}
        <Button
          sx={{ borderRadius: "12px" }}
          color={hasError ? "error" : "warning"}
          fullWidth
          variant="contained"
          {...clearButtonProps}
          onClick={() => {
            innerVal.length > 0 && handleChange([]);
          }}
        >
          {clearButtonText}
        </Button>
      </DropzonePaper>
      <FormHelperText>{helperText}</FormHelperText>
      {hasError && <FormHelperText>{fieldState.error.message}</FormHelperText>}
    </FormControl>
  );
}

/**
 * A complex wrapper component around Material UI Paper and List components which mimics a Dropzone type of component.
 * This component is used to allow the user to drag and drop files into the component or add them through a dialog window.
 * @param filepathType The type of filepaths to accept. One of "file", "directory", or "any".
 * @param dialogOptions The options to pass to the Electron dialog window.
 * @param baseNamesOnly Whether to only consider the basenames of filepaths for representation and form value submission.
 * Defaults to false.
 * @param overWrite Whether a new drop should overwrite the current file values.
 * Defaults to false.
 * @param placeholderText The text to display in the dropzone when no files are present.
 * Defaults to "Drop Filepaths Here".
 * @param extraFilterFunction A function to filter the filepaths before they are added to the list.
 * @param handleInnerValToField A function to convert the innerVal to the form value.
 * @param handleFieldToInnerVal A function to convert the form value to the innerVal.
 * @param browseButtonText The text to display on the browse button. Defaults to "Browse".
 * @param clearButtonText The text to display on the clear button. Defaults to "Clear".
 * @param browseButtonProps The props to pass to the browse button.
 * @param clearButtonProps The props to pass to the clear button.
 * @param formControlProps The props to pass to the Material UI FormControl wrapper component.
 * @param label The label to display above the dropzone.
 * @param helperText The helper text to display below the dropzone.
 * @param ...boxProps All other props to pass to the Box component housing the `List` of filepaths.
 */
function RHFFilepathDropzone<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...controlledFilepathDropzoneProps
}: RHFFilepathDropzoneProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState, formState }) => {
        return (
          <ControlledFilepathDropzone field={field} fieldState={fieldState} {...controlledFilepathDropzoneProps} />
        );
      }}
    />
  );
}

export default RHFFilepathDropzone;
