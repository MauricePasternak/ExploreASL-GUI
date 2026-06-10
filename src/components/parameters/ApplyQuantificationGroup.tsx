import { Checkbox, Group, Button, Stack } from "@mantine/core";

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
      <Button variant="subtle" size="compact-xs" onClick={toggleAll}>
        {allChecked ? "Deselect all" : "Select all"}
      </Button>
      {LABELS.map((label, i) => (
        <Group key={label} gap="xs">
          <Checkbox
            label={label}
            checked={effective[i] === 1}
            onChange={() => toggle(i)}
          />
        </Group>
      ))}
    </Stack>
  );
}
