import { Stack, Stepper } from "@mantine/core";
import { useManifestStore } from "../stores/manifestStore";
import QcSelectionTable from "../components/manifest/QcSelectionTable";
import ManifestPreview from "../components/manifest/ManifestPreview";

export default function ManifestPage() {
  const step = useManifestStore((s) => s.step);
  const setStep = useManifestStore((s) => s.setStep);

  return (
    <Stack data-testid="manifest-page" gap="md">
      <Stepper
        active={step}
        onStepClick={(s) => setStep(s as 0 | 1)}
        data-testid="manifest-stepper"
      >
        <Stepper.Step label="QC Selection" description="Review and triage subjects" />
        <Stepper.Step label="Preview & Export" description="Review manifest and export" />
      </Stepper>
      {step === 0 ? <QcSelectionTable onNextReady={() => {}} /> : <ManifestPreview />}
    </Stack>
  );
}
