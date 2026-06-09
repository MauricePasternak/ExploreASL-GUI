import { Switch, NumberInput, Group, Stack, Text } from "@mantine/core";

interface PVCConfigProps {
  bPVCNativeSpace: boolean | undefined;
  bPVCGaussianMM: boolean | undefined;
  PVCNativeSpaceKernel: [number, number, number] | undefined;
  onBpvChange: (v: boolean) => void;
  onGaussianChange: (v: boolean) => void;
  onKernelChange: (v: [number, number, number]) => void;
}

export function PVCConfig({
  bPVCNativeSpace,
  bPVCGaussianMM,
  PVCNativeSpaceKernel,
  onBpvChange,
  onGaussianChange,
  onKernelChange,
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
      <Switch
        label="Partial volume correction (native space)"
        checked={pvcEnabled}
        onChange={() => onBpvChange(!pvcEnabled)}
      />
      {pvcEnabled && (
        <Stack gap="xs" pl="md">
          <Switch
            label="Gaussian kernel (mm)"
            checked={gaussianEnabled}
            onChange={() => onGaussianChange(!gaussianEnabled)}
          />
          <Text size="sm" fw={500}>
            {gaussianEnabled ? "Kernel FWHM (mm)" : "Kernel size (voxels)"}
          </Text>
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
              />
            ))}
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
