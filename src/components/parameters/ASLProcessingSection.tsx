import { Switch, NumberInput, Select, Stack, Group } from "@mantine/core";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";
import { ApplyQuantificationGroup } from "./ApplyQuantificationGroup";
import { PVCConfig } from "./PVCConfig";

interface ASLProcessingSectionProps {
  dataPar: DataParState;
  onFieldChange: (field: string, value: unknown) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

export function ASLProcessingSection({
  dataPar,
  onFieldChange,
  showAdvanced,
  onToggleAdvanced,
}: ASLProcessingSectionProps) {
  return (
    <Stack gap="md">
      <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
        <Switch
          id="switch-motionCorrection"
          checked={dataPar.motionCorrection ?? true}
          onChange={(e) => onFieldChange("motionCorrection", e.currentTarget.checked)}
          data-testid="field-motionCorrection"
        />
        <DataParFieldLabel fieldKey="motionCorrection" htmlFor="switch-motionCorrection" />
      </Group>

      <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
        <Switch
          id="switch-bTopUp"
          checked={dataPar.bTopUp ?? true}
          onChange={(e) => onFieldChange("bTopUp", e.currentTarget.checked)}
          data-testid="field-bTopUp"
        />
        <DataParFieldLabel fieldKey="bTopUp" htmlFor="switch-bTopUp" />
      </Group>

      <PVCConfig
        bPVCNativeSpace={dataPar.bPVCNativeSpace}
        bPVCGaussianMM={dataPar.bPVCGaussianMM}
        PVCNativeSpaceKernel={dataPar.PVCNativeSpaceKernel}
        onBpvChange={(v) => onFieldChange("bPVCNativeSpace", v)}
        onGaussianChange={(v) => onFieldChange("bPVCGaussianMM", v)}
        onKernelChange={(v) => onFieldChange("PVCNativeSpaceKernel", v)}
        showAdvanced={showAdvanced}
      />

      <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
        <Switch
          id="switch-SaveCBF4D"
          checked={dataPar.SaveCBF4D ?? false}
          onChange={(e) => onFieldChange("SaveCBF4D", e.currentTarget.checked)}
          data-testid="field-SaveCBF4D"
        />
        <DataParFieldLabel fieldKey="SaveCBF4D" htmlFor="switch-SaveCBF4D" />
      </Group>

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={onToggleAdvanced} />

      {showAdvanced && (
        <>
          <NumberInput
            label={<DataParFieldLabel fieldKey="SpikeRemovalThreshold" />}
            placeholder={FIELD_METADATA.SpikeRemovalThreshold.defaultHint}
            value={dataPar.SpikeRemovalThreshold}
            onChange={(v) => onFieldChange("SpikeRemovalThreshold", v === "" ? undefined : v)}
            data-testid="field-SpikeRemovalThreshold"
          />

          <NumberInput
            label={<DataParFieldLabel fieldKey="SpikeRemovalAbsoluteThreshold" />}
            placeholder={FIELD_METADATA.SpikeRemovalAbsoluteThreshold.defaultHint}
            value={dataPar.SpikeRemovalAbsoluteThreshold}
            onChange={(v) =>
              onFieldChange("SpikeRemovalAbsoluteThreshold", v === "" ? undefined : v)
            }
            data-testid="field-SpikeRemovalAbsoluteThreshold"
          />

          <Select
            label={<DataParFieldLabel fieldKey="bRegistrationContrast" />}
            data={[
              { value: "0", label: "0 — Control to T1-weighted" },
              { value: "1", label: "1 — CBF to pseudo-CBF template" },
              { value: "2", label: "2 — Automatic (PWI-based mixture)" },
              { value: "3", label: "3 — Force CBF to pseudo-CBF" },
            ]}
            value={
              dataPar.bRegistrationContrast != null ? String(dataPar.bRegistrationContrast) : null
            }
            onChange={(v) => onFieldChange("bRegistrationContrast", v ? Number(v) : undefined)}
            placeholder={FIELD_METADATA.bRegistrationContrast.defaultHint}
            data-testid="field-bRegistrationContrast"
          />

          <Select
            label={<DataParFieldLabel fieldKey="bAffineRegistration" />}
            data={[
              { value: "0", label: "0 — Disabled (rigid-body only)" },
              { value: "1", label: "1 — Enabled" },
              { value: "2", label: "2 — Automatic (based on perfusion variation)" },
            ]}
            value={dataPar.bAffineRegistration != null ? String(dataPar.bAffineRegistration) : null}
            onChange={(v) => onFieldChange("bAffineRegistration", v ? Number(v) : undefined)}
            placeholder={FIELD_METADATA.bAffineRegistration.defaultHint}
            data-testid="field-bAffineRegistration"
          />

          <Select
            label={<DataParFieldLabel fieldKey="bDCTRegistration" />}
            data={[
              { value: "0", label: "0 — Disabled (affine only)" },
              { value: "1", label: "1 — Enabled (Discrete Cosine Transform)" },
              { value: "2", label: "2 — Enabled with Partial Volume Correction" },
            ]}
            value={dataPar.bDCTRegistration != null ? String(dataPar.bDCTRegistration) : null}
            onChange={(v) => onFieldChange("bDCTRegistration", v ? Number(v) : undefined)}
            placeholder={FIELD_METADATA.bDCTRegistration.defaultHint}
            data-testid="field-bDCTRegistration"
          />

          <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
            <Switch
              id="switch-bUseMNIasDummyStructural"
              checked={dataPar.bUseMNIasDummyStructural ?? false}
              onChange={(e) => onFieldChange("bUseMNIasDummyStructural", e.currentTarget.checked)}
              data-testid="field-bUseMNIasDummyStructural"
            />
            <DataParFieldLabel
              fieldKey="bUseMNIasDummyStructural"
              htmlFor="switch-bUseMNIasDummyStructural"
            />
          </Group>

          <Select
            label={<DataParFieldLabel fieldKey="bHct2BloodT1" />}
            data={[
              { value: "0", label: "0 — Disabled (use fixed blood T1)" },
              { value: "1", label: "1 — Use Hematocrit (Hct) values" },
              { value: "2", label: "2 — Estimate from Age and Sex" },
            ]}
            value={dataPar.bHct2BloodT1 != null ? String(dataPar.bHct2BloodT1) : null}
            onChange={(v) => onFieldChange("bHct2BloodT1", v ? Number(v) : undefined)}
            placeholder={FIELD_METADATA.bHct2BloodT1.defaultHint}
            data-testid="field-bHct2BloodT1"
          />

          <ApplyQuantificationGroup
            value={dataPar.ApplyQuantification}
            onChange={(v) => onFieldChange("ApplyQuantification", v)}
          />
        </>
      )}
    </Stack>
  );
}
