import { useState } from "react";
import { Group, Stack, Text } from "@mantine/core";

import ControlButtons from "../components/processing/ControlButtons";
import ExecutionDashboard from "../components/processing/ExecutionDashboard";
import PipelineConfig from "../components/processing/PipelineConfig";
import PopulationSection from "../components/processing/PopulationSection";
import ProcessingStatusAlert, {
  type PreflightResult,
} from "../components/processing/ProcessingStatusAlert";
import SubjectSelection from "../components/processing/SubjectSelection";
import { useProcessingSync } from "../hooks/useProcessingSync";
import { useProcessingStore } from "../stores/processingStore";

export default function ProcessingPage() {
  useProcessingSync();

  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const isRunning = processingPhase === "running" || processingPhase === "preparing";
  const showConfig =
    processingPhase === "idle" ||
    processingPhase === "completed" ||
    processingPhase === "failed" ||
    processingPhase === "cancelled";

  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const startDisabled = preflightResult?.ready !== true;

  return (
    <Stack gap="md" data-testid="processing-page">
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">
          Processing
        </Text>
        <ControlButtons startDisabled={startDisabled} />
      </Group>

      {showConfig && (
        <>
          <ProcessingStatusAlert onResult={setPreflightResult} />
          <SubjectSelection />
          <PipelineConfig />
          <PopulationSection />
        </>
      )}

      {isRunning && <ExecutionDashboard />}
    </Stack>
  );
}
