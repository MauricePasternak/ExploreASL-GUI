import { Alert, Badge, Divider, Paper, Stack, Text, Title } from "@mantine/core";
import { IconBrain, IconInfoCircle } from "@tabler/icons-react";
import { useState } from "react";
import HeaderCard from "../components/common/HeaderCard";

import ControlButtons from "../components/processing/ControlButtons";
import ExecutionDashboard from "../components/processing/ExecutionDashboard";
import PipelineConfig from "../components/processing/PipelineConfig";
import PopulationSection from "../components/processing/PopulationSection";
import PreparingTransition from "../components/processing/PreparingTransition";
import ProcessingStatusAlert, {
  type PreflightResult,
} from "../components/processing/ProcessingStatusAlert";
import SubjectSelection from "../components/processing/SubjectSelection";
import "../components/processing/Processing.css";
import { useProcessingSync } from "../hooks/useProcessingSync";
import { useProcessingStore } from "../stores/processingStore";

export default function ProcessingPage() {
  useProcessingSync();

  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const snapshot = useProcessingStore((s) => s.snapshot);
  const activeRunId = useProcessingStore((s) => s.activeRunId);
  const reservedRun = snapshot?.runId === activeRunId ? snapshot : null;
  const isPreparing = processingPhase === "preparing";
  const hasActiveRun = ["preparing", "running", "finalizing", "cancelling"].includes(
    processingPhase,
  );
  const showConfig =
    processingPhase === "idle" ||
    processingPhase === "completed" ||
    processingPhase === "failed" ||
    processingPhase === "cancelled" ||
    processingPhase === "interrupted";

  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const startDisabled = preflightResult?.ready !== true;
  const activeMessage =
    processingPhase === "running"
      ? ["Processing is running"]
      : processingPhase === "finalizing"
        ? ["Finalizing processing", "Workers have stopped. Waiting for the final status."]
        : processingPhase === "cancelling"
          ? ["Stopping processing"]
          : null;

  return (
    <Stack
      gap="md"
      className={`processing-page${hasActiveRun ? " processing-page--active" : ""}`}
      data-testid="processing-page"
    >
      <HeaderCard
        icon={IconBrain}
        title="Processing"
        subtitle={
          showConfig
            ? "Choose subjects and settings for the next run."
            : "This run uses the settings chosen when it started."
        }
        color="teal"
        dataTestId="processing-header"
        rightSection={
          <Badge
            variant="light"
            color={showConfig ? "gray" : "teal"}
            data-testid="processing-phase-badge"
          >
            {showConfig ? "Configure next run" : processingPhase}
          </Badge>
        }
      />

      <div className="processing-workspace" data-testid="processing-workspace">
        <Paper
          withBorder
          p="md"
          radius="md"
          className="processing-settings"
          data-testid="processing-settings"
        >
          <Stack
            gap="md"
            className={showConfig ? "processing-settings-content--config" : undefined}
            data-testid="processing-settings-content"
          >
            <div data-testid="processing-settings-heading">
              <Text size="xs" c="dimmed" fw={600} data-testid="processing-settings-context">
                {showConfig ? "NEXT RUN" : "CURRENT RUN"}
              </Text>
              <Title order={4} data-testid="processing-settings-title">
                {showConfig ? "Execution settings" : "Run settings"}
              </Title>
            </div>
            {showConfig && <PipelineConfig />}
            {hasActiveRun && reservedRun && (
              <Stack gap="xs" data-testid="processing-reserved-request">
                <Text size="sm" data-testid="processing-reserved-modules">
                  {reservedRun.selectedModules
                    .map((module) =>
                      module === "asl"
                        ? "ASL"
                        : module === "structural"
                          ? "Structural"
                          : "Population",
                    )
                    .join(" + ")}
                  {" · "}
                  {reservedRun.selectedModules.includes("population")
                    ? "Study-level"
                    : reservedRun.selectedSubjectSessions.length > 0
                      ? `${reservedRun.selectedSubjectSessions.length} ${reservedRun.selectedSubjectSessions.length === 1 ? "session" : "sessions"}`
                      : "All eligible sessions"}
                </Text>
                <Text size="sm" data-testid="processing-reserved-workers">
                  {reservedRun.workerCount} worker{reservedRun.workerCount === 1 ? "" : "s"}
                </Text>
                <Divider />
                <Text size="xs" c="dimmed" data-testid="processing-reserved-note">
                  Changes in Parameters take effect on your next run.
                </Text>
              </Stack>
            )}
            {showConfig && <ProcessingStatusAlert onResult={setPreflightResult} />}
            <div className="processing-run-controls" data-testid="processing-run-controls">
              <ControlButtons startDisabled={startDisabled} />
            </div>
          </Stack>
        </Paper>

        <Stack gap="md" className="processing-main" data-testid="processing-main">
          {showConfig && <SubjectSelection />}
          {isPreparing && <PreparingTransition />}
          {activeMessage && (
            <Alert
              color="blue"
              icon={<IconInfoCircle size={18} />}
              title={activeMessage[0]}
              data-testid="processing-live-status"
            >
              {activeMessage[1] ?? null}
            </Alert>
          )}
          {hasActiveRun && <ExecutionDashboard />}
        </Stack>
      </div>

      {showConfig && <PopulationSection />}
    </Stack>
  );
}
