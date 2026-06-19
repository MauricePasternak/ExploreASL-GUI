import { Divider, Group, Switch } from "@mantine/core";

interface AdvancedDividerProps {
  showAdvanced: boolean;
  onToggle: () => void;
}

export function AdvancedDivider({ showAdvanced, onToggle }: AdvancedDividerProps) {
  return (
    <Group gap="xs" align="center">
      <Divider style={{ flex: 1 }} />
      <Switch label="Show advanced" checked={showAdvanced} onChange={onToggle} />
    </Group>
  );
}
