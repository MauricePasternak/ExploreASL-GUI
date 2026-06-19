import { Switch, Select, Stack, Group } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";

interface StructuralSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

const TOGGLE_FIELDS = [
  "bRunLongReg",
  "bRunDARTEL",
  "bSegmentSPM12",
  "bHammersCAT12",
  "bFixResolution",
] as const;

export function StructuralSection({ dataPar, onFieldChange }: StructuralSectionProps) {
  return (
    <Stack gap="md">
      {TOGGLE_FIELDS.map((key) => (
        <Group key={key} gap="xs" align="center" style={{ minHeight: "32px" }}>
          <Switch
            id={`switch-${key}`}
            checked={dataPar[key] ?? false}
            onChange={(e) => onFieldChange(key, e.currentTarget.checked)}
            data-testid={`field-${key}`}
          />
          <DataParFieldLabel fieldKey={key} htmlFor={`switch-${key}`} />
        </Group>
      ))}

      <Select
        label={<DataParFieldLabel fieldKey="WMHsegmAlg" />}
        data={["LPA", "LGA"]}
        value={dataPar.WMHsegmAlg ?? null}
        onChange={(v) => onFieldChange("WMHsegmAlg", v)}
        placeholder={FIELD_METADATA.WMHsegmAlg.defaultHint}
        data-testid="field-WMHsegmAlg"
      />
    </Stack>
  );
}
