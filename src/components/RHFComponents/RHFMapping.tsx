import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CardHeader, { CardHeaderProps } from "@mui/material/CardHeader";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { SxProps } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import React from "react";
import { FieldValues, Path, useController, useWatch } from "react-hook-form";
import { RHFControllerProps, RHFTriggerProps, RHFWatchProps, SingleFieldValueType } from "../../common/types/formTypes";
import { DebouncedInput } from "../DebouncedComponents";

type RHFMappingBaseProps = {
  title?: React.ReactNode;
  keysSubtitle?: React.ReactNode;
  valuesSubtitle?: React.ReactNode;
  helperText?: React.ReactNode; // helper text for the whole mapping
  cardHeaderProps?: Omit<CardHeaderProps, "title" | "subheader">;
  headerColor?: string;
  maxHeight?: number | string;
} & (
  | {
      type: "select";
      options: {
        value: string | number | readonly string[] | undefined;
        label: React.ReactNode;
        disabled?: boolean;
      }[]; // options to display in the select
    }
  | {
      type: "textfield";
      options?: never;
    }
);

export type RHFMappingProps<
  TFV extends FieldValues,
  TName extends Path<TFV>,
  TTrigger extends Path<TFV>,
  TWatch extends Path<TFV> | readonly Path<TFV>[]
> = RHFMappingBaseProps & // options
  RHFControllerProps<TFV, TName> & // name, control
  RHFTriggerProps<TFV, TTrigger> & // trigger & triggerTarget
  RHFWatchProps<TFV, TWatch>; // watchTarget & onWatchedChange

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
export function RHFMapping<
  TFV extends FieldValues,
  TName extends Path<TFV>,
  TTrigger extends Path<TFV>,
  TWatch extends Path<TFV> | readonly Path<TFV>[]
>({
  name,
  control,
  trigger,
  triggerTarget,
  watchTarget,
  onWatchedChange,
  type,
  title,
  keysSubtitle,
  valuesSubtitle,
  maxHeight = "600px",
  helperText, // helper text for the whole mapping
  cardHeaderProps, // options for the CardHeader component
  headerColor = "primary.main", // color for the CardHeader component
  ...props
}: RHFMappingProps<TFV, TName, TTrigger, TWatch>) {
  // RHF Variables
  const { field, fieldState } = useController({ name, control });

  // Sanity Check for field.value
  if (field.value == null || typeof field.value !== "object") {
    throw new Error(
      `Encountered an error for RHFMapping in field ${field.name}. Expected field value to be an object, but got ${field.value}`
    );
  }

  const hasError = !!fieldState.error;
  const errorMessage = hasError ? fieldState.error?.message : "";

  // Watch-related variables
  const isWatching = watchTarget && onWatchedChange;
  const watchParams = isWatching ? { control, name: watchTarget } : { control };
  const watchedValue = useWatch(watchParams);

  // Inner State
  const mappingEntries = Object.entries(field.value); // convert to array of [key, value] pairs

  /** Handler for changes coming from rendered Select child components */
  const handleSelectChange = (v: unknown, key: string) => {
    console.log(`handleSelectChange: ${key} = ${v}`); // v is a string or number or undefined
    const newValues = { ...field.value, [key]: v }; // create new object with updated value
    field.onChange(newValues); // update field value
    trigger && trigger(triggerTarget); // trigger any target validation fields
  };

  /** Handler for changes coming from rendered DebouncedInput components */
  const handleTextFieldChange = (v: string, key: string) => {
    const newValues = { ...field.value, [key]: v }; // create new object with updated value
    field.onChange(newValues); // update the field value
    trigger && trigger(triggerTarget); // trigger the validation
  };

  // Fix sx prop for the CardHeader component
  const { sx: cardHeaderSx, ...cardHeaderPropsWithoutSx } = cardHeaderProps || {}; // extract sx prop from cardHeaderProps
  const defaultCardHeaderSx: CardHeaderProps["sx"] = {
    backgroundColor: hasError ? "error.main" : headerColor,
    color: "primary.contrastText",
    "& .MuiCardHeader-subheader": {
      color: "primary.contrastText", // helper text for the whole mapping
    },
  };
  const fixedHeaderSx: CardHeaderProps["sx"] = { ...defaultCardHeaderSx, ...cardHeaderSx }; // merge default and custom sx props

  /** Handler for rendering the keys subtitle */
  function renderKeysSubtitle() {
    return typeof keysSubtitle === "string" ? (
      <Typography className="RHFMapping__FirstRow__KeyTitle" variant="h6">
        {keysSubtitle}
      </Typography>
    ) : (
      keysSubtitle
    );
  }

  /** Handler for rendering the values subtitle */
  function renderValuesSubtitle() {
    return typeof valuesSubtitle === "string" ? (
      <Typography className="RHFMapping__FirstRow__ValueTitle" variant="h6">
        {valuesSubtitle}
      </Typography>
    ) : (
      valuesSubtitle
    );
  }

  function render() {
    return (
      <Card className="RHFMapping__Card">
        {title && (
          <CardHeader
            className="RHFMapping__CardHeader"
            title={title}
            subheader={helperText} // helper text for the whole mapping
            sx={fixedHeaderSx}
            {...cardHeaderPropsWithoutSx} // merge sx props
          />
        )}
        <CardContent className="RHFMapping__CardContent">
          <List className="RHFMapping__List" sx={{ maxHeight: { maxHeight }, overflowY: "auto" }}>
            {(keysSubtitle || valuesSubtitle) && (
              <ListItem className="RHFMapping__FirstRow__ListItem" sx={{ justifyContent: "space-between" }}>
                {renderKeysSubtitle()}
                {renderValuesSubtitle()}
              </ListItem>
            )}
            {mappingEntries.map(([key, value], index) => {
              return (
                <ListItem
                  key={`RHFMapping__ListItem__${index}`}
                  className="RHFMapping__ListItem"
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "minmax(min(100px, 100%), 0.5fr) minmax(min(200px, 100%), 1fr)",
                  }}
                  divider={index < mappingEntries.length - 1}
                >
                  <Typography
                    className="RHFMapping__Key__Typography"
                    sx={{ marginRight: "10px", wordWrap: "break-word" }}
                  >
                    {key}
                  </Typography>
                  {type === "select" ? (
                    <Select
                      className="RHFMapping__Value__Select"
                      value={value}
                      onChange={(e) => handleSelectChange(e.target.value, key)}
                    >
                      {props.options?.map((option, optionIndex) => (
                        <MenuItem
                          className="RHFMapping__Value__MenuItem"
                          key={`RHFMapping__Value__MenuItem__${optionIndex}`}
                          value={option.value}
                        >
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  ) : (
                    <DebouncedInput
                      className="RHFMapping__Value__TextField"
                      fullWidth
                      value={value as string}
                      type="text"
                      onChange={(v) => handleTextFieldChange(v, key)}
                    />
                  )}
                </ListItem>
              );
            })}
          </List>
        </CardContent>
        {hasError && (
          <CardActions className="RHFMapping__CardActions">
            <Typography className="RHFMapping__ErrorText" color="error">
              {errorMessage}
            </Typography>
          </CardActions>
        )}
      </Card>
    );
  }

  return isWatching ? (onWatchedChange(watchedValue as SingleFieldValueType<TFV, TWatch>) ? render() : null) : render();
}
