import { Group, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Text } from "@mantine/core";
import { IconActivity, IconFocus2, IconTimeline } from "@tabler/icons-react";

import type { DataParState } from "../../schemas/dataParSchema";
import { FIELD_METADATA } from "../../lib/dataParFieldMetadata";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { AdvancedDivider } from "./AdvancedDivider";
import { ApplyQuantificationGroup } from "./ApplyQuantificationGroup";
import { FlagToggle } from "./FlagToggle";
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
      <Paper p="md" radius="md" withBorder>
        <Stack gap="sm">
          <Group gap="xs">
            <IconActivity size={18} style={{ color: "var(--mantine-color-grape-6)" }} />
            <Text fw={600} size="sm">
              Motion, Distortion & Partial Volume Correction
            </Text>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <FlagToggle
              fieldKey="motionCorrection"
              value={dataPar.motionCorrection}
              defaultValue={true}
              onChange={(v) => onFieldChange("motionCorrection", v)}
            />

            <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
              <Switch
                id="switch-bTopUp"
                checked={dataPar.bTopUp ?? false}
                onChange={(e) => onFieldChange("bTopUp", e.currentTarget.checked)}
                data-testid="field-bTopUp"
              />
              <DataParFieldLabel fieldKey="bTopUp" htmlFor="switch-bTopUp" />
            </Group>

            <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
              <Switch
                id="switch-SaveCBF4D"
                checked={dataPar.SaveCBF4D ?? false}
                onChange={(e) => onFieldChange("SaveCBF4D", e.currentTarget.checked)}
                data-testid="field-SaveCBF4D"
              />
              <DataParFieldLabel fieldKey="SaveCBF4D" htmlFor="switch-SaveCBF4D" />
            </Group>
          </SimpleGrid>

          <PVCConfig
            bPVCNativeSpace={dataPar.bPVCNativeSpace}
            bPVCGaussianMM={dataPar.bPVCGaussianMM}
            PVCNativeSpaceKernel={dataPar.PVCNativeSpaceKernel}
            onBpvChange={(v) => onFieldChange("bPVCNativeSpace", v)}
            onGaussianChange={(v) => onFieldChange("bPVCGaussianMM", v)}
            onKernelChange={(v) => onFieldChange("PVCNativeSpaceKernel", v)}
            showAdvanced={showAdvanced}
          />
        </Stack>
      </Paper>

      <AdvancedDivider showAdvanced={showAdvanced} onToggle={onToggleAdvanced} />

      {showAdvanced && (
        <Stack gap="md">
          <Paper p="md" radius="md" withBorder>
            <Stack gap="sm">
              <Group gap="xs">
                <IconFocus2 size={18} style={{ color: "var(--mantine-color-grape-6)" }} />
                <Text fw={600} size="sm">
                  Registration Settings
                </Text>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Select
                  label={<DataParFieldLabel fieldKey="bRegistrationContrast" />}
                  data={[
                    { value: "0", label: "Control images to T1-weighted" },
                    { value: "1", label: "PWI to pseudo-CBF template as an intermediate" },
                    { value: "2", label: "Automatic based on spatial CoV of PWI" },
                    { value: "3", label: "Force PWI to pseudo-CBF intermediate" },
                  ]}
                  value={
                    dataPar.bRegistrationContrast != null
                      ? String(dataPar.bRegistrationContrast)
                      : null
                  }
                  onChange={(v) =>
                    onFieldChange("bRegistrationContrast", v ? Number(v) : undefined)
                  }
                  placeholder={FIELD_METADATA.bRegistrationContrast.defaultHint}
                  data-testid="field-bRegistrationContrast"
                />

                <Select
                  label={<DataParFieldLabel fieldKey="bAffineRegistration" />}
                  data={[
                    { value: "0", label: "Rigid-body" },
                    { value: "1", label: "Affine" },
                    { value: "2", label: "Automatic (based on perfusion variation)" },
                  ]}
                  value={
                    dataPar.bAffineRegistration != null ? String(dataPar.bAffineRegistration) : null
                  }
                  onChange={(v) => onFieldChange("bAffineRegistration", v ? Number(v) : undefined)}
                  placeholder={FIELD_METADATA.bAffineRegistration.defaultHint}
                  data-testid="field-bAffineRegistration"
                />

                <Select
                  label={<DataParFieldLabel fieldKey="bDCTRegistration" />}
                  data={[
                    { value: "0", label: "Disabled (affine only)" },
                    { value: "1", label: "Enabled" },
                    { value: "2", label: "Enabled with Partial Volume Correction" },
                  ]}
                  value={dataPar.bDCTRegistration != null ? String(dataPar.bDCTRegistration) : null}
                  onChange={(v) => onFieldChange("bDCTRegistration", v ? Number(v) : undefined)}
                  placeholder={FIELD_METADATA.bDCTRegistration.defaultHint}
                  data-testid="field-bDCTRegistration"
                />

                <Group gap="xs" align="center" style={{ minHeight: "36px" }}>
                  <FlagToggle
                    fieldKey="bUseMNIasDummyStructural"
                    value={dataPar.bUseMNIasDummyStructural}
                    onChange={(v) => onFieldChange("bUseMNIasDummyStructural", v)}
                  />
                </Group>
              </SimpleGrid>
            </Stack>
          </Paper>

          <Paper p="md" radius="md" withBorder>
            <Stack gap="sm">
              <Group gap="xs">
                <IconTimeline size={18} style={{ color: "var(--mantine-color-grape-6)" }} />
                <Text fw={600} size="sm">
                  Spike Removal & Additional Options
                </Text>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
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
                  label={<DataParFieldLabel fieldKey="bHct2BloodT1" />}
                  data={[
                    { value: "0", label: "Disabled (use fixed blood T1)" },
                    { value: "1", label: "Use Hematocrit (Hct) values" },
                    { value: "2", label: "Estimate from Age and Sex" },
                  ]}
                  value={dataPar.bHct2BloodT1 != null ? String(dataPar.bHct2BloodT1) : null}
                  onChange={(v) => onFieldChange("bHct2BloodT1", v ? Number(v) : undefined)}
                  placeholder={FIELD_METADATA.bHct2BloodT1.defaultHint}
                  data-testid="field-bHct2BloodT1"
                />
              </SimpleGrid>

              <ApplyQuantificationGroup
                value={dataPar.ApplyQuantification}
                onChange={(v) => onFieldChange("ApplyQuantification", v)}
              />
            </Stack>
          </Paper>
        </Stack>
      )}
    </Stack>
  );
}
