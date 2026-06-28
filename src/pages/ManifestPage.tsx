import { Stack, Stepper, Group, Button, Tooltip, Box } from "@mantine/core";
import { useState, useEffect } from "react";
import { useManifestStore } from "../stores/manifestStore";
import { useProjectStore } from "../stores/projectStore";
import QcSelectionTable from "../components/manifest/QcSelectionTable";
import ManifestPreview from "../components/manifest/ManifestPreview";

export default function ManifestPage() {
  const step = useManifestStore((s) => s.step);
  const setStep = useManifestStore((s) => s.setStep);
  const recomputeStaleVerdicts = useManifestStore((s) => s.recomputeStaleVerdicts);
  const loadQcData = useManifestStore((s) => s.loadQcData);
  const loadDataPar = useManifestStore((s) => s.loadDataPar);

  const projectRoot = useProjectStore((s) => s.project?.projectMeta.rootPath);
  const verdicts = useProjectStore((s) => s.project?.uiState?.manifest?.verdicts);

  const [nextReady, setNextReady] = useState(false);

  // Trigger loading and mtime/staleness recomputation
  useEffect(() => {
    if (projectRoot) {
      loadQcData(projectRoot);
      loadDataPar(projectRoot);
    }
  }, [projectRoot, loadQcData, loadDataPar]);

  useEffect(() => {
    recomputeStaleVerdicts();
  }, [recomputeStaleVerdicts, verdicts]);

  const handleStepClick = (s: number) => {
    if (s === 1 && !nextReady) return;
    setStep(s as 0 | 1);
  };

  return (
    <Stack data-testid="manifest-page" gap="md">
      <Stepper active={step} onStepClick={handleStepClick} data-testid="manifest-stepper">
        <Stepper.Step label="QC Selection" description="Review and triage subjects" />
        <Stepper.Step label="Preview & Export" description="Review manifest and export" />
      </Stepper>

      {step === 0 ? (
        <Stack gap="md">
          <QcSelectionTable onNextReady={setNextReady} />
          <Group justify="flex-end" mt="md">
            {nextReady ? (
              <Button data-testid="next-button" onClick={() => setStep(1)}>
                Next
              </Button>
            ) : (
              <Tooltip label="Resolve all Neutral verdicts or exclude via No Info before proceeding">
                <Box style={{ display: "inline-block" }}>
                  <Button data-testid="next-button" disabled>
                    Next
                  </Button>
                </Box>
              </Tooltip>
            )}
          </Group>
        </Stack>
      ) : (
        <ManifestPreview />
      )}
    </Stack>
  );
}
