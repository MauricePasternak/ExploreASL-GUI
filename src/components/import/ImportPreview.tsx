import { useMemo } from "react";
import { Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";

import { buildAllStagingMappings } from "../../lib/importPreviewUtils";
import { canEnterStep5 } from "../../lib/importStepAccess";
import { assembleSourcestructure, assembleStudyPar } from "../../lib/tokenizerUtils";
import { useGlobalStore } from "../../stores/globalStore";
import { useImportStore } from "../../stores/importStore";
import ConfigPreview from "./ConfigPreview";
import StagingMappingTable from "./StagingMappingTable";

export default function ImportPreview() {
  const rawPaths = useImportStore((s) => s.rawPaths);
  const sourceDataPath = useImportStore((s) => s.sourceDataPath);
  const ingestionComplete = useImportStore((s) => s.ingestionComplete);
  const pathPatterns = useImportStore((s) => s.pathPatterns);
  const tokenizerConfigs = useImportStore((s) => s.tokenizerConfigs);
  const modalityAliases = useImportStore((s) => s.modalityAliases);
  const sessionAliases = useImportStore((s) => s.sessionAliases);
  const runAliases = useImportStore((s) => s.runAliases);
  const subjectRenames = useImportStore((s) => s.subjectRenames);
  const bMatchDirectories = useImportStore((s) => s.bMatchDirectories);
  const metadataGroups = useImportStore((s) => s.metadataGroups);
  const subjectRows = useImportStore((s) => s.subjectRows);
  const setActiveStep = useImportStore((s) => s.setActiveStep);
  const settings = useGlobalStore((s) => s.settings);
  const tokenSubDelimiters = useGlobalStore((s) => s.settings.tokenSubDelimiters);

  const subjectRenamesMap = useMemo(
    () => Object.fromEntries(subjectRenames.map((r) => [r.original, r.target])),
    [subjectRenames],
  );

  const mappings = useMemo(
    () =>
      buildAllStagingMappings(
        rawPaths,
        sourceDataPath,
        pathPatterns,
        tokenizerConfigs,
        subjectRenamesMap,
        sessionAliases,
        modalityAliases,
        tokenSubDelimiters,
      ),
    [
      rawPaths,
      sourceDataPath,
      pathPatterns,
      tokenizerConfigs,
      subjectRenamesMap,
      sessionAliases,
      modalityAliases,
      tokenSubDelimiters,
    ],
  );

  const sourcestructure = useMemo(
    () => assembleSourcestructure(sessionAliases, runAliases, modalityAliases, bMatchDirectories),
    [sessionAliases, runAliases, modalityAliases, bMatchDirectories],
  );

  const studyPar = useMemo(
    () => assembleStudyPar(metadataGroups, subjectRows),
    [metadataGroups, subjectRows],
  );

  const totalEntries = mappings.reduce((sum, m) => sum + m.entries.length, 0);
  const totalSubjects = new Set(mappings.flatMap((m) => m.entries.map((e) => e.subject))).size;
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
    settings,
  );

  return (
    <Stack gap="md" data-testid="import-preview">
      <Title order={3}>Preview Import</Title>
      <Text c="dimmed" size="sm">
        Review how your DICOM data will be organized before running the import. Raw paths are
        symlinked into a normalized{" "}
        <Text fw={600} component="span">
          Subject/Session/Run/Modality
        </Text>{" "}
        staging tree, then ExploreASL processes that tree.
      </Text>

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
        mappings={mappings}
        subjectRows={subjectRows}
        metadataGroups={metadataGroups}
      />
      <ConfigPreview sourcestructure={sourcestructure} studyPar={studyPar} />
      <Group justify="space-between">
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
    </Stack>
  );
}
