import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader, { CardHeaderProps } from "@mui/material/CardHeader";
import FormHelperText from "@mui/material/FormHelperText";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Typography from "@mui/material/Typography";
import { isEmpty as lodashIsEmpty } from "lodash";
import React from "react";
import { Controller, FieldValues, Path } from "react-hook-form";
import { RHFFieldAndFieldStateType, RHFControlAndNameType } from "../../common/types/formTypes";
import DebouncedInput from "../DebouncedComponents/DebouncedInput";

export type ControlledCardInputMappingBaseProps = {
  title?: React.ReactNode;
  headerColor?: string;
  keysSubtitle?: React.ReactNode;
  valuesSubtitle?: React.ReactNode;
  cardHeaderProps?: Omit<CardHeaderProps, "title">;
  maxHeight?: string | number;
};

export type ControlledCardInputMappingProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = ControlledCardInputMappingBaseProps & RHFFieldAndFieldStateType<TValues, TName>;

type ControlledCardInputMappingPropsNoField<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = Omit<ControlledCardInputMappingProps<TValues, TName>, "field" | "fieldState">;

export type RHFCardInputMappingProps<
  TValues extends FieldValues,
  TName extends Path<TValues> = Path<TValues>
> = RHFControlAndNameType<TValues, TName> & ControlledCardInputMappingPropsNoField<TValues, TName>;

function ControlledCardInputMapping<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  field,
  fieldState,
  title,
  headerColor = "primary.main",
  keysSubtitle = "Keys",
  valuesSubtitle = "Values",
  maxHeight = "600px",
  cardHeaderProps,
}: ControlledCardInputMappingProps<TValues, TName>) {
  const hasError = !!fieldState.error;
  const objectEntries = Object.entries(field.value);
  const defaultCardHeaderSx: CardHeaderProps["sx"] = {
    backgroundColor: hasError ? "error.main" : headerColor,
    color: "primary.contrastText",
  };
  const { sx: cardHeaderSx = {}, ...restCardHeaderProps } = cardHeaderProps || {};

  const handleChange = (event: string | React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, key: string) => {
    const newValue = { ...field.value, ...{ [key]: typeof event === "string" ? event : event.target.value } };
    field.onChange(newValue);
  };

  console.log(`RHFCardInputMapping for ${field.name}: ${JSON.stringify(field.value)} ${field.value.length > 0}`);

  return (
    !lodashIsEmpty(field.value) && (
      <Card>
        <CardHeader title={title} sx={Object.assign(cardHeaderSx, defaultCardHeaderSx)} {...restCardHeaderProps} />
        <CardContent>
          <List sx={{ maxHeight: { maxHeight }, overflowY: "auto" }}>
            <ListItem sx={{ justifyContent: "space-between" }}>
              <Typography variant="h6">{keysSubtitle}</Typography>
              <Typography variant="h6">{valuesSubtitle}</Typography>
            </ListItem>
            {Object.entries(field.value).map(([key, value], index) => {
              return (
                <ListItem
                  key={`${index}_${key}`}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "minmax(min(100px, 100%), 0.65fr) minmax(min(200px, 100%), 1fr)",
                  }}
                  divider={index < objectEntries.length}
                >
                  <Typography variant="h6" sx={{ mr: "4rem" }}>
                    {`${key}`}
                  </Typography>
                  <DebouncedInput
                    variant="outlined"
                    fullWidth
                    debounceDelay={500}
                    value={value}
                    onBlur={field.onBlur}
                    onChange={e => handleChange(e, key)}
                  />
                </ListItem>
              );
            })}
          </List>
          {hasError && <FormHelperText error>{fieldState.error.message}</FormHelperText>}
        </CardContent>
      </Card>
    )
  );
}

function RHFCardInputMapping<TValues extends FieldValues, TName extends Path<TValues> = Path<TValues>>({
  control,
  name,
  ...controlledCardInputMappingProps
}: RHFCardInputMappingProps<TValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        return (
          <ControlledCardInputMapping field={field} fieldState={fieldState} {...controlledCardInputMappingProps} />
        );
      }}
    />
  );
}

export default RHFCardInputMapping;
