import { Alert, Box, Button, Group, Stack, Stepper, Text, Tooltip } from "@mantine/core";
import { IconFileReport } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import HeaderCard from "../components/common/HeaderCard";
import ManifestPreview from "../components/manifest/ManifestPreview";
import QcSelectionTable, { type QcSelectionDrafts } from "../components/manifest/QcSelectionTable";
import ReviewerTabs from "../components/manifest/ReviewerTabs";
import VerdictResolution, { type ResolutionDrafts } from "../components/manifest/VerdictResolution";
import { areDisagreementsResolved } from "../components/manifest/VerdictResolution.helpers";
import { deriveDisagreements, useManifestStore } from "../stores/manifestStore";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import type { Reviewer } from "../schemas/project";
import "../components/manifest/Manifest.css";

const EMPTY_REVIEWERS: Reviewer[] = [];

export default function ManifestPage() {
  const projectKey = useProjectStore(
    (s) =>
      `${s.project?.activationGeneration}:${s.project?.projectMeta.id}:${s.project?.projectMeta.rootPath}`,
  );
  return <ManifestPageContent key={projectKey} />;
}

function ManifestPageContent() {
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

  const qcDraftState = useState<QcSelectionDrafts>(() => ({
    pendingFails: new Map(),
    notes: new Map(),
  }));
  const resolutionDraftState = useState<ResolutionDrafts>(() => ({ pendingFails: {}, notes: {} }));
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const eligibleSubjectSessions = useMemo(
    () =>
      availableSubjects
        .filter(({ subjectSession }) => !qcLoaded || !qcData || subjectSession in qcData)
        .map(({ subjectSession }) => subjectSession),
    [availableSubjects, qcData, qcLoaded],
  );
  const allReviewersReady =
    reviewers.length > 0 &&
    reviewers.every((reviewer) =>
      eligibleSubjectSessions.every((subjectSession) =>
        Boolean(verdicts?.[reviewer.id]?.[subjectSession]),
      ),
    );
  const disagreements = useMemo(() => deriveDisagreements(manifest), [manifest]);
  // Drafts belong to original ratings; reviewer labels and saved resolution mtimes are irrelevant.
  const disagreementSources = useMemo(
    () =>
      new Map(
        disagreements.map(({ subjectSession, verdictsByReviewer }) => [
          subjectSession,
          JSON.stringify(
            Object.entries(verdictsByReviewer)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([id, verdict]) => [
                id,
                verdict.status,
                verdict.reason,
                verdict.notes,
                verdict.setAt,
              ]),
          ),
        ]),
      ),
    [disagreements],
  );
  const [previousDisagreementSources, setPreviousDisagreementSources] =
    useState(disagreementSources);
  // Reconcile before commit, preserving drafts for unchanged disagreements.
  if (previousDisagreementSources !== disagreementSources) {
    setPreviousDisagreementSources(disagreementSources);
    resolutionDraftState[1]((previous) => {
      const unchanged = (subjectSession: string) =>
        disagreementSources.has(subjectSession) &&
        previousDisagreementSources.get(subjectSession) === disagreementSources.get(subjectSession);
      const pendingFails = Object.fromEntries(
        Object.entries(previous.pendingFails).filter(([subjectSession]) =>
          unchanged(subjectSession),
        ),
      );
      const notes = Object.fromEntries(
        Object.entries(previous.notes).filter(([subjectSession]) => unchanged(subjectSession)),
      );
      return Object.keys(pendingFails).length === Object.keys(previous.pendingFails).length &&
        Object.keys(notes).length === Object.keys(previous.notes).length
        ? previous
        : { pendingFails, notes };
    });
  }
  const draftErrors = useProjectStore((s) => s.draftErrors);
  const hasReviewDrafts = Object.keys(draftErrors).some((field) => field.startsWith("manifest:"));
  const hasQcReviewDrafts = Object.keys(draftErrors).some(
    (field) => field.startsWith("manifest:") && field !== "manifest:resolution",
  );
  const hasPendingQcFails = reviewers.some(({ id }) => qcDraftState[0].pendingFails.get(id)?.size);
  const hasPendingQcNotes = reviewers.some(({ id }) => qcDraftState[0].notes.get(id)?.size);
  const hasQcDrafts = hasPendingQcFails || hasPendingQcNotes;
  const qcNextReady = qcLoaded && allReviewersReady && !hasQcReviewDrafts && !hasQcDrafts;
  const hasResolutionStep = multiReviewer && disagreements.length > 0;
  const resolutionsReady =
    areDisagreementsResolved(disagreements, resolvedVerdicts) &&
    !hasReviewDrafts &&
    !Object.keys(resolutionDraftState[0].pendingFails).length &&
    !Object.keys(resolutionDraftState[0].notes).length;
  const previewStep = hasResolutionStep ? 2 : 1;
  const activeStep =
    hasResolutionStep && step === 2 && !resolutionsReady ? 1 : Math.min(step, previewStep);

  const setDraftError = useProjectStore((s) => s.setDraftError);
  const qcDraftError = hasPendingQcFails
    ? "Complete pending Fail verdicts"
    : hasPendingQcNotes
      ? "Complete pending notes"
      : null;
  const resolutionDraftError = Object.keys(resolutionDraftState[0].pendingFails).length
    ? "Complete pending Fail resolutions"
    : Object.keys(resolutionDraftState[0].notes).length
      ? "Complete pending resolution notes"
      : null;
  // Page-owned drafts keep Save/navigation guarded even while their editor is unmounted.
  useEffect(() => {
    setDraftError("manifest:qc", qcDraftError);
    setDraftError("manifest:resolution", resolutionDraftError);
  }, [setDraftError, qcDraftError, resolutionDraftError]);
  useEffect(
    () => () => {
      setDraftError("manifest:qc", null);
      setDraftError("manifest:resolution", null);
    },
    [setDraftError],
  );

  // Trigger loading and mtime/staleness recomputation
  useEffect(() => {
    if (projectRoot) {
      loadQcData(projectRoot);
      loadDataPar(projectRoot);

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
    <Stack
      data-testid="manifest-page"
      className={`manifest-page ${activeStep === 0 ? "manifest-page-review" : "manifest-page-capped"}`}
      gap="md"
    >
      <HeaderCard
        icon={IconFileReport}
        title="Manifest"
        subtitle="Review subject-level QC results, triage sessions, and export a journal-ready project manifest."
        color="teal"
        dataTestId="manifest-header"
      />
      <Stepper
        active={activeStep}
        onStepClick={handleStepClick}
        size="sm"
        aria-label="Manifest stages"
        data-testid="manifest-stepper"
      >
        <Stepper.Step
          label="QC Selection"
          data-testid="manifest-step-qc"
          aria-current={activeStep === 0 ? "step" : undefined}
        />
        {hasResolutionStep && (
          <Stepper.Step
            label={`Verdict Resolution (${disagreements.length})`}
            data-testid="manifest-step-resolution"
            allowStepSelect={qcNextReady}
            aria-current={activeStep === 1 ? "step" : undefined}
          />
        )}
        <Stepper.Step
          label="Preview & Export"
          data-testid="manifest-step-preview"
          allowStepSelect={qcNextReady && (!hasResolutionStep || resolutionsReady)}
          aria-current={activeStep === previewStep ? "step" : undefined}
        />
      </Stepper>

      {!qcLoaded ? (
        <Alert color="blue" title="Loading QC evidence" data-testid="manifest-qc-load-notice">
          Existing decisions remain stored. Continue after loading finishes.
        </Alert>
      ) : !qcData ? (
        <Alert color="red" title="QC evidence unavailable" data-testid="manifest-qc-load-notice">
          Metrics could not be loaded. Entries are not excluded as No Info; review decisions remain
          stored.
        </Alert>
      ) : null}

      {activeStep === 0 ? (
        <Stack gap="md">
          <ReviewerTabs
            eligibleSubjectSessions={eligibleSubjectSessions}
            inventoryCount={availableSubjects.length}
          >
            {(reviewerId) => <QcSelectionTable reviewerId={reviewerId} draftState={qcDraftState} />}
          </ReviewerTabs>
          <Alert
            color={qcNextReady ? "blue" : "orange"}
            title={
              qcNextReady
                ? "All eligible reviews complete"
                : "Complete required reviews before continuing"
            }
            data-testid="manifest-cohort-readiness"
          >
            <Text size="sm">
              {reviewers
                .map(
                  ({ id, label }) =>
                    `${label}: ${eligibleSubjectSessions.filter((subjectSession) => verdicts?.[id]?.[subjectSession]).length}/${eligibleSubjectSessions.length}`,
                )
                .join(" · ")}{" "}
              ·{" "}
              {Array.from(qcDraftState[0].pendingFails.values()).reduce(
                (count, slice) => count + slice.size,
                0,
              ) +
                Array.from(qcDraftState[0].notes.values()).reduce(
                  (count, slice) => count + slice.size,
                  0,
                )}{" "}
              pending drafts.
            </Text>
            <Text size="xs" mt={4}>
              Neutral blocks progression; No Info is derived after successful QC loading. Stale is a
              warning. Filters and search do not change eligibility.
            </Text>
          </Alert>
          <Group justify="flex-end" data-testid="manifest-qc-footer">
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
          <VerdictResolution disagreements={disagreements} draftState={resolutionDraftState} />
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
