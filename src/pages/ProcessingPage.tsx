import { Stack } from "@mantine/core";
import { IconBrain } from "@tabler/icons-react";
import { useState } from "react";
import HeaderCard from "../components/common/HeaderCard";

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
      <HeaderCard
        icon={IconBrain}
        title="Processing"
        subtitle="Execute the processing pipeline and monitor execution progress."
        color="teal"
        dataTestId="processing-header"
        rightSection={<ControlButtons startDisabled={startDisabled} />}
      />

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
