import { useEffect, useMemo } from "react";
import {
  Button,
  Group,
  Stack,
  Tabs,
  Title,
  Text,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCategory,
  IconReorder,
  IconUsers,
} from "@tabler/icons-react";

import { useImportStore } from "../../stores/importStore";
import { extractUniqueValues } from "../../lib/tokenizerUtils";
import { useGlobalStore } from "../../stores/globalStore";
import ModalityMappingTable from "./ModalityMappingTable";
import SessionRunOrder from "./SessionRunOrder";
import SubjectRenameTable from "./SubjectRenameTable";

/**
 * Step 3: Alias Resolution
 *
 * Three tabs:
 * 1. Modality Map — map raw scan names to ExploreASL modality types
 * 2. Session/Run Order — set chronological ordering of sessions/runs
 * 3. Subject Rename — rename subjects to BIDS-compliant names
 */
export default function AliasResolution() {
  const sourceDataPath = useImportStore((s) => s.sourceDataPath);
  const rawPaths = useImportStore((s) => s.rawPaths);
  const pathPatterns = useImportStore((s) => s.pathPatterns);
  const tokenizerConfigs = useImportStore((s) => s.tokenizerConfigs);
  const modalityAliases = useImportStore((s) => s.modalityAliases);
  const sessionAliases = useImportStore((s) => s.sessionAliases);
  const subjectRenames = useImportStore((s) => s.subjectRenames);
  const setModalityAliases = useImportStore((s) => s.setModalityAliases);
  const setSessionAliases = useImportStore((s) => s.setSessionAliases);
  const setSubjectRenames = useImportStore((s) => s.setSubjectRenames);
  const setActiveStep = useImportStore((s) => s.setActiveStep);
  const tokenSubDelimiters = useGlobalStore((s) => s.settings.tokenSubDelimiters);
  const hasDerivationContext =
    sourceDataPath.length > 0 && rawPaths.length > 0 && pathPatterns.length > 0;

  const derivedAliasState = useMemo(() => {
    const modalities = new Set<string>();
    const sessions = new Set<string>();
    const subjects = new Set<string>();

    for (const pattern of pathPatterns) {
      const assignments = tokenizerConfigs[pattern.signature] ?? [];
      if (assignments.length === 0) {
        continue;
      }

      extractUniqueValues(
        rawPaths,
        sourceDataPath,
        assignments,
        "Modality",
        pattern,
        tokenSubDelimiters,
      ).forEach((value) => modalities.add(value));
      extractUniqueValues(
        rawPaths,
        sourceDataPath,
        assignments,
        "Session",
        pattern,
        tokenSubDelimiters,
      ).forEach((value) => sessions.add(value));
      extractUniqueValues(
        rawPaths,
        sourceDataPath,
        assignments,
        "Subject",
        pattern,
        tokenSubDelimiters,
      ).forEach((value) => subjects.add(value));
    }

    return {
      modalities: [...modalities].sort(),
      sessions: [...sessions].sort(),
      subjects: [...subjects].sort(),
    };
  }, [pathPatterns, rawPaths, sourceDataPath, tokenizerConfigs, tokenSubDelimiters]);

  useEffect(() => {
    if (!hasDerivationContext) {
      return;
    }

    const modalityMap = new Map(
      modalityAliases.map((alias) => [alias.captured, alias.mapped]),
    );
    const nextModalities = derivedAliasState.modalities.map((captured) => ({
      captured,
      mapped: modalityMap.get(captured) ?? null,
    }));

    const sessions = derivedAliasState.sessions.map((captured, index) => ({
      captured,
      alias:
        sessionAliases.find((entry) => entry.captured === captured)?.alias ??
        `ASL_${index + 1}`,
      index:
        sessionAliases.find((entry) => entry.captured === captured)?.index ??
        index + 1,
    }));

    const renames = derivedAliasState.subjects.map((original) => ({
      original,
      target:
        subjectRenames.find((entry) => entry.original === original)?.target ??
        original,
    }));

    if (JSON.stringify(modalityAliases) !== JSON.stringify(nextModalities)) {
      setModalityAliases(nextModalities);
    }
    if (JSON.stringify(sessionAliases) !== JSON.stringify(sessions)) {
      setSessionAliases(sessions);
    }
    if (JSON.stringify(subjectRenames) !== JSON.stringify(renames)) {
      setSubjectRenames(renames);
    }
  }, [
    hasDerivationContext,
    derivedAliasState,
    modalityAliases,
    sessionAliases,
    setModalityAliases,
    setSessionAliases,
    setSubjectRenames,
    subjectRenames,
  ]);

  function handleBack() {
    setActiveStep(1);
  }

  function handleNext() {
    setActiveStep(3);
  }

  return (
    <Stack gap="md">
      <Title order={3}>Alias Resolution</Title>
      <Text c="dimmed" size="sm">
        Map raw folder names to standardized BIDS identifiers.
      </Text>

      <Tabs defaultValue="modality">
        <Tabs.List>
          <Tabs.Tab
            value="modality"
            leftSection={<IconCategory size={16} />}
          >
            Modality Map
          </Tabs.Tab>
          <Tabs.Tab
            value="session"
            leftSection={<IconReorder size={16} />}
          >
            Session / Run Order
          </Tabs.Tab>
          <Tabs.Tab
            value="subjects"
            leftSection={<IconUsers size={16} />}
          >
            Subject Rename
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="modality" pt="md">
          <ModalityMappingTable />
        </Tabs.Panel>

        <Tabs.Panel value="session" pt="md">
          <SessionRunOrder />
        </Tabs.Panel>

        <Tabs.Panel value="subjects" pt="md">
          <SubjectRenameTable />
        </Tabs.Panel>
      </Tabs>

      <Group justify="space-between">
        <Button
          leftSection={<IconArrowLeft size={16} />}
          variant="light"
          onClick={handleBack}
        >
          Back: Tokenize Paths
        </Button>
        <Button
          rightSection={<IconArrowRight size={16} />}
          onClick={handleNext}
        >
          Next: Metadata
        </Button>
      </Group>
    </Stack>
  );
}
