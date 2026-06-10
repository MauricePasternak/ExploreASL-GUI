import { Select, NumberInput, Stack } from "@mantine/core";

import { M0_OPTIONS } from "../../lib/dataParFieldMetadata";

interface M0SelectProps {
  value: string | number | undefined;
  onChange: (value: string | number) => void;
}

export function M0Select({ value, onChange }: M0SelectProps) {
  const namedValues = M0_OPTIONS.map((o) => o.value);
  const isNumber = typeof value === "number";
  const isCustom = value === "__custom__" || (isNumber && !namedValues.includes(String(value)));

  const selectValue = isCustom ? "__custom__" : (value as string) ?? null;

  return (
    <Stack gap="xs">
      <Select
        data={M0_OPTIONS}
        value={selectValue}
        onChange={(v) => {
          if (!v) return;
          if (v === "__custom__") {
            onChange("__custom__");
          } else {
            onChange(v);
          }
        }}
        placeholder="Select M0 source"
      />
      {isCustom && (
        <NumberInput
          value={isNumber ? (value as number) : undefined}
          onChange={(v) => {
            if (typeof v === "number") onChange(v);
          }}
          placeholder="Custom M0 value"
          label="Custom value"
        />
      )}
    </Stack>
  );
}
