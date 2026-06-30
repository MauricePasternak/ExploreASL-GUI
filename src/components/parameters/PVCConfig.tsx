import { Switch, Group, Stack, Select } from "@mantine/core";
import { DataParFieldLabel } from "./DataParFieldLabel";
import { NumberTupleInput } from "./NumberTupleInput";
import { fromFlag, toFlag } from "../../lib/dataParFlags";

interface PVCConfigProps {
  bPVCNativeSpace: 0 | 1 | undefined;
  bPVCGaussianMM: 0 | 1 | undefined;
  PVCNativeSpaceKernel: [number, number, number] | undefined;
  onBpvChange: (v: 0 | 1) => void;
  onGaussianChange: (v: 0 | 1) => void;
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
  const pvcEnabled = fromFlag(bPVCNativeSpace);
  const gaussianEnabled = fromFlag(bPVCGaussianMM);
  const kernel = PVCNativeSpaceKernel ?? (gaussianEnabled ? [10, 10, 4] : [5, 5, 1]);

  return (
    <Stack gap="sm">
      <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
        <Switch
          id="switch-bPVCNativeSpace"
          checked={pvcEnabled}
          onChange={() => onBpvChange(toFlag(!pvcEnabled))}
          data-testid="field-bPVCNativeSpace"
        />
        <DataParFieldLabel fieldKey="bPVCNativeSpace" htmlFor="switch-bPVCNativeSpace" />
      </Group>
      {pvcEnabled && showAdvanced && (
        <Stack gap="xs" pl="md">
          <Group gap="xs" align="center" style={{ minHeight: "32px" }}>
            <Select
              id="select-bPVCGaussianMM"
              data={[
                { label: "Gaussian", value: "1" },
                { label: "Flat", value: "0" },
              ]}
              value={gaussianEnabled ? "1" : "0"}
              onChange={(v) => onGaussianChange(toFlag(v === "1"))}
              data-testid="field-bPVCGaussianMM"
            />
            <DataParFieldLabel fieldKey="bPVCGaussianMM" htmlFor="switch-bPVCGaussianMM" />
          </Group>
          <DataParFieldLabel
            fieldKey="PVCNativeSpaceKernel"
            label={gaussianEnabled ? "Kernel FWHM (mm)" : "Kernel size (voxels)"}
          />
          <NumberTupleInput
            labels={gaussianEnabled ? ["LR", "AP", "IS"] : ["X", "Y", "Z"]}
            value={kernel as [number, number, number]}
            onChange={onKernelChange}
            testId="field-PVCNativeSpaceKernel"
            min={0}
          />
        </Stack>
      )}
    </Stack>
  );
}
