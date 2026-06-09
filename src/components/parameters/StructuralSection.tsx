import { Switch, Select, Stack } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { DataParFieldLabel } from "./DataParFieldLabel";

interface StructuralSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

const TOGGLE_FIELDS = [
  "bRunLongReg", "bRunDARTEL", "bSegmentSPM12", "bHammersCAT12", "bFixResolution",
] as const;

export function StructuralSection({ dataPar, onFieldChange }: StructuralSectionProps) {
  return (
    <Stack gap="md">
      {TOGGLE_FIELDS.map((key) => (
        <Switch
          key={key}
          label={<DataParFieldLabel fieldKey={key} />}
          checked={dataPar[key] ?? false}
          onChange={(e) => onFieldChange(key, e.currentTarget.checked)}
        />
      ))}

      <Select
        label={<DataParFieldLabel fieldKey="WMHsegmAlg" />}
        data={["LPA", "LGA"]}
        value={dataPar.WMHsegmAlg ?? null}
        onChange={(v) => onFieldChange("WMHsegmAlg", v)}
      />
    </Stack>
  );
}
