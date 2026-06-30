import { Alert, Group, Select, Stack, Switch } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import type { DataParState } from "../../schemas/dataParSchema";
import { AdvancedDivider } from "./AdvancedDivider";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { FlagToggle } from "./FlagToggle";

interface GeneralSettingsSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

const ADVANCED_FLAG_FIELDS = ["DELETETEMP", "SkipIfNoFlair", "SkipIfNoASL", "SkipIfNoM0"] as const;

const ADVANCED_BOOLEAN_FIELDS = ["bLesionFilling", "bAutoACPC"] as const;

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
          { value: "1", label: "Normal processing" },
          { value: "0", label: "Low quality (fast try-out)" },
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
          {ADVANCED_FLAG_FIELDS.map((key) => (
            <FlagToggle
              key={key}
              fieldKey={key}
              value={dataPar[key] as 0 | 1 | undefined}
              onChange={(v) => onFieldChange(key, v)}
            />
          ))}
          {ADVANCED_BOOLEAN_FIELDS.map((key) => (
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
        </>
      )}
    </Stack>
  );
}
