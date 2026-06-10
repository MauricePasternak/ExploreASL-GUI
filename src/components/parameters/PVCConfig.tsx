import { Switch, NumberInput, Group, Stack } from "@mantine/core";
import { DataParFieldLabel } from "./DataParFieldLabel";

interface PVCConfigProps {
  bPVCNativeSpace: boolean | undefined;
  bPVCGaussianMM: boolean | undefined;
  PVCNativeSpaceKernel: [number, number, number] | undefined;
  onBpvChange: (v: boolean) => void;
  onGaussianChange: (v: boolean) => void;
  onKernelChange: (v: [number, number, number]) => void;
  showAdvanced: boolean;
}

export function PVCConfig({
  bPVCNativeSpace,
  bPVCGaussianMM,
  PVCNativeSpaceKernel,
  onBpvChange,
  onGaussianChange,
  onKernelChange,
  showAdvanced,
}: PVCConfigProps) {
  const pvcEnabled = bPVCNativeSpace !== false;
  const gaussianEnabled = bPVCGaussianMM === true;
  const kernel = PVCNativeSpaceKernel ?? (gaussianEnabled ? [10, 10, 4] : [5, 5, 1]);

  const updateKernel = (index: number, value: number | string) => {
    const num = typeof value === "number" ? value : parseFloat(value) || 0;
    const next = [...kernel] as [number, number, number];
    next[index] = num;
    onKernelChange(next);
  };

  return (
    <Stack gap="sm">
      <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
        <Switch
          id="switch-bPVCNativeSpace"
          checked={pvcEnabled}
          onChange={() => onBpvChange(!pvcEnabled)}
          data-testid="field-bPVCNativeSpace"
        />
        <DataParFieldLabel fieldKey="bPVCNativeSpace" htmlFor="switch-bPVCNativeSpace" />
      </Group>
      {pvcEnabled && showAdvanced && (
        <Stack gap="xs" pl="md">
          <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
            <Switch
              id="switch-bPVCGaussianMM"
              checked={gaussianEnabled}
              onChange={() => onGaussianChange(!gaussianEnabled)}
              data-testid="field-bPVCGaussianMM"
            />
            <DataParFieldLabel fieldKey="bPVCGaussianMM" htmlFor="switch-bPVCGaussianMM" />
          </Group>
          <DataParFieldLabel
            fieldKey="PVCNativeSpaceKernel"
            label={gaussianEnabled ? "Kernel FWHM (mm)" : "Kernel size (voxels)"}
          />
          <Group gap="xs">
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <NumberInput
                key={axis}
                label={axis}
                value={kernel[i]}
                onChange={(v) => updateKernel(i, v ?? 0)}
                size="xs"
                w={80}
                min={0}
                data-testid={`field-PVCNativeSpaceKernel-${axis}`}
              />
            ))}
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
