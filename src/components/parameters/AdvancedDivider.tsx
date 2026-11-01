import { Divider, Group, Switch } from "@mantine/core";

interface AdvancedDividerProps {
  showAdvanced: boolean;
  onToggle: () => void;
  testId?: string;
}

export function AdvancedDivider({
  showAdvanced,
  onToggle,
  testId = "show-advanced-toggle",
}: AdvancedDividerProps) {
  return (
    <Group gap="xs" align="center">
      <Divider style={{ flex: 1 }} />
      <Switch
        label="Show advanced"
        checked={showAdvanced}
        onChange={onToggle}
        data-testid={testId}
      />
    </Group>
  );
}
