import { Switch, Select, Stack, Group } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { FlagToggle } from "./FlagToggle";

interface StructuralSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

const FLAG_FIELDS = ["bRunLongReg", "bRunDARTEL", "bSegmentSPM12", "bHammersCAT12"] as const;

export function StructuralSection({ dataPar, onFieldChange }: StructuralSectionProps) {
  return (
    <Stack gap="md">
      {FLAG_FIELDS.map((key) => (
        <FlagToggle
          key={key}
          fieldKey={key}
          value={dataPar[key] as 0 | 1 | undefined}
          onChange={(v) => onFieldChange(key, v)}
        />
      ))}

      <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
        <Switch
          id="switch-bFixResolution"
          checked={dataPar.bFixResolution ?? false}
          onChange={(e) => onFieldChange("bFixResolution", e.currentTarget.checked)}
          data-testid="field-bFixResolution"
        />
        <DataParFieldLabel fieldKey="bFixResolution" htmlFor="switch-bFixResolution" />
      </Group>

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
