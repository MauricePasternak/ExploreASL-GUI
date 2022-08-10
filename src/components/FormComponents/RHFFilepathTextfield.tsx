import React, { useCallback, useState, useEffect, useRef } from "react";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import { Controller, FieldValues, Path } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import Box from "@mui/material/Box";
import Button, { ButtonProps } from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import ClearIcon from "@mui/icons-material/Clear";
import FormHelperText from "@mui/material/FormHelperText";
import { OpenDialogOptions } from "electron";
import { RHFFieldAndFieldStateType, RHFControlAndNameType } from "../../common/types/formTypes";

type ControlledFilepathTextFieldBaseProps = {
  filepathType: "file" | "dir" | "other" | "all";
  includeButton?: boolean;
  dialogOptions?: OpenDialogOptions;
  debounceTime?: number;
  buttonProps?: ButtonProps;
  buttonText?: string;
  onValidateDrop?: (filepath: string) => boolean | Promise<boolean>;
};

// To avoid conflict with the "field" prop coming from the Controller render
type RestrictedTextFieldProps = Omit<TextFieldProps, "name" | "value" | "onChange" | "onBlur">;

type InterDepControlledFilepathTextFieldProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledFilepathTextFieldBaseProps & RHFFieldAndFieldStateType<TValues, TName> & RestrictedTextFieldProps;

type ControlledFilepathTextFieldPropsNoField<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = Omit<InterDepControlledFilepathTextFieldProps<TValues, TName>, "field" | "fieldState">;

type RHFFilepathTextFieldProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledFilepathTextFieldPropsNoField<TValues, TName> & RHFControlAndNameType<TValues, TName>;

export function ControlledFilepathTextField<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  variant,
  helperText,
  buttonProps,
  dialogOptions,
  filepathType,
  onValidateDrop,
  includeButton = true,
  buttonText = "Browse",
  debounceTime = 500,
  ...textFieldProps
}: InterDepControlledFilepathTextFieldProps<TValues, TName>) {
  const { api } = window;
  const [innerVal, setInnerVal] = useState(field.value);
  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";
  const debouncedHandleChange = useDebouncedCallback(field.onChange, debounceTime);
  const isDialogOpened = useRef(false);
  // console.log(`RHFFilepathTextField with name ${field.name} has field.value and innerValue: `, field.value, innerVal);

  /**
   * Necessary workaround for cases where a manual `reset` is called on the form.
   * This will force the component to update.
   */
  useEffect(() => {
    if (field.value !== innerVal) {
      setInnerVal(field.value);
    }
  }, [field.value]);

  // Setup default dialog options if a dialogOptions object was not provided and a button is to be presented
  if (!dialogOptions && includeButton) {
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
   * Main handler for communicating changes to the field and updating the current inner value.
   */
  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | string) => {
    let stringVal: typeof field.value;
    if (typeof event !== "string") {
      event.persist();
      stringVal = event.target.value as typeof field.value;
    } else {
      stringVal = event as typeof field.value;
    }
    setInnerVal(stringVal);
    debouncedHandleChange(stringVal);
  };

  /**
   * Handler for dragging in a filepath
   */
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * Handler for leaving the drop areaotentially updating the innervalue. State of field.value and innerValue:
   */
  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // Early exist
      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

      const dndPath = e.dataTransfer.files[0];
      const droppedFilepathType = await api.path.getFilepathType(dndPath.path);

      // Basic Filetype Checks
      // Exit if the filepathType doesn't match the given status
      if (
        !droppedFilepathType ||
        !(
          filepathType === droppedFilepathType ||
          (filepathType === "all" && ["file", "dir", "other"].includes(droppedFilepathType))
        )
      )
        return;

      // Custom additional validation implemented, as necessary
      if (onValidateDrop) {
        const validationStatus = await onValidateDrop(dndPath.path);
        if (!validationStatus) return;
      }
      handleChange(dndPath.path);
    },
    [onValidateDrop, filepathType]
  );

  const handleDialogueClick = async () => {
    if (isDialogOpened.current) return;
    isDialogOpened.current = true;
    const { canceled, filePaths } = await api.invoke("Dialog:OpenDialog", dialogOptions);
    isDialogOpened.current = false;
    !canceled && handleChange(filePaths[0]);
  };

  return (
    <Box>
      <Box display="flex" width="100%" gap={1}>
        <TextField
          fullWidth
          {...textFieldProps}
          InputProps={{
            endAdornment: (
              <IconButton disabled={false} onClick={() => innerVal && handleChange("")}>
                <ClearIcon color={hasError ? "error" : "inherit"} />
              </IconButton>
            ),
          }}
          variant={variant}
          error={hasError}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
          onDragEnter={handleDragEnter}
          onBlur={field.onBlur}
          name={field.name}
          onChange={handleChange}
          value={innerVal}
        />
        {includeButton && (
          <Button
            variant="contained"
            disabled={textFieldProps.disabled}
            color={hasError ? "error" : buttonProps?.color ?? "primary"}
            {...buttonProps}
            onClick={handleDialogueClick}
          >
            {buttonText}
          </Button>
        )}
      </Box>
      {helperText && (
        <FormHelperText variant={variant} error={hasError}>
          {helperText}
        </FormHelperText>
      )}
      {hasError && (
        <FormHelperText variant={variant} error>
          {errorMessage}
        </FormHelperText>
      )}
    </Box>
  );
}

/**
 * An altered MaterialUI TextField that allows for filepaths to be dragged and dropped (or click-selected) within
 * and is controlled by a React Hook Form controller. Contains all the same props as a regular `TextField`, plus the
 * following props:
 *
 * @param control - The control coming from useForm to tie the component to the form state.
 * @param name - The name of the field so that the component can update the appropriate field.
 * @param includeButton - Whether or not to include a button to open the filepath dialogue.
 * @param buttonText - The text to display on the button.
 * @param buttonProps - Any props to pass to the button.
 * @param dialogOptions - The options to pass to the filepath dialogue. These are based off Electron's dialog API.
 * @param filepathType - The type of filepath to accept. Can be one of "file", "dir", "other", or "all".
 * @param onValidateDrop - A function to validate the filepath that was dropped.
 * @param debounceTime - The time to debounce the onChange event.
 */
function RHFFilepathTextField<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...controlledFilepathTextFieldProps
}: RHFFilepathTextFieldProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return (
          <ControlledFilepathTextField field={field} fieldState={fieldState} {...controlledFilepathTextFieldProps} />
        );
      }}
    />
  );
}

export default RHFFilepathTextField;
