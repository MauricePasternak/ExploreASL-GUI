import { Switch, NumberInput, Select, Stack, Group } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";

interface QuantificationSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

const NUMBER_FIELDS = [
  "Lambda", "T2art", "T1blood", "T1GM", "T1WM", "T2GM", "T2WM", "T2tissueMultiTE",
] as const;

const EXTERNAL_TOGGLE_FIELDS = [
  "bMaskingExternal", "bSpatialBASIL", "bInferT1BASIL", "bInferATTBASIL", "bCleanUpExternal",
] as const;

export function QuantificationSection({
  dataPar,
  onFieldChange,
  showAdvanced,
  onToggleAdvanced,
}: QuantificationSectionProps) {

  const externalEnabled = dataPar.bUseExternalQuantification === true;

  return (
    <Stack gap="md">
      <Select
        label={<DataParFieldLabel fieldKey="nCompartments" />}
        data={[
          { value: "1", label: "1" },
          { value: "2", label: "2" },
        ]}
        value={dataPar.nCompartments != null ? String(dataPar.nCompartments) : null}
        onChange={(v) => onFieldChange("nCompartments", v ? Number(v) : undefined)}
        placeholder={FIELD_METADATA.nCompartments.defaultHint}
        data-testid="field-nCompartments"
      />

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={onToggleAdvanced} />

      {showAdvanced && (
        <>
          {NUMBER_FIELDS.map((key) => (
            <NumberInput
              key={key}
              label={<DataParFieldLabel fieldKey={key} />}
              placeholder={FIELD_METADATA[key].defaultHint}
              value={dataPar[key]}
              onChange={(v) => onFieldChange(key, v === "" ? undefined : v)}
              data-testid={`field-${key}`}
            />
          ))}

          <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
            <Switch
              id="switch-bUseExternalQuantification"
              checked={externalEnabled}
              onChange={(e) =>
                onFieldChange("bUseExternalQuantification", e.currentTarget.checked)
              }
              data-testid="field-bUseExternalQuantification"
            />
            <DataParFieldLabel fieldKey="bUseExternalQuantification" htmlFor="switch-bUseExternalQuantification" />
          </Group>

          {externalEnabled && (
            <>
              <Select
                label={<DataParFieldLabel fieldKey="ExternalQuantificationType" />}
                data={["BASIL", "FABBER", "VABY"]}
                value={dataPar.ExternalQuantificationType ?? null}
                onChange={(v) => onFieldChange("ExternalQuantificationType", v)}
                placeholder={FIELD_METADATA.ExternalQuantificationType.defaultHint}
                data-testid="field-ExternalQuantificationType"
              />

              <NumberInput
                label={<DataParFieldLabel fieldKey="ExternalQuantificationSmoothGaussianMM" />}
                placeholder={FIELD_METADATA.ExternalQuantificationSmoothGaussianMM.defaultHint}
                value={dataPar.ExternalQuantificationSmoothGaussianMM?.[0]}
                onChange={(v) => {
                  const existing = dataPar.ExternalQuantificationSmoothGaussianMM ?? [0, 0, 0];
                  onFieldChange("ExternalQuantificationSmoothGaussianMM", [
                    v === "" ? 0 : v,
                    existing[1],
                    existing[2],
                  ]);
                }}
                data-testid="field-ExternalQuantificationSmoothGaussianMM"
              />

              {EXTERNAL_TOGGLE_FIELDS.map((key) => (
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
                label={<DataParFieldLabel fieldKey="ExchBASIL" />}
                data={["mix", "simple", "2cpt", "spa"]}
                value={dataPar.ExchBASIL ?? null}
                onChange={(v) => onFieldChange("ExchBASIL", v)}
                placeholder={FIELD_METADATA.ExchBASIL.defaultHint}
                data-testid="field-ExchBASIL"
              />

              <Select
                label={<DataParFieldLabel fieldKey="DispBASIL" />}
                data={["none", "gamma", "gauss", "sgauss"]}
                value={dataPar.DispBASIL ?? null}
                onChange={(v) => onFieldChange("DispBASIL", v)}
                placeholder={FIELD_METADATA.DispBASIL.defaultHint}
                data-testid="field-DispBASIL"
              />

              <NumberInput
                label={<DataParFieldLabel fieldKey="ATTSDBASIL" />}
                placeholder={FIELD_METADATA.ATTSDBASIL.defaultHint}
                value={dataPar.ATTSDBASIL}
                onChange={(v) => onFieldChange("ATTSDBASIL", v === "" ? undefined : v)}
                data-testid="field-ATTSDBASIL"
              />
            </>
          )}
        </>
      )}
    </Stack>
  );
}
