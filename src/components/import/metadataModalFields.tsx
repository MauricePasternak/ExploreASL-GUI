import {
  Card,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Box,
  Tooltip,
  type ComboboxItem,
} from "@mantine/core";
import { Controller, type Control, type FieldPath } from "react-hook-form";
import { FieldInfoIcon } from "../FieldInfoIcon";

import {
  BIDS_FIELD_HINTS,
  type MetadataFieldHint,
} from "./metadataFieldHints";
import type { MetadataGroupFormValues } from "./metadataModalTypes";
import { CommaNumberInput, CommaArrayInput } from "../CommaNumberInput";
import { BIDS_FIELD_DESCRIPTIONS } from "./metadataFieldDescriptions";

function resolveFieldDescription(
  _hint?: MetadataFieldHint,
  extra?: string,
): string | undefined {
  return extra;
}

export function MetadataHintLegend() {
  return (
    <Stack gap={4} data-testid="metadata-hint-legend">
      <Text size="sm" c="gray.7" fw={500}>
        Required fields for ExploreASL have a red asterisk (
        <Text span c="#fa5252" fw={700}>
          *
        </Text>
        ) beside the field label.
      </Text>
    </Stack>
  );
}

type BidsFieldName = FieldPath<MetadataGroupFormValues>;

interface BidsFieldLabelProps {
  label: string;
  fieldName: string;
}

export function BidsFieldLabel({ label, fieldName }: BidsFieldLabelProps) {
  const key = (
    fieldName.startsWith("bidsParams.") ? fieldName.slice("bidsParams.".length) : fieldName
  ) as keyof typeof BIDS_FIELD_DESCRIPTIONS;

  const description = BIDS_FIELD_DESCRIPTIONS[key];
  const isRequired = BIDS_FIELD_HINTS[key] === "important";

  if (!description) {
    return (
      <Text size="sm" fw={500} span>
        {label}
        {isRequired && (
          <Text span c="#fa5252" fw={700} style={{ marginLeft: "4px" }}>
            *
          </Text>
        )}
      </Text>
    );
  }

  return (
    <Group gap={6} align="center" style={{ display: "inline-flex", verticalAlign: "middle" }}>
      <Text size="sm" fw={500} span>
        {label}
        {isRequired && (
          <Text span c="#fa5252" fw={700} style={{ marginLeft: "4px" }}>
            *
          </Text>
        )}
      </Text>
      <Tooltip
        label={description}
        multiline
        w={320}
        withArrow
        withinPortal
        transitionProps={{ duration: 0 }}
        openDelay={0}
        closeDelay={0}
      >
        <FieldInfoIcon aria-label={`Info for ${label}`} />
      </Tooltip>
    </Group>
  );
}

interface MetadataSectionCardProps {
  title: string;
  testId: string;
  children: React.ReactNode;
}

export function MetadataSectionCard({ title, testId, children }: MetadataSectionCardProps) {
  return (
    <Card withBorder p="md" data-testid={testId} style={{ overflow: "visible" }}>
      <Stack gap="sm">
        <Text fw={600} size="sm">
          {title}
        </Text>
        {children}
      </Stack>
    </Card>
  );
}

interface BidsSelectFieldProps {
  control: Control<MetadataGroupFormValues>;
  name: BidsFieldName;
  label: string;
  data: ComboboxItem[] | string[];
  hint?: MetadataFieldHint;
  testId?: string;
}

export function BidsSelectField({
  control,
  name,
  label,
  data,
  hint,
  testId,
}: BidsSelectFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Select
          label={<BidsFieldLabel label={label} fieldName={name} />}
          description={resolveFieldDescription(hint)}
          data={data}
          value={(field.value as string | undefined) ?? null}
          onChange={field.onChange}
          clearable
          error={fieldState.error?.message}
          comboboxProps={{ withinPortal: false }}
          data-testid={testId}
        />
      )}
    />
  );
}

interface BidsNumberFieldProps {
  control: Control<MetadataGroupFormValues>;
  name: BidsFieldName;
  label: string;
  decimalScale?: number;
  min?: number;
  hint?: MetadataFieldHint;
  testId?: string;
}

export function BidsNumberField({
  control,
  name,
  label,
  decimalScale = 3,
  min,
  hint,
  testId,
}: BidsNumberFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <NumberInput
          label={<BidsFieldLabel label={label} fieldName={name} />}
          description={resolveFieldDescription(hint)}
          value={typeof field.value === "number" ? field.value : ""}
          onChange={(value) =>
            field.onChange(typeof value === "number" ? value : undefined)
          }
          decimalScale={decimalScale}
          min={min}
          error={fieldState.error?.message}
          data-testid={testId}
        />
      )}
    />
  );
}

interface BidsCheckboxFieldProps {
  control: Control<MetadataGroupFormValues>;
  name: BidsFieldName;
  label: string;
  hint?: MetadataFieldHint;
  testId?: string;
}

export function BidsCheckboxField({
  control,
  name,
  label,
  hint,
  testId,
}: BidsCheckboxFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Checkbox
          label={<BidsFieldLabel label={label} fieldName={name} />}
          description={resolveFieldDescription(hint)}
          checked={(field.value as boolean | undefined) ?? false}
          onChange={(event) => field.onChange(event.currentTarget.checked)}
          data-testid={testId}
        />
      )}
    />
  );
}

interface BidsTextFieldProps {
  control: Control<MetadataGroupFormValues>;
  name: BidsFieldName;
  label: string;
  placeholder?: string;
  hint?: MetadataFieldHint;
  testId?: string;
}

export function BidsTextField({
  control,
  name,
  label,
  placeholder,
  hint,
  testId,
}: BidsTextFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInput
          label={<BidsFieldLabel label={label} fieldName={name} />}
          placeholder={placeholder}
          description={resolveFieldDescription(hint)}
          value={(field.value as string | undefined) ?? ""}
          onChange={field.onChange}
          error={fieldState.error?.message}
          data-testid={testId}
        />
      )}
    />
  );
}

interface BidsCommaNumberFieldProps {
  control: Control<MetadataGroupFormValues>;
  name: BidsFieldName;
  label: string;
  hint?: MetadataFieldHint;
  description?: string;
  testId?: string;
}

/** Number or comma-separated number array (BIDS fields like PostLabelingDelay). */
export function BidsCommaNumberField({
  control,
  name,
  label,
  hint,
  description,
  testId,
}: BidsCommaNumberFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <CommaNumberInput
          label={<BidsFieldLabel label={label} fieldName={name} />}
          description={resolveFieldDescription(
            hint,
            description ?? "Comma-separated for multiple values",
          )}
          value={field.value as number | number[] | undefined}
          onChange={field.onChange}
          error={fieldState.error?.message}
          testId={testId}
        />
      )}
    />
  );
}

interface BidsCommaArrayFieldProps {
  control: Control<MetadataGroupFormValues>;
  name: BidsFieldName;
  label: string;
  hint?: MetadataFieldHint;
  description?: string;
  testId?: string;
}

/** Comma-separated numeric array only. */
export function BidsCommaArrayField({
  control,
  name,
  label,
  hint,
  description,
  testId,
}: BidsCommaArrayFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <CommaArrayInput
          label={<BidsFieldLabel label={label} fieldName={name} />}
          description={resolveFieldDescription(
            hint,
            description ?? "Comma-separated numbers",
          )}
          value={field.value as number[] | undefined}
          onChange={field.onChange}
          error={fieldState.error?.message}
          testId={testId}
        />
      )}
    />
  );
}
