import { Switch, Stack } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { DataParFieldLabel } from "./DataParFieldLabel";

interface EnvironmentSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export function EnvironmentSection({ dataPar, onFieldChange }: EnvironmentSectionProps) {
  return (
    <Stack gap="md">
      <Switch
        label={<DataParFieldLabel fieldKey="bAutomaticallyDetectFSL" />}
        checked={dataPar.bAutomaticallyDetectFSL ?? true}
        onChange={(e) => onFieldChange("bAutomaticallyDetectFSL", e.currentTarget.checked)}
      />

      <Switch
        label={<DataParFieldLabel fieldKey="bAutomaticallyDetectVABY" />}
        checked={dataPar.bAutomaticallyDetectVABY ?? true}
        onChange={(e) => onFieldChange("bAutomaticallyDetectVABY", e.currentTarget.checked)}
      />
    </Stack>
  );
}
