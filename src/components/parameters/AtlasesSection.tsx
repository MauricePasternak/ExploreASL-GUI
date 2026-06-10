import { useState } from "react";
import { Switch, NumberInput, TextInput, Checkbox, Stack, Group, Text } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";
import { AtlasSelect } from "./AtlasSelect";

interface AtlasesSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

const MASK_LABELS = ["GM", "WM", "CSF", "Background"] as const;

export function AtlasesSection({ dataPar, onFieldChange }: AtlasesSectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const atlases = dataPar.Atlases ?? [];
  const tissueMasking = dataPar.TissueMasking ?? [];
  const tissueThreshold = dataPar.TissueThreshold ?? [];
  const bMasking = dataPar.bMasking ?? [false, false, false, false];

  const allMasked = bMasking.every(Boolean);
  const toggleAllMasks = () => {
    onFieldChange("bMasking", allMasked ? [false, false, false, false] : [true, true, true, true]);
  };

  return (
    <Stack gap="md">
      <AtlasSelect
        atlases={atlases}
        tissueMasking={tissueMasking}
        tissueThreshold={tissueThreshold}
        onAtlasesChange={(v) => onFieldChange("Atlases", v)}
        onTissueMaskingChange={(v) => onFieldChange("TissueMasking", v)}
        onTissueThresholdChange={(v) => onFieldChange("TissueThreshold", v)}
      />

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)} />

      {showAdvanced && (
        <>
          <Stack gap="xs">
            <Group gap="xs" align="center">
              <Text size="sm" fw={500}>
                <DataParFieldLabel fieldKey="bMasking" />
              </Text>
              <Checkbox
                label={allMasked ? "Deselect all" : "Select all"}
                checked={allMasked}
                onChange={toggleAllMasks}
                size="xs"
              />
            </Group>
            {MASK_LABELS.map((label, i) => (
              <Checkbox
                key={label}
                label={label}
                checked={bMasking[i] ?? false}
                onChange={() => {
                  const next = [...bMasking];
                  next[i] = !next[i];
                  onFieldChange("bMasking", next);
                }}
              />
            ))}
          </Stack>

          <NumberInput
            label={<DataParFieldLabel fieldKey="MinimalROIVolume" />}
            placeholder={FIELD_METADATA.MinimalROIVolume.defaultHint}
            value={dataPar.MinimalROIVolume}
            onChange={(v) => onFieldChange("MinimalROIVolume", v === "" ? undefined : v)}
            suffix=" mL"
          />

          <Switch
            label={<DataParFieldLabel fieldKey="bWMH" />}
            checked={dataPar.bWMH ?? false}
            onChange={(e) => onFieldChange("bWMH", e.currentTarget.checked)}
          />

          <TextInput
            label={<DataParFieldLabel fieldKey="DataTypes" />}
            placeholder={FIELD_METADATA.DataTypes.defaultHint}
            value={dataPar.DataTypes?.join(", ") ?? ""}
            onChange={(e) => {
              const val = e.currentTarget.value;
              onFieldChange("DataTypes", val ? val.split(",").map((s) => s.trim()) : []);
            }}
          />
        </>
      )}
    </Stack>
  );
}
