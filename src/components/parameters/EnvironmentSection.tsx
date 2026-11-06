import { Switch, Stack, Group, Text, SimpleGrid } from "@mantine/core";
import { IconTerminal2 } from "@tabler/icons-react";

import type { DataParState } from "../../schemas/dataParSchema";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { PARAMETER_SWITCH_DEFAULTS } from "../../generated/bindings";

interface EnvironmentSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export function EnvironmentSection({ dataPar, onFieldChange }: EnvironmentSectionProps) {
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <IconTerminal2 size={18} style={{ color: "var(--mantine-color-grape-6)" }} />
        <Text fw={600} size="sm">
          Tool & Environment Auto-Detection
        </Text>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Group gap="xs" align="center" style={{ minHeight: "36px" }}>
          <Switch
            id="switch-bAutomaticallyDetectFSL"
            checked={
              dataPar.bAutomaticallyDetectFSL ?? PARAMETER_SWITCH_DEFAULTS.bAutomaticallyDetectFSL
            }
            onChange={(e) => onFieldChange("bAutomaticallyDetectFSL", e.currentTarget.checked)}
            data-testid="field-bAutomaticallyDetectFSL"
          />
          <DataParFieldLabel
            fieldKey="bAutomaticallyDetectFSL"
            htmlFor="switch-bAutomaticallyDetectFSL"
          />
        </Group>

        <Group gap="xs" align="center" style={{ minHeight: "36px" }}>
          <Switch
            id="switch-bAutomaticallyDetectVABY"
            checked={
              dataPar.bAutomaticallyDetectVABY ?? PARAMETER_SWITCH_DEFAULTS.bAutomaticallyDetectVABY
            }
            onChange={(e) => onFieldChange("bAutomaticallyDetectVABY", e.currentTarget.checked)}
            data-testid="field-bAutomaticallyDetectVABY"
          />
          <DataParFieldLabel
            fieldKey="bAutomaticallyDetectVABY"
            htmlFor="switch-bAutomaticallyDetectVABY"
          />
        </Group>
      </SimpleGrid>
    </Stack>
  );
}
