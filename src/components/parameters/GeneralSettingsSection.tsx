import { Switch, NumberInput, Select, Stack, Group, Alert } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";

interface GeneralSettingsSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

const ADVANCED_TOGGLE_FIELDS = [
  "DELETETEMP",
  "SkipIfNoFlair",
  "SkipIfNoASL",
  "SkipIfNoM0",
  "bLesionFilling",
  "bAutoACPC",
] as const;

export function GeneralSettingsSection({
  dataPar,
  onFieldChange,
  showAdvanced,
  onToggleAdvanced,
}: GeneralSettingsSectionProps) {
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
        data-testid="field-Quality"
      />

      <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
        <Switch
          id="switch-enableMetadataGroupingCorrection"
          checked={dataPar.enableMetadataGroupingCorrection ?? false}
          onChange={(e) =>
            onFieldChange("enableMetadataGroupingCorrection", e.currentTarget.checked)
          }
          data-testid="field-enableMetadataGroupingCorrection"
        />
        <DataParFieldLabel
          fieldKey="enableMetadataGroupingCorrection"
          htmlFor="switch-enableMetadataGroupingCorrection"
        />
      </Group>

      {dataPar.enableMetadataGroupingCorrection && (
        <Alert
          color="yellow"
          title="Warning: Site-Scanner Correction"
          icon={<IconAlertTriangle size={16} />}
          data-testid="participants-warning-callout"
        >
          Because site will be present in the participants.tsv file, ExploreASL's Population
          directory WILL enact Site-Scanner correction on that basis (i.e., creates a site-specific
          mean scan and derives multiplicative images to normalize between-site/scanner intensity
          differences). If you do not want this behavior, do not enable this option.
        </Alert>
      )}

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={onToggleAdvanced} />

      {showAdvanced && (
        <>
          {ADVANCED_TOGGLE_FIELDS.map((key) => (
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

          <NumberInput
            label={<DataParFieldLabel fieldKey="stopAfterErrors" />}
            placeholder={FIELD_METADATA.stopAfterErrors.defaultHint}
            value={dataPar.stopAfterErrors}
            onChange={(v) => onFieldChange("stopAfterErrors", v === "" ? undefined : v)}
            data-testid="field-stopAfterErrors"
          />
        </>
      )}
    </Stack>
  );
}
