import { Switch, Stack, Group } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { DataParFieldLabel } from "./DataParFieldLabel";

interface EnvironmentSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export function EnvironmentSection({ dataPar, onFieldChange }: EnvironmentSectionProps) {
  return (
    <Stack gap="md">
      <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
        <Switch
          id="switch-bAutomaticallyDetectFSL"
          checked={dataPar.bAutomaticallyDetectFSL ?? true}
          onChange={(e) => onFieldChange("bAutomaticallyDetectFSL", e.currentTarget.checked)}
          data-testid="field-bAutomaticallyDetectFSL"
        />
        <DataParFieldLabel fieldKey="bAutomaticallyDetectFSL" htmlFor="switch-bAutomaticallyDetectFSL" />
      </Group>

      <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
        <Switch
          id="switch-bAutomaticallyDetectVABY"
          checked={dataPar.bAutomaticallyDetectVABY ?? true}
          onChange={(e) => onFieldChange("bAutomaticallyDetectVABY", e.currentTarget.checked)}
          data-testid="field-bAutomaticallyDetectVABY"
        />
        <DataParFieldLabel fieldKey="bAutomaticallyDetectVABY" htmlFor="switch-bAutomaticallyDetectVABY" />
      </Group>
    </Stack>
  );
}
