import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconArrowLeft, IconArrowRight, IconEye } from "@tabler/icons-react";
import { useMemo } from "react";
import HeaderCard from "../common/HeaderCard";

import { buildImportPlan } from "../../lib/importPlan";
import { canEnterStep5 } from "../../lib/importStepAccess";
import { useStagingPreflight } from "../../hooks/useStagingPreflight";
import { useGlobalStore } from "../../stores/globalStore";
import { EMPTY_IMPORT_SETTINGS, useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import { resolveLogicalSource } from "../../lib/projectPaths";
import ConfigPreview from "./ConfigPreview";
import StagingMappingTable from "./StagingMappingTable";
import ImportStepLayout from "./ImportStepLayout";

export default function ImportPreview() {
  const rawPaths = useProjectStore(
    (s) => s.project?.mappingState.rawPaths ?? EMPTY_IMPORT_SETTINGS.rawPaths,
  );
  const sourceDataPath = useProjectStore((s) => s.project?.mappingState.sourceDataPath ?? "");
  const ingestionComplete = useProjectStore(
    (s) => s.project?.mappingState.ingestionComplete ?? false,
  );
  const pathPatterns = useProjectStore(
    (s) => s.project?.mappingState.pathPatterns ?? EMPTY_IMPORT_SETTINGS.pathPatterns,
  );
  const tokenizerConfigs = useProjectStore(
    (s) => s.project?.mappingState.tokenizerConfigs ?? EMPTY_IMPORT_SETTINGS.tokenizerConfigs,
  );
  const modalityAliases = useProjectStore(
    (s) => s.project?.mappingState.modalityAliases ?? EMPTY_IMPORT_SETTINGS.modalityAliases,
  );
  const sessionAliases = useProjectStore(
    (s) => s.project?.mappingState.sessionAliases ?? EMPTY_IMPORT_SETTINGS.sessionAliases,
  );
  const runAliases = useProjectStore(
    (s) => s.project?.mappingState.runAliases ?? EMPTY_IMPORT_SETTINGS.runAliases,
  );
  const subjectRenames = useProjectStore(
    (s) => s.project?.mappingState.subjectRenames ?? EMPTY_IMPORT_SETTINGS.subjectRenames,
  );
  const bMatchDirectories = useProjectStore(
    (s) => s.project?.mappingState.bMatchDirectories ?? true,
  );
  const metadataGroups = useProjectStore(
    (s) => s.project?.mappingState.metadataGroups ?? EMPTY_IMPORT_SETTINGS.metadataGroups,
  );
  const subjectRows = useProjectStore(
    (s) => s.project?.mappingState.subjectRows ?? EMPTY_IMPORT_SETTINGS.subjectRows,
  );
  const setActiveStep = useImportStore((s) => s.setActiveStep);
  const settings = useGlobalStore((s) => s.settings);
  const profileValidationState = useGlobalStore((s) => s.profileValidationState);
  const tokenSubDelimiters = useGlobalStore((s) => s.settings.tokenSubDelimiters);
  const projectRoot = useProjectStore((s) => s.project?.projectMeta.rootPath ?? "");
  const resolvedSource = resolveLogicalSource(projectRoot, sourceDataPath, "dicom");

  const plan = useMemo(
    () =>
      buildImportPlan({
        rawPaths,
        sourceRoot: resolvedSource,
        pathPatterns,
        tokenizerConfigs,
        subjectRenames,
        sessionAliases,
        runAliases,
        modalityAliases,
        tokenSubDelimiters,
        bMatchDirectories,
        metadataGroups,
        subjectRows,
      }),
    [
      rawPaths,
      resolvedSource,
      pathPatterns,
      tokenizerConfigs,
      subjectRenames,
      sessionAliases,
      runAliases,
      modalityAliases,
      tokenSubDelimiters,
      bMatchDirectories,
      metadataGroups,
      subjectRows,
    ],
  );

  const { fingerprint, state: stagingPreflight } = useStagingPreflight(projectRoot, plan);

  const totalEntries = plan.entries.length;
  const totalSubjects = new Set(plan.entries.map((entry) => entry.subject)).size;
  const canProceedToStep5 = canEnterStep5(
    {
      ingestionComplete,
      pathPatterns,
      tokenizerConfigs,
      modalityAliases,
      sessionAliases,
      runAliases,
      bMatchDirectories,
      metadataGroups,
      subjectRows,
    },
    {
      executionProfiles: settings.executionProfiles,
      profileValidationState,
    },
    {
      status: stagingPreflight.status,
      fingerprint: stagingPreflight.fingerprint,
      currentFingerprint: fingerprint,
      localIssueCount: plan.localIssues.length,
    },
  );

  return (
    <ImportStepLayout
      testId="import-preview"
      navigation={
        <Group justify="space-between" data-testid="preview-nav">
          <Button
            leftSection={<IconArrowLeft size={16} />}
            variant="light"
            onClick={() => setActiveStep(3)}
            data-testid="preview-back-btn"
          >
            Back: Metadata
          </Button>
          <Button
            leftSection={<IconArrowRight size={16} />}
            disabled={!canProceedToStep5}
            onClick={() => setActiveStep(5)}
            data-testid="preview-next-btn"
          >
            Next: Run Import
          </Button>
        </Group>
      }
    >
      <HeaderCard
        icon={IconEye}
        title="Preview Import"
        subtitle={
          <Text c="dimmed" size="sm">
            Review how your DICOM data will be organized before running the import. Raw paths are
            symlinked into a normalized{" "}
            <Text fw={600} component="span">
              Subject/Session/Run/Modality
            </Text>{" "}
            staging tree, then ExploreASL processes that tree.
          </Text>
        }
        color="blue"
        dataTestId="import-preview-header"
      />

      <Stack gap="xs">
        <Text size="sm">
          <Text fw={600} component="span">
            {totalSubjects}
          </Text>{" "}
          subject
          {totalSubjects !== 1 ? "s" : ""} across{" "}
          <Text fw={600} component="span">
            {pathPatterns.length}
          </Text>{" "}
          pattern
          {pathPatterns.length !== 1 ? "s" : ""} ·{" "}
          <Text fw={600} component="span">
            {totalEntries}
          </Text>{" "}
          DICOM location
          {totalEntries !== 1 ? "s" : ""}
        </Text>
      </Stack>

      <StagingMappingTable
        mappings={plan.mappings}
        subjectRows={subjectRows}
        metadataGroups={metadataGroups}
      />
      <ConfigPreview sourcestructure={plan.sourcestructureJson} studyPar={plan.studyparJson} />
      {(plan.localIssues.length > 0 || stagingPreflight.status !== "valid") && (
        <Alert
          color="red"
          title="Staging validation blocks import"
          data-testid="staging-validation-summary"
        >
          <Stack gap="xs">
            {plan.localIssues.length > 0 && (
              <Text size="sm" data-testid="staging-local-issues">
                {plan.localIssues.length} local mapping issue
                {plan.localIssues.length === 1 ? "" : "s"}.
              </Text>
            )}
            {stagingPreflight.status === "pending" && (
              <Text size="sm" data-testid="staging-preflight-pending">
                Checking source and destination plan…
              </Text>
            )}
            {stagingPreflight.status === "failed" && (
              <Text size="sm" data-testid="staging-preflight-failed">
                {stagingPreflight.error}
              </Text>
            )}
            {stagingPreflight.status === "invalid" && (
              <Text size="sm" data-testid="staging-native-issues">
                {stagingPreflight.issues.length} native source or destination issue
                {stagingPreflight.issues.length === 1 ? "" : "s"}.
              </Text>
            )}
            {plan.localIssues.map((issue, index) => (
              <Text key={`local-${index}`} size="xs" data-testid={`staging-local-issue-${index}`}>
                {issue.message}
              </Text>
            ))}
            {stagingPreflight.issues.map((issue, index) => (
              <Text key={`native-${index}`} size="xs" data-testid={`staging-native-issue-${index}`}>
                {issue.message}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
    </ImportStepLayout>
  );
}
