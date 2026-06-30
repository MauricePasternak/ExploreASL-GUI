import { NumberInput, Stack, Text } from "@mantine/core";

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

      <NumberInput
        label={<DataParFieldLabel fieldKey="M0_GMScaleFactor" />}
        placeholder={FIELD_METADATA.M0_GMScaleFactor.defaultHint}
        value={dataPar.M0_GMScaleFactor}
        onChange={(v) => onFieldChange("M0_GMScaleFactor", v === "" ? undefined : v)}
        data-testid="field-M0_GMScaleFactor"
      />

      <FlagToggle
        fieldKey="bRegisterM02ASL"
        value={dataPar.bRegisterM02ASL}
        onChange={(v) => onFieldChange("bRegisterM02ASL", v)}
      />

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={onToggleAdvanced} />

      {showAdvanced && (
        <>
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
        </>
      )}
    </Stack>
  );
}
