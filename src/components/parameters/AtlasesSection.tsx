import {
  Switch,
  NumberInput,
  TextInput,
  Checkbox,
  Stack,
  Group,
  Text,
  Paper,
  SimpleGrid,
} from "@mantine/core";
import { IconMap, IconCategory } from "@tabler/icons-react";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";
import { AtlasSelect } from "./AtlasSelect";

interface AtlasesSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

const MASK_LABELS = [
  "Susceptibility mask",
  "Vascular mask",
  "Subject-specific tissue mask (e.g. pGM>0.5)",
  "WholeBrain masking (memory compression)",
] as const;

function bMaskingToTuple(
  val: number | [number, number, number, number] | undefined,
): [boolean, boolean, boolean, boolean] {
  if (val === undefined || val === 1) return [true, true, true, true];
  if (val === 0) return [false, false, false, false];
  if (Array.isArray(val)) return [!!val[0], !!val[1], !!val[2], !!val[3]];
  return [true, true, true, true];
}

function tupleToBMasking(
  tuple: [boolean, boolean, boolean, boolean],
): number | [number, number, number, number] {
  const nums: [number, number, number, number] = [
    tuple[0] ? 1 : 0,
    tuple[1] ? 1 : 0,
    tuple[2] ? 1 : 0,
    tuple[3] ? 1 : 0,
  ];
  if (nums[0] === 1 && nums[1] === 1 && nums[2] === 1 && nums[3] === 1) return 1;
  if (nums[0] === 0 && nums[1] === 0 && nums[2] === 0 && nums[3] === 0) return 0;
  return nums;
}

export function AtlasesSection({
  dataPar,
  onFieldChange,
  showAdvanced,
  onToggleAdvanced,
}: AtlasesSectionProps) {
  const atlases = dataPar.Atlases ?? [];
  const tissueMasking = dataPar.TissueMasking ?? [];
  const tissueThreshold = dataPar.TissueThreshold ?? [];
  const bMaskingTuple = bMaskingToTuple(dataPar.bMasking);

  const allMasked = bMaskingTuple.every(Boolean);
  const toggleAllMasks = () => {
    onFieldChange("bMasking", allMasked ? 0 : 1);
  };

  return (
    <Stack gap="md">
      <Paper p="md" radius="md" withBorder>
        <Stack gap="sm">
          <Group gap="xs">
            <IconMap size={18} style={{ color: "var(--mantine-color-grape-6)" }} />
            <Text fw={600} size="sm">
              Structural & Custom Atlases
            </Text>
          </Group>

          <AtlasSelect
            atlases={atlases}
            tissueMasking={tissueMasking}
            tissueThreshold={tissueThreshold}
            onAtlasesChange={(v) => onFieldChange("Atlases", v)}
            onTissueMaskingChange={(v) => onFieldChange("TissueMasking", v)}
            onTissueThresholdChange={(v) => onFieldChange("TissueThreshold", v)}
          />
        </Stack>
      </Paper>

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={onToggleAdvanced} />

      {showAdvanced && (
        <Paper p="md" radius="md" withBorder>
          <Stack gap="sm">
            <Group gap="xs">
              <IconCategory size={18} style={{ color: "var(--mantine-color-grape-6)" }} />
              <Text fw={600} size="sm">
                Tissue Masking & Output Options
              </Text>
            </Group>

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
                  data-testid="field-bMasking-select-all"
                />
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {MASK_LABELS.map((label, i) => (
                  <Checkbox
                    key={label}
                    label={label}
                    checked={bMaskingTuple[i]}
                    onChange={() => {
                      const next: [boolean, boolean, boolean, boolean] = [...bMaskingTuple];
                      next[i] = !next[i];
                      onFieldChange("bMasking", tupleToBMasking(next));
                    }}
                    data-testid={`field-bMasking-${i}`}
                  />
                ))}
              </SimpleGrid>
            </Stack>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" mt="xs">
              <NumberInput
                label={<DataParFieldLabel fieldKey="MinimalROIVolume" />}
                placeholder={FIELD_METADATA.MinimalROIVolume.defaultHint}
                value={dataPar.MinimalROIVolume}
                onChange={(v) => onFieldChange("MinimalROIVolume", v === "" ? undefined : v)}
                suffix=" mL"
                data-testid="field-MinimalROIVolume"
              />

              <Group gap="xs" align="center" style={{ minHeight: "36px" }}>
                <Switch
                  id="switch-bWMH"
                  checked={dataPar.bWMH ?? false}
                  onChange={(e) => onFieldChange("bWMH", e.currentTarget.checked)}
                  data-testid="field-bWMH"
                />
                <DataParFieldLabel fieldKey="bWMH" htmlFor="switch-bWMH" />
              </Group>
            </SimpleGrid>

            <TextInput
              label={<DataParFieldLabel fieldKey="DataTypes" />}
              placeholder={FIELD_METADATA.DataTypes.defaultHint}
              value={dataPar.DataTypes?.join(", ") ?? ""}
              onChange={(e) => {
                const val = e.currentTarget.value;
                onFieldChange("DataTypes", val ? val.split(",").map((s) => s.trim()) : []);
              }}
              data-testid="field-DataTypes"
            />
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
