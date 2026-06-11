import { useMemo } from "react";
import { Alert, Group, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

import ControlButtons from "../components/processing/ControlButtons";
import ExecutionDashboard from "../components/processing/ExecutionDashboard";
import PipelineConfig from "../components/processing/PipelineConfig";
import PreflightCheck from "../components/processing/PreflightCheck";
import ResultsSummary from "../components/processing/ResultsSummary";
import SubjectSelection from "../components/processing/SubjectSelection";
import { useProcessingSync } from "../hooks/useProcessingSync";
import { useProcessingStore } from "../stores/processingStore";

export default function ProcessingPage() {
  useProcessingSync();

  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);
  const isRunning = processingPhase === "running" || processingPhase === "preparing";
  const showConfig = processingPhase === "idle" || processingPhase === "completed" || processingPhase === "failed" || processingPhase === "cancelled";

  // Orphaned lock entries: subjects in rawdata but not in availableSubjects
  const orphanedSubjects = useMemo(() => {
    const subjectSet = new Set(availableSubjects.map((s) => s.subjectSession));
    return subjectStatuses
      .filter((s) => !subjectSet.has(s.subjectSession))
      .map((s) => s.subjectSession)
      .filter((v, i, a) => a.indexOf(v) === i);
  }, [availableSubjects, subjectStatuses]);

  return (
    <Stack gap="md" data-testid="processing-page">
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">
          Processing
        </Text>
        <ControlButtons />
      </Group>

      {orphanedSubjects.length > 0 && (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={16} />}
          data-testid="orphaned-subjects-warning"
        >
          <Text size="sm">
            Found {orphanedSubjects.length} orphaned lock file entr{orphanedSubjects.length === 1 ? "y" : "ies"} with no matching rawdata subject:{" "}
            <Text span ff="monospace" size="sm">
              {orphanedSubjects.slice(0, 5).join(", ")}
              {orphanedSubjects.length > 5 ? ` (+${orphanedSubjects.length - 5} more)` : ""}
            </Text>
          </Text>
        </Alert>
      )}

      {showConfig && (
        <>
          <SubjectSelection />
          <PipelineConfig />
          <PreflightCheck />
        </>
      )}

      {isRunning && <ExecutionDashboard />}

      {(processingPhase === "completed" || processingPhase === "failed" || processingPhase === "cancelled") && (
        <>
          <ExecutionDashboard />
          <ResultsSummary />
        </>
      )}
    </Stack>
  );
}
