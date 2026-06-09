import { useState } from "react";
import { Switch, NumberInput, Select, Stack } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";

interface QuantificationSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

const NUMBER_FIELDS = [
  "Lambda", "T2art", "T1blood", "T1GM", "T1WM", "T2GM", "T2WM", "T2tissueMultiTE",
] as const;

const EXTERNAL_TOGGLE_FIELDS = [
  "bMaskingExternal", "bSpatialBASIL", "bInferT1BASIL", "bInferATTBASIL", "bCleanUpExternal",
] as const;

export function QuantificationSection({ dataPar, onFieldChange }: QuantificationSectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      />

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)} />

      {showAdvanced && (
        <>
          {NUMBER_FIELDS.map((key) => (
            <NumberInput
              key={key}
              label={<DataParFieldLabel fieldKey={key} />}
              placeholder={FIELD_METADATA[key].defaultHint}
              value={dataPar[key]}
              onChange={(v) => onFieldChange(key, v === "" ? undefined : v)}
            />
          ))}

          <Switch
            label={<DataParFieldLabel fieldKey="bUseExternalQuantification" />}
            checked={externalEnabled}
            onChange={(e) =>
              onFieldChange("bUseExternalQuantification", e.currentTarget.checked)
            }
          />

          {externalEnabled && (
            <>
              <Select
                label={<DataParFieldLabel fieldKey="ExternalQuantificationType" />}
                data={["BASIL", "FABBER", "VABY"]}
                value={dataPar.ExternalQuantificationType ?? null}
                onChange={(v) => onFieldChange("ExternalQuantificationType", v)}
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
              />

              {EXTERNAL_TOGGLE_FIELDS.map((key) => (
                <Switch
                  key={key}
                  label={<DataParFieldLabel fieldKey={key} />}
                  checked={dataPar[key] ?? false}
                  onChange={(e) => onFieldChange(key, e.currentTarget.checked)}
                />
              ))}

              <Select
                label={<DataParFieldLabel fieldKey="ExchBASIL" />}
                data={["mix", "simple", "2cpt", "spa"]}
                value={dataPar.ExchBASIL ?? null}
                onChange={(v) => onFieldChange("ExchBASIL", v)}
              />

              <Select
                label={<DataParFieldLabel fieldKey="DispBASIL" />}
                data={["none", "gamma", "gauss", "sgauss"]}
                value={dataPar.DispBASIL ?? null}
                onChange={(v) => onFieldChange("DispBASIL", v)}
              />

              <NumberInput
                label={<DataParFieldLabel fieldKey="ATTSDBASIL" />}
                placeholder={FIELD_METADATA.ATTSDBASIL.defaultHint}
                value={dataPar.ATTSDBASIL}
                onChange={(v) => onFieldChange("ATTSDBASIL", v === "" ? undefined : v)}
              />
            </>
          )}
        </>
      )}
    </Stack>
  );
}
