import { useState } from "react";
import { Switch, NumberInput, Select, Stack } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";

interface GeneralSettingsSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

const ADVANCED_TOGGLE_FIELDS = [
  "DELETETEMP", "SkipIfNoFlair", "SkipIfNoASL", "SkipIfNoM0", "bLesionFilling", "bAutoACPC",
] as const;

export function GeneralSettingsSection({ dataPar, onFieldChange }: GeneralSettingsSectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Stack gap="md">
      <Select
        label={<DataParFieldLabel fieldKey="Quality" />}
        data={[
          { value: "1", label: "1 — Normal" },
          { value: "0", label: "0 — Fast try-out" },
        ]}
        value={dataPar.Quality != null ? String(dataPar.Quality) : null}
        onChange={(v) => onFieldChange("Quality", v ? Number(v) : undefined)}
        placeholder={FIELD_METADATA.Quality.defaultHint}
      />

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)} />

      {showAdvanced && (
        <>
          {ADVANCED_TOGGLE_FIELDS.map((key) => (
            <Switch
              key={key}
              label={<DataParFieldLabel fieldKey={key} />}
              checked={dataPar[key] ?? false}
              onChange={(e) => onFieldChange(key, e.currentTarget.checked)}
            />
          ))}

          <NumberInput
            label={<DataParFieldLabel fieldKey="stopAfterErrors" />}
            placeholder={FIELD_METADATA.stopAfterErrors.defaultHint}
            value={dataPar.stopAfterErrors}
            onChange={(v) => onFieldChange("stopAfterErrors", v === "" ? undefined : v)}
          />
        </>
      )}
    </Stack>
  );
}
