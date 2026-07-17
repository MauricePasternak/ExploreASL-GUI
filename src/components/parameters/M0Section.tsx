import { Group, NumberInput, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconMagnet, IconAdjustments, IconBaseline } from "@tabler/icons-react";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";
import { M0Select } from "./M0Select";
import { CommaNumberInput } from "../CommaNumberInput";
import { FlagToggle } from "./FlagToggle";

interface M0SectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

export function M0Section({
  dataPar,
  onFieldChange,
  showAdvanced,
  onToggleAdvanced,
}: M0SectionProps) {
  const bgPulses = dataPar.BackgroundSuppressionNumberPulses ?? 0;
  const showPulseTime = dataPar.M0 === "UseControlAsM0" && bgPulses > 0;

  return (
    <Stack gap="md">
      <Paper p="md" radius="md" withBorder>
        <Stack gap="sm">
          <Group gap="xs">
            <IconMagnet size={18} style={{ color: "var(--mantine-color-grape-6)" }} />
            <Text fw={600} size="sm">
              M0 Source & Background Suppression
            </Text>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                <DataParFieldLabel fieldKey="M0" />
              </Text>
              <M0Select
                value={dataPar.M0}
                onChange={(v) => onFieldChange("M0", v)}
                data-testid="field-M0"
              />
            </Stack>

            <NumberInput
              label={<DataParFieldLabel fieldKey="BackgroundSuppressionNumberPulses" />}
              placeholder={FIELD_METADATA.BackgroundSuppressionNumberPulses.defaultHint}
              value={dataPar.BackgroundSuppressionNumberPulses}
              onChange={(v) =>
                onFieldChange("BackgroundSuppressionNumberPulses", v === "" ? undefined : v)
              }
              min={0}
              data-testid="field-BackgroundSuppressionNumberPulses"
            />

            {showPulseTime && (
              <CommaNumberInput
                label={<DataParFieldLabel fieldKey="BackgroundSuppressionPulseTime" />}
                placeholder={FIELD_METADATA.BackgroundSuppressionPulseTime.defaultHint}
                value={dataPar.BackgroundSuppressionPulseTime}
                onChange={(v) => onFieldChange("BackgroundSuppressionPulseTime", v)}
                testId="field-BackgroundSuppressionPulseTime"
              />
            )}
          </SimpleGrid>
        </Stack>
      </Paper>

      <Paper p="md" radius="md" withBorder>
        <Stack gap="sm">
          <Group gap="xs">
            <IconBaseline size={18} style={{ color: "var(--mantine-color-grape-6)" }} />
            <Text fw={600} size="sm">
              Calibration & Registration
            </Text>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <NumberInput
              label={<DataParFieldLabel fieldKey="M0_GMScaleFactor" />}
              placeholder={FIELD_METADATA.M0_GMScaleFactor.defaultHint}
              value={dataPar.M0_GMScaleFactor}
              onChange={(v) => onFieldChange("M0_GMScaleFactor", v === "" ? undefined : v)}
              data-testid="field-M0_GMScaleFactor"
            />

            <Group gap="xs" align="center" style={{ minHeight: "36px" }}>
              <FlagToggle
                fieldKey="bRegisterM02ASL"
                value={dataPar.bRegisterM02ASL}
                onChange={(v) => onFieldChange("bRegisterM02ASL", v)}
              />
            </Group>
          </SimpleGrid>
        </Stack>
      </Paper>

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={onToggleAdvanced} />

      {showAdvanced && (
        <Paper p="md" radius="md" withBorder>
          <Stack gap="sm">
            <Group gap="xs">
              <IconAdjustments size={18} style={{ color: "var(--mantine-color-grape-6)" }} />
              <Text fw={600} size="sm">
                Advanced M0 Parameters
              </Text>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <FlagToggle
                fieldKey="M0_conventionalProcessing"
                value={dataPar.M0_conventionalProcessing}
                onChange={(v) => onFieldChange("M0_conventionalProcessing", v)}
              />

              <CommaNumberInput
                label={<DataParFieldLabel fieldKey="RepetitionTimePreparationM0" />}
                placeholder={FIELD_METADATA.RepetitionTimePreparationM0.defaultHint}
                value={dataPar.RepetitionTimePreparationM0}
                onChange={(v) => onFieldChange("RepetitionTimePreparationM0", v)}
                testId="field-RepetitionTimePreparationM0"
              />
            </SimpleGrid>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
