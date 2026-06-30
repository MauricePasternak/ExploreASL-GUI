import { Group, NumberInput } from "@mantine/core";

export interface NumberTupleInputProps {
  value: [number, number, number] | undefined;
  onChange: (v: [number, number, number]) => void;
  /** Axis labels; defaults to ["X", "Y", "Z"]. Also used for testid suffixes. */
  labels?: [string, string, string];
  testId?: string;
  min?: number;
  /** Restrict input to integers (strips decimals on change). */
  integerOnly?: boolean;
  suffix?: string;
  placeholder?: [number, number, number];
}

const DEFAULT_LABELS: [string, string, string] = ["X", "Y", "Z"];

export function NumberTupleInput({
  value,
  onChange,
  labels = DEFAULT_LABELS,
  testId,
  min = 0,
  integerOnly = false,
  suffix,
  placeholder,
}: NumberTupleInputProps) {
  const tuple: [number, number, number] = value ?? [0, 0, 0];

  const updateIndex = (index: number, inputValue: number | string) => {
    let num: number;
    if (typeof inputValue === "number") {
      num = inputValue;
    } else {
      const parsed = parseFloat(inputValue);
      num = isNaN(parsed) ? 0 : parsed;
    }
    if (integerOnly) num = Math.trunc(num);
    const next = [...tuple] as [number, number, number];
    next[index] = num;
    onChange(next);
  };

  return (
    <Group gap="xs" align="flex-end">
      {labels.map((label, i) => {
        const testIdSuffix = labels === DEFAULT_LABELS ? label : String(i);
        return (
          <NumberInput
            key={label}
            label={label}
            value={value ? tuple[i] : undefined}
            onChange={(v) => updateIndex(i, v ?? 0)}
            size="xs"
            w={80}
            min={min}
            suffix={suffix}
            placeholder={placeholder?.[i]?.toString()}
            data-testid={testId ? `${testId}-${testIdSuffix}` : undefined}
          />
        );
      })}
    </Group>
  );
}
