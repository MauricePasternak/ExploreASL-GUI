import { Checkbox, Group, Stack, Text } from "@mantine/core";

import { DataParFieldLabel } from "./DataParFieldLabel";

const QUANTIFICATION_STEP_LABELS = [
  "Apply pixel intensity scaling to ASL timeseries",
  "Apply pixel intensity scaling to M0 image",
  "Convert perfusion-weighted signal to label volume",
  "Calibrate M0 intensity (correct T1 relaxation)",
  "Divide perfusion signal by M0",
  "Apply global scaling factors to final CBF map",
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
      {QUANTIFICATION_STEP_LABELS.map((label, i) => (
        <Checkbox
          key={label}
          label={label}
          checked={effective[i] === 1}
          onChange={() => toggle(i)}
          data-testid={`checkbox-applyQuantification-${i}`}
        />
      ))}
    </Stack>
  );
}
