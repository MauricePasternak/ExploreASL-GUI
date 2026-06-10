import { Checkbox, Group, Stack, Text } from "@mantine/core";

import { DataParFieldLabel } from "./DataParFieldLabel";

const LABELS = [
  "Apply ScaleSlopes ASL4D",
  "Apply ScaleSlopes M0",
  "Convert PWI a.u. to label",
  "Quantify M0 a.u.",
  "Perform division by M0",
  "Apply all scaling",
];

interface ApplyQuantificationGroupProps {
  value: number[] | undefined;
  onChange: (value: number[]) => void;
}

export function ApplyQuantificationGroup({ value, onChange }: ApplyQuantificationGroupProps) {
  const effective = value ?? [1, 1, 1, 1, 1, 1];
  const allChecked = effective.every((v) => v === 1);

  const toggle = (index: number) => {
    const next = [...effective];
    next[index] = next[index] === 1 ? 0 : 1;
    onChange(next);
  };

  const toggleAll = () => {
    onChange(allChecked ? [0, 0, 0, 0, 0, 0] : [1, 1, 1, 1, 1, 1]);
  };

  return (
    <Stack gap="xs">
      <Group gap="xs" align="center">
        <Text size="sm" fw={500}>
          <DataParFieldLabel fieldKey="ApplyQuantification" />
        </Text>
        <Checkbox
          label={allChecked ? "Deselect all" : "Select all"}
          checked={allChecked}
          onChange={toggleAll}
          size="xs"
          data-testid="toggle-all-apply-quantification"
        />
      </Group>
      {LABELS.map((label, i) => (
        <Checkbox
          key={label}
          label={label}
          checked={effective[i] === 1}
          onChange={() => toggle(i)}
          data-testid={`checkbox-applyQuantification-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        />
      ))}
    </Stack>
  );
}
