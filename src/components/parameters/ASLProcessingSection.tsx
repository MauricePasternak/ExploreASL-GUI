import { useState } from "react";
import { Switch, NumberInput, Select, Stack, Text } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";
import { ApplyQuantificationGroup } from "./ApplyQuantificationGroup";

interface ASLProcessingSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
}

export function ASLProcessingSection({ dataPar, onFieldChange }: ASLProcessingSectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Stack gap="md">
      <Switch
        label={<DataParFieldLabel fieldKey="motionCorrection" />}
        checked={dataPar.motionCorrection ?? true}
        onChange={(e) => onFieldChange("motionCorrection", e.currentTarget.checked)}
      />

      <Switch
        label={<DataParFieldLabel fieldKey="bTopUp" />}
        checked={dataPar.bTopUp ?? true}
        onChange={(e) => onFieldChange("bTopUp", e.currentTarget.checked)}
      />

      <Switch
        label={<DataParFieldLabel fieldKey="bPVCNativeSpace" />}
        checked={dataPar.bPVCNativeSpace ?? true}
        onChange={(e) => onFieldChange("bPVCNativeSpace", e.currentTarget.checked)}
      />

      <Switch
        label={<DataParFieldLabel fieldKey="SaveCBF4D" />}
        checked={dataPar.SaveCBF4D ?? false}
        onChange={(e) => onFieldChange("SaveCBF4D", e.currentTarget.checked)}
      />

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)} />

      {showAdvanced && (
        <>
          <NumberInput
            label={<DataParFieldLabel fieldKey="SpikeRemovalThreshold" />}
            placeholder={FIELD_METADATA.SpikeRemovalThreshold.defaultHint}
            value={dataPar.SpikeRemovalThreshold}
            onChange={(v) => onFieldChange("SpikeRemovalThreshold", v === "" ? undefined : v)}
          />

          <NumberInput
            label={<DataParFieldLabel fieldKey="SpikeRemovalAbsoluteThreshold" />}
            placeholder={FIELD_METADATA.SpikeRemovalAbsoluteThreshold.defaultHint}
            value={dataPar.SpikeRemovalAbsoluteThreshold}
            onChange={(v) =>
              onFieldChange("SpikeRemovalAbsoluteThreshold", v === "" ? undefined : v)
            }
          />

          <Select
            label={<DataParFieldLabel fieldKey="bRegistrationContrast" />}
            data={["0", "1", "2", "3"]}
            value={dataPar.bRegistrationContrast != null ? String(dataPar.bRegistrationContrast) : null}
            onChange={(v) => onFieldChange("bRegistrationContrast", v ? Number(v) : undefined)}
          />

          <Select
            label={<DataParFieldLabel fieldKey="bAffineRegistration" />}
            data={["0", "1", "2"]}
            value={dataPar.bAffineRegistration != null ? String(dataPar.bAffineRegistration) : null}
            onChange={(v) => onFieldChange("bAffineRegistration", v ? Number(v) : undefined)}
          />

          <Select
            label={<DataParFieldLabel fieldKey="bDCTRegistration" />}
            data={["0", "1", "2"]}
            value={dataPar.bDCTRegistration != null ? String(dataPar.bDCTRegistration) : null}
            onChange={(v) => onFieldChange("bDCTRegistration", v ? Number(v) : undefined)}
          />

          <Switch
            label={<DataParFieldLabel fieldKey="bUseMNIasDummyStructural" />}
            checked={dataPar.bUseMNIasDummyStructural ?? false}
            onChange={(e) =>
              onFieldChange("bUseMNIasDummyStructural", e.currentTarget.checked)
            }
          />

          <Select
            label={<DataParFieldLabel fieldKey="bHct2BloodT1" />}
            data={["0", "1", "2"]}
            value={dataPar.bHct2BloodT1 != null ? String(dataPar.bHct2BloodT1) : null}
            onChange={(v) => onFieldChange("bHct2BloodT1", v ? Number(v) : undefined)}
          />

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              <DataParFieldLabel fieldKey="ApplyQuantification" />
            </Text>
            <ApplyQuantificationGroup
              value={dataPar.ApplyQuantification}
              onChange={(v) => onFieldChange("ApplyQuantification", v)}
            />
          </Stack>
        </>
      )}
    </Stack>
  );
}
