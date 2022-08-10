import ClearIcon from "@mui/icons-material/Clear";
import Box from "@mui/material/Box";
import Button, { ButtonProps } from "@mui/material/Button";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import { OpenDialogOptions } from "electron";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Controller, FieldValues, Path } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { RHFFieldAndFieldStateType, RHFInterDepBaseProps, RHFTriggerType } from "../../common/types/formTypes";

type ControlledInterDepFPTextFieldBaseProps = {
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
> = RHFFieldAndFieldStateType<TValues, TName> & // field and fieldState
  RHFTriggerType<TValues, TName> & // trigger and triggerTarget
  ControlledInterDepFPTextFieldBaseProps &
  RestrictedTextFieldProps;

type ControlledFilepathTextFieldPropsNoField<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = Omit<InterDepControlledFilepathTextFieldProps<TValues, TName>, "field" | "fieldState">;

type RHFFilepathTextFieldProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledFilepathTextFieldPropsNoField<TValues, TName> & RHFInterDepBaseProps<TValues, TName>;

export function InterDepControlledFilepathTextField<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
>({
  field,
  fieldState,
  trigger,
  triggerTarget,
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
  const isDialogOpened = useRef(false);

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
    throw new Error("RHFInterdepFilepathTextField: Cannot use openDirectory with filepathType=file");
  }
  if (dialogOptions && filepathType === "dir" && dialogOptions.properties.includes("openFile")) {
    throw new Error("RHFInterdepFilepathTextField: Cannot use openFile with filepathType=dir");
  }

  /**
   * useEffect handler for responding to external changes to `field.value`
   * 1) Updates the internal value if it doesn't match field.value
   * 2) Triggers the validation of other fields
   */
  useEffect(() => {
    if (field.value === innerVal) return;

    // Update self and trigger target validation
    console.log(`InterdepFPTextfield ${field.name} is syncing with field.value and triggering ${triggerTarget}`);
    setInnerVal(field.value);
    trigger(triggerTarget);
  }, [field.value]);

  /**
   * Debounced callback for updating the field.value and triggering validation in targets
   */
  const debouncedHandleChange = useDebouncedCallback((values: any) => {
    field.onChange(values);
    trigger(triggerTarget);
  }, debounceTime);

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
 * and is controlled by a RHF. This component triggers the validation of other fields:
 *
 * Fundamental Properties:
 * - `control` - the RHF control object returned by useForm().
 * - `name` - the name of the field this component is responsible for.
 * - `trigger` - the RHF trigger function returned by useForm().
 * - `triggerTarget` - the name of the field(s) to trigger validation on when this form changes.
 * ---
 *
 * Additional Properties:
 * - `includeButton` - Whether or not to include a button to open the filepath dialogue.
 * - `buttonText` - The text to display on the button.
 * - `buttonProps` - Any props to pass to the button.
 * - `dialogOptions` - The options to pass to the filepath dialogue. These are based off Electron's dialog API.
 * - `filepathType` - The type of filepath to accept. Can be one of "file", "dir", "other", or "all".
 * - `onValidateDrop` - A function to validate the filepath that was dropped.
 * - `debounceTime` - The time to debounce the onChange event.
 */
function RHFInterDepFilepathTextField<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
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
          <InterDepControlledFilepathTextField
            field={field}
            fieldState={fieldState}
            {...controlledFilepathTextFieldProps}
          />
        );
      }}
    />
  );
}

export default RHFInterDepFilepathTextField;
