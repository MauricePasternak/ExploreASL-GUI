import { Group, NumberInput, Select, Stack, Switch, Text } from "@mantine/core";

import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import type { DataParState } from "../../schemas/dataParSchema";
import { AdvancedDivider } from "./AdvancedDivider";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { NumberTupleInput } from "./NumberTupleInput";

interface QuantificationSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

const NUMBER_FIELDS = [
  "Lambda",
  "T2art",
  "T1blood",
  "T1GM",
  "T1WM",
  "T2GM",
  "T2WM",
  "T2tissueMultiTE",
] as const;

const EXTERNAL_TOGGLE_FIELDS = [
  "bMaskingExternal",
  "bSpatialBASIL",
  "bInferT1BASIL",
  "bInferATTBASIL",
  "bCleanUpExternal",
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
          { value: "1", label: "Single-compartment model" },
          { value: "2", label: "Two-compartment model" },
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
              onChange={(e) => onFieldChange("bUseExternalQuantification", e.currentTarget.checked)}
              data-testid="field-bUseExternalQuantification"
            />
            <DataParFieldLabel
              fieldKey="bUseExternalQuantification"
              htmlFor="switch-bUseExternalQuantification"
            />
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

              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  <DataParFieldLabel fieldKey="ExternalQuantificationSmoothGaussianMM" />
                </Text>
                <NumberTupleInput
                  value={dataPar.ExternalQuantificationSmoothGaussianMM}
                  onChange={(v) => onFieldChange("ExternalQuantificationSmoothGaussianMM", v)}
                  labels={["LR", "AP", "IS"]}
                  testId="field-ExternalQuantificationSmoothGaussianMM"
                  integerOnly
                  placeholder={[5, 5, 1]}
                />
              </Stack>

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
                data={[
                  { value: "mix", label: "Well-mixed single compartment" },
                  { value: "simple", label: "Simple single-compartment model with T1 of blood" },
                  { value: "2cpt", label: "Two-compartment model following Parkes & Tofts (2002)" },
                  { value: "spa", label: "Single-pass approximation from St. Lawrence" },
                ]}
                value={dataPar.ExchBASIL ?? null}
                onChange={(v) => onFieldChange("ExchBASIL", v)}
                placeholder={FIELD_METADATA.ExchBASIL.defaultHint}
                data-testid="field-ExchBASIL"
              />

              <Select
                label={<DataParFieldLabel fieldKey="DispBASIL" />}
                data={[
                  { value: "none", label: "None" },
                  { value: "gamma", label: "Gamma distribution" },
                  { value: "gauss", label: "Gaussian distribution" },
                  { value: "sgauss", label: "Spatially-derived Gaussian distribution" },
                ]}
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
