import { useState } from "react";
import { Switch, NumberInput, Stack, Text } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";
import { M0Select } from "./M0Select";

interface M0SectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export function M0Section({ dataPar, onFieldChange }: M0SectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const bgPulses = dataPar.BackgroundSuppressionNumberPulses ?? 0;
  const showPulseTime =
    dataPar.M0 === "UseControlAsM0" && bgPulses > 0;

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Text size="sm" fw={500}>
          <DataParFieldLabel fieldKey="M0" />
        </Text>
        <M0Select
          value={dataPar.M0}
          onChange={(v) => onFieldChange("M0", v)}
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
      />

      {showPulseTime && (
        <NumberInput
          label={<DataParFieldLabel fieldKey="BackgroundSuppressionPulseTime" />}
          placeholder={FIELD_METADATA.BackgroundSuppressionPulseTime.defaultHint}
          value={dataPar.BackgroundSuppressionPulseTime}
          onChange={(v) =>
            onFieldChange("BackgroundSuppressionPulseTime", v === "" ? undefined : v)
          }
        />
      )}

      <NumberInput
        label={<DataParFieldLabel fieldKey="M0_GMScaleFactor" />}
        placeholder={FIELD_METADATA.M0_GMScaleFactor.defaultHint}
        value={dataPar.M0_GMScaleFactor}
        onChange={(v) =>
          onFieldChange("M0_GMScaleFactor", v === "" ? undefined : v)
        }
      />

      <Switch
        label={<DataParFieldLabel fieldKey="bRegisterM02ASL" />}
        checked={dataPar.bRegisterM02ASL ?? true}
        onChange={(e) => onFieldChange("bRegisterM02ASL", e.currentTarget.checked)}
      />

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)} />

      {showAdvanced && (
        <>
          <Switch
            label={<DataParFieldLabel fieldKey="M0_conventionalProcessing" />}
            checked={dataPar.M0_conventionalProcessing ?? false}
            onChange={(e) =>
              onFieldChange("M0_conventionalProcessing", e.currentTarget.checked)
            }
          />

          <NumberInput
            label={<DataParFieldLabel fieldKey="RepetitionTimePreparationM0" />}
            placeholder={FIELD_METADATA.RepetitionTimePreparationM0.defaultHint}
            value={dataPar.RepetitionTimePreparationM0}
            onChange={(v) =>
              onFieldChange("RepetitionTimePreparationM0", v === "" ? undefined : v)
            }
          />
        </>
      )}
    </Stack>
  );
}
