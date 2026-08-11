import { Box, Button, Group, Stack, Stepper, Tooltip } from "@mantine/core";
import { IconFileReport } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import HeaderCard from "../components/common/HeaderCard";
import ManifestPreview from "../components/manifest/ManifestPreview";
import QcSelectionTable from "../components/manifest/QcSelectionTable";
import ReviewerTabs from "../components/manifest/ReviewerTabs";
import VerdictResolution from "../components/manifest/VerdictResolution";
import { areDisagreementsResolved } from "../components/manifest/VerdictResolution.helpers";
import { deriveDisagreements, useManifestStore } from "../stores/manifestStore";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import type { Reviewer } from "../schemas/project";

const EMPTY_REVIEWERS: Reviewer[] = [];

export default function ManifestPage() {
  const step = useManifestStore((s) => s.step);
  const setStep = useManifestStore((s) => s.setStep);
  const loadPriorModulesMtimes = useManifestStore((s) => s.loadPriorModulesMtimes);
  const computeStaleVerdicts = useManifestStore((s) => s.computeStaleVerdicts);
  const loadQcData = useManifestStore((s) => s.loadQcData);
  const loadDataPar = useManifestStore((s) => s.loadDataPar);
  const qcData = useManifestStore((s) => s.qcData);
  const qcLoaded = useManifestStore((s) => s.qcLoaded);

  const projectRoot = useProjectStore((s) => s.project?.projectMeta.rootPath);
  const manifest = useProjectStore((s) => s.project?.uiState?.manifest);
  const verdicts = useProjectStore((s) => s.project?.uiState?.manifest?.verdicts);
  const resolvedVerdicts = useProjectStore((s) => s.project?.uiState?.manifest?.resolvedVerdicts);
  const reviewers = useProjectStore(
    (s) => s.project?.uiState?.manifest?.reviewers ?? EMPTY_REVIEWERS,
  );
  const multiReviewer = reviewers.length > 1;

  const [singleReviewerNextReady, setSingleReviewerNextReady] = useState(false);
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const eligibleSubjectSessions = useMemo(
    () =>
      availableSubjects
        .filter(({ subjectSession }) => !qcLoaded || !qcData || subjectSession in qcData)
        .map(({ subjectSession }) => subjectSession),
    [availableSubjects, qcData, qcLoaded],
  );
  const multiReviewerNextReady = useMemo(() => {
    if (!multiReviewer) return false;
    if (typeof verdicts !== "object" || verdicts === null || Array.isArray(verdicts)) return false;

    const verdictSlices = verdicts as Record<string, Record<string, unknown>>;
    return reviewers.every((reviewer) => {
      const reviewerVerdicts = verdictSlices[reviewer.id];
      return (
        typeof reviewerVerdicts === "object" &&
        reviewerVerdicts !== null &&
        eligibleSubjectSessions.every((subjectSession) => subjectSession in reviewerVerdicts)
      );
    });
  }, [eligibleSubjectSessions, multiReviewer, reviewers, verdicts]);
  const disagreements = useMemo(() => deriveDisagreements(manifest), [manifest]);
  const qcNextReady = multiReviewer ? multiReviewerNextReady : singleReviewerNextReady;
  const hasResolutionStep = multiReviewer && disagreements.length > 0;
  const resolutionsReady = areDisagreementsResolved(disagreements, resolvedVerdicts);
  const previewStep = hasResolutionStep ? 2 : 1;
  const activeStep =
    hasResolutionStep && step === 2 && !resolutionsReady ? 1 : Math.min(step, previewStep);

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
    if (projectRoot) {
      loadPriorModulesMtimes();
    }
  }, [projectRoot, loadPriorModulesMtimes]);

  useEffect(() => {
    computeStaleVerdicts();
  }, [computeStaleVerdicts, verdicts]);

  const handleStepClick = (s: number) => {
    if (s > 0 && !qcNextReady) return;
    if (hasResolutionStep && s === previewStep && !resolutionsReady) return;
    setStep(s as 0 | 1 | 2);
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
      <Stepper active={activeStep} onStepClick={handleStepClick} data-testid="manifest-stepper">
        <Stepper.Step
          label="QC Selection"
          description="Review and triage subjects"
          data-testid="manifest-step-qc"
        />
        {hasResolutionStep && (
          <Stepper.Step
            label={`Verdict Resolution (${disagreements.length})`}
            description="Resolve reviewer disagreements"
            data-testid="manifest-step-resolution"
          />
        )}
        <Stepper.Step
          label="Preview & Export"
          description="Review manifest and export"
          data-testid="manifest-step-preview"
        />
      </Stepper>

      {activeStep === 0 ? (
        <Stack gap="md">
          <ReviewerTabs eligibleSubjectSessions={eligibleSubjectSessions}>
            {(reviewerId, addControl) => (
              <QcSelectionTable
                reviewerId={reviewerId}
                onNextReady={multiReviewer ? undefined : setSingleReviewerNextReady}
                addControl={addControl}
              />
            )}
          </ReviewerTabs>
          <Group justify="flex-end" mt="md">
            {qcNextReady ? (
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
      ) : hasResolutionStep && activeStep === 1 ? (
        <Stack gap="md">
          <VerdictResolution disagreements={disagreements} />
          <Group justify="space-between">
            <Button
              variant="default"
              data-testid="resolution-back-button"
              onClick={() => setStep(0)}
            >
              Back
            </Button>
            <Tooltip label="Resolve every current reviewer disagreement before previewing the manifest">
              <Box style={{ display: "inline-block" }}>
                <Button
                  data-testid="resolution-next-button"
                  disabled={!resolutionsReady}
                  onClick={() => setStep(2)}
                >
                  Next
                </Button>
              </Box>
            </Tooltip>
          </Group>
        </Stack>
      ) : activeStep === previewStep ? (
        <Stack gap="md">
          <Group justify="flex-start">
            <Button
              variant="default"
              data-testid="back-button"
              onClick={() => setStep(hasResolutionStep ? 1 : 0)}
            >
              Back
            </Button>
          </Group>
          <ManifestPreview />
        </Stack>
      ) : null}
    </Stack>
  );
}
