import { useEffect, useMemo } from "react";
import {
  Button,
  Group,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCategory,
  IconListNumbers,
  IconReorder,
  IconUsers,
} from "@tabler/icons-react";

import {
  hasTokenizerTag,
  isAliasResolutionComplete,
} from "../../lib/importStepAccess";
import { extractUniqueValues } from "../../lib/tokenizerUtils";
import { useImportStore } from "../../stores/importStore";
import { useGlobalStore } from "../../stores/globalStore";
import type { SessionAlias } from "../../schemas/importSchemas";
import ModalityMappingTable from "./ModalityMappingTable";
import OrderAliasTable from "./SessionRunOrder";
import SubjectRenameTable from "./SubjectRenameTable";

function compareAlphaNumeric(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function buildOrderAliases(
  capturedValues: string[],
  existing: SessionAlias[],
  defaultAlias: (captured: string, index: number) => string,
): SessionAlias[] {
  const sorted = [...capturedValues].sort(compareAlphaNumeric);

  return sorted.map((captured, index) => {
    const prior = existing.find((entry) => entry.captured === captured);
    return {
      captured,
      alias: prior?.alias ?? defaultAlias(captured, index),
      index: prior?.index ?? index + 1,
    };
  });
}

/**
 * Step 3: Alias Resolution
 *
 * Four tabs:
 * 1. Subject Rename — rename subjects to BIDS-compliant names
 * 2. Session Order — order captured visit/session values
 * 3. Run Order — order captured run values with ASL_N aliases
 * 4. Modality Map — map raw scan names to ExploreASL modality types
 */
export default function AliasResolution() {
  const sourceDataPath = useImportStore((s) => s.sourceDataPath);
  const rawPaths = useImportStore((s) => s.rawPaths);
  const pathPatterns = useImportStore((s) => s.pathPatterns);
  const tokenizerConfigs = useImportStore((s) => s.tokenizerConfigs);
  const modalityAliases = useImportStore((s) => s.modalityAliases);
  const sessionAliases = useImportStore((s) => s.sessionAliases);
  const runAliases = useImportStore((s) => s.runAliases);
  const subjectRenames = useImportStore((s) => s.subjectRenames);
  const setModalityAliases = useImportStore((s) => s.setModalityAliases);
  const setSessionAliases = useImportStore((s) => s.setSessionAliases);
  const setRunAliases = useImportStore((s) => s.setRunAliases);
  const setSubjectRenames = useImportStore((s) => s.setSubjectRenames);
  const setActiveStep = useImportStore((s) => s.setActiveStep);
  const tokenSubDelimiters = useGlobalStore((s) => s.settings.tokenSubDelimiters);
  const hasDerivationContext =
    sourceDataPath.length > 0 && rawPaths.length > 0 && pathPatterns.length > 0;

  const hasSessionToken = useMemo(
    () => hasTokenizerTag(tokenizerConfigs, "Session"),
    [tokenizerConfigs],
  );
  const hasRunToken = useMemo(
    () => hasTokenizerTag(tokenizerConfigs, "Run"),
    [tokenizerConfigs],
  );
  const canProceed = isAliasResolutionComplete({ modalityAliases });

  const derivedAliasState = useMemo(() => {
    const modalities = new Set<string>();
    const sessions = new Set<string>();
    const runs = new Set<string>();
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
        "Run",
        pattern,
        tokenSubDelimiters,
      ).forEach((value) => runs.add(value));
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
      modalities: [...modalities].sort(compareAlphaNumeric),
      sessions: [...sessions].sort(compareAlphaNumeric),
      runs: [...runs].sort(compareAlphaNumeric),
      subjects: [...subjects].sort(compareAlphaNumeric),
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

    const sessions = hasSessionToken
      ? buildOrderAliases(
          derivedAliasState.sessions,
          sessionAliases,
          (captured) => captured,
        )
      : [];

    const runs = hasRunToken
      ? buildOrderAliases(
          derivedAliasState.runs,
          runAliases,
          (_captured, index) => `ASL_${index + 1}`,
        )
      : [];

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
    if (JSON.stringify(runAliases) !== JSON.stringify(runs)) {
      setRunAliases(runs);
    }
    if (JSON.stringify(subjectRenames) !== JSON.stringify(renames)) {
      setSubjectRenames(renames);
    }
  }, [
    hasDerivationContext,
    derivedAliasState,
    hasRunToken,
    hasSessionToken,
    modalityAliases,
    runAliases,
    sessionAliases,
    setModalityAliases,
    setRunAliases,
    setSessionAliases,
    setSubjectRenames,
    subjectRenames,
  ]);

  function handleBack() {
    setActiveStep(1);
  }

  function handleNext() {
    if (canProceed) {
      setActiveStep(3);
    }
  }

  return (
    <Stack gap="md" data-testid="alias-resolution">
      <Title order={3}>Alias Resolution</Title>
      <Text c="dimmed" size="sm">
        Map raw folder names to standardized BIDS identifiers.
      </Text>

      <Tabs defaultValue="subjects">
        <Tabs.List>
          <Tabs.Tab
            value="subjects"
            leftSection={<IconUsers size={16} />}
            data-testid="alias-tab-subjects"
          >
            Subject Rename
          </Tabs.Tab>
          <Tabs.Tab
            value="session"
            leftSection={<IconReorder size={16} />}
            disabled={!hasSessionToken}
            data-testid="alias-tab-session"
          >
            Session Order
          </Tabs.Tab>
          <Tabs.Tab
            value="run"
            leftSection={<IconListNumbers size={16} />}
            disabled={!hasRunToken}
            data-testid="alias-tab-run"
          >
            Run Order
          </Tabs.Tab>
          <Tabs.Tab
            value="modality"
            leftSection={<IconCategory size={16} />}
            data-testid="alias-tab-modality"
          >
            Modality Map
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="subjects" pt="md">
          <SubjectRenameTable />
        </Tabs.Panel>

        <Tabs.Panel value="session" pt="md">
          <OrderAliasTable
            aliases={sessionAliases}
            onAliasesChange={setSessionAliases}
            emptyMessage='No sessions detected. Assign a "Session" tag in the Path Tokenizer step, or the default "01" will be used automatically.'
            description="Assign display aliases and chronological ordering to each captured session value."
            emptyTestId="session-order-empty"
            tableTestId="session-order-table"
          />
        </Tabs.Panel>

        <Tabs.Panel value="run" pt="md">
          <OrderAliasTable
            aliases={runAliases}
            onAliasesChange={setRunAliases}
            emptyMessage='No runs detected. Assign a "Run" tag in the Path Tokenizer step, or the default "01" will be used automatically.'
            description="Assign ASL run aliases and chronological ordering to each captured run value."
            emptyTestId="run-order-empty"
            tableTestId="run-order-table"
          />
        </Tabs.Panel>

        <Tabs.Panel value="modality" pt="md">
          <ModalityMappingTable />
        </Tabs.Panel>
      </Tabs>

      {!canProceed && modalityAliases.length > 0 && (
        <Text size="sm" c="red" data-testid="alias-modality-required">
          Map at least one modality to ASL4D or T1w before continuing.
        </Text>
      )}

      <Group justify="space-between">
        <Button
          leftSection={<IconArrowLeft size={16} />}
          variant="light"
          onClick={handleBack}
          data-testid="alias-back-btn"
        >
          Back: Tokenize Paths
        </Button>
        <Button
          rightSection={<IconArrowRight size={16} />}
          onClick={handleNext}
          disabled={!canProceed}
          data-testid="alias-next-btn"
        >
          Next: Metadata
        </Button>
      </Group>
    </Stack>
  );
}
