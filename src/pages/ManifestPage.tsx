import { Box, Button, Group, Stack, Stepper, Tooltip } from "@mantine/core";
import { IconFileReport } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import HeaderCard from "../components/common/HeaderCard";
import ManifestPreview from "../components/manifest/ManifestPreview";
import QcSelectionTable from "../components/manifest/QcSelectionTable";
import { useManifestStore } from "../stores/manifestStore";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";

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

      // Hydrate processing config/phase from project file if available, and scan subjects / lock statuses
      const project = useProjectStore.getState().project;
      if (project) {
        const processing = project.uiState.processing;
        if (processing?.config) {
          useProcessingStore.getState().setConfig(processing.config);
        }
        if (processing?.currentPhase !== undefined) {
          useProcessingStore.getState().setPhase(processing.currentPhase);
        }
      }
      useProcessingStore.getState().scanAvailableSubjects().catch(console.error);
      useProcessingStore.getState().loadLockFileStatus().catch(console.error);
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
      <HeaderCard
        icon={IconFileReport}
        title="Manifest"
        subtitle="Review subject-level QC results, triage sessions, and export a journal-ready project manifest."
        color="teal"
        dataTestId="manifest-header"
      />
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
        <Stack gap="md">
          <Group justify="flex-start">
            <Button variant="default" data-testid="back-button" onClick={() => setStep(0)}>
              Back
            </Button>
          </Group>
          <ManifestPreview />
        </Stack>
      )}
    </Stack>
  );
}
