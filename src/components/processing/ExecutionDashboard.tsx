import {
  Accordion,
  Badge,
  Collapse,
  Divider,
  Group,
  Progress,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLoader,
  IconMinus,
} from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";

import type {
  ProcessingPhase,
  SubjectInfo,
  SubjectModuleStatus,
} from "../../schemas/processingSchemas";
import { useProcessingStore } from "../../stores/processingStore";
import type { ModuleName, StepStatus } from "./ExecutionDashboard.helpers";
import {
  calcModuleProgressFromIndex,
  getRunsForSubjectInfoFromIndex,
  getStatusForSubjectFromIndex,
  getStepsForSubjectFromIndex,
  getSubjectOverallStatusFromIndex,
} from "./ExecutionDashboard.helpers";
import { indexSubjectStatuses } from "./subjectStatusIndex";

// ---------------------------------------------------------------------------
// Step icon
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: StepStatus["status"] }) {
  switch (status) {
    case "complete":
      return (
        <IconCheck size={14} color="var(--mantine-color-teal-6)" data-testid="step-complete" />
      );
    case "running":
      return (
        <IconLoader
          size={14}
          color="var(--mantine-color-orange-6)"
          className="spin"
          data-testid="step-running"
        />
      );
    case "pending":
    default:
      return <IconMinus size={14} color="var(--mantine-color-gray-5)" data-testid="step-pending" />;
  }
}

// ---------------------------------------------------------------------------
// Step timeline
// ---------------------------------------------------------------------------

function StepTimeline({ steps }: { steps: StepStatus[] }) {
  if (steps.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No steps recorded
      </Text>
    );
  }

  return (
    <Group gap="xs" wrap="wrap" data-testid="step-timeline">
      {steps.map((step, i) => (
        <Tooltip key={`${step.name}-${i}`} label={step.name}>
          <Group gap={4}>
            <StepIcon status={step.status} />
            {i < steps.length - 1 && (
              <div
                style={{
                  width: 16,
                  height: 1,
                  background:
                    step.status === "complete"
                      ? "var(--mantine-color-teal-4)"
                      : "var(--mantine-color-gray-3)",
                }}
              />
            )}
          </Group>
        </Tooltip>
      ))}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Subject row
// ---------------------------------------------------------------------------

interface SubjectRowProps {
  subjectSession: string;
  steps: StepStatus[];
  status: SubjectModuleStatus["status"];
  locked: boolean;
  processingPhase: ProcessingPhase;
  run?: string;
  runsCount?: number;
  completedRunsCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

function SubjectRow({
  subjectSession,
  steps,
  status,
  locked,
  processingPhase,
  run,
  runsCount,
  completedRunsCount,
  expanded,
  onToggleExpand,
}: SubjectRowProps) {
  const isRunning =
    status !== "complete" &&
    locked &&
    (processingPhase === "running" || processingPhase === "preparing");

  const isCollapsible = runsCount !== undefined && runsCount > 1;

  return (
    <Group
      justify="space-between"
      align="center"
      px="md"
      py={6}
      data-testid="subject-row"
      onClick={isCollapsible ? onToggleExpand : undefined}
      style={{ cursor: isCollapsible ? "pointer" : "default" }}
    >
      <Group gap="md" align="center" style={{ flex: 1, minWidth: 0 }}>
        {isCollapsible && (
          <div style={{ display: "flex", alignItems: "center" }} data-testid="expand-toggle">
            {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </div>
        )}
        <Group gap="xs" style={{ flexShrink: 0 }} w={240}>
          <Text size="sm" ff="monospace" truncate style={{ flex: 1 }}>
            {subjectSession}
          </Text>
          {run && (
            <Badge size="xs" variant="outline" color="gray" data-testid="run-badge">
              Run {run}
            </Badge>
          )}
          {isCollapsible && (
            <Badge size="xs" variant="outline" color="blue" data-testid="runs-count-badge">
              {runsCount} runs
            </Badge>
          )}
        </Group>
        {isCollapsible ? (
          <Text size="xs" c="dimmed" data-testid="runs-summary-text">
            {completedRunsCount} of {runsCount} runs complete
          </Text>
        ) : (
          <StepTimeline steps={steps} />
        )}
      </Group>

      <Group gap="xs" align="center" style={{ flexShrink: 0 }}>
        {isRunning && (
          <Badge size="xs" color="orange" variant="light">
            Running
          </Badge>
        )}
        {status === "complete" && (
          <Badge size="xs" color="teal" variant="light">
            Done
          </Badge>
        )}
      </Group>
    </Group>
  );
}

const MemoizedSubjectRow = memo(SubjectRow);

// ---------------------------------------------------------------------------
// Run sub-row (for ASL with multiple runs)
// ---------------------------------------------------------------------------

function RunSubRow({
  run,
  steps,
  locked,
  status,
  processingPhase,
}: {
  run: string;
  steps: StepStatus[];
  locked: boolean;
  status: SubjectModuleStatus["status"];
  processingPhase: ProcessingPhase;
}) {
  const isRunning =
    status !== "complete" &&
    locked &&
    (processingPhase === "running" || processingPhase === "preparing");

  return (
    <Group justify="space-between" align="center" pl={40} pr="md" py={4} data-testid="run-sub-row">
      <Group gap="md" align="center" style={{ flex: 1, minWidth: 0 }}>
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }} w={240}>
          Run {run}
        </Text>
        <StepTimeline steps={steps} />
      </Group>

      <Group gap="xs" align="center" style={{ flexShrink: 0 }}>
        {isRunning && (
          <Badge size="xs" color="orange" variant="light">
            Running
          </Badge>
        )}
        {status === "complete" && (
          <Badge size="xs" color="teal" variant="light">
            Done
          </Badge>
        )}
      </Group>
    </Group>
  );
}

const MemoizedRunSubRow = memo(RunSubRow);

// ---------------------------------------------------------------------------
// Module section labels
// ---------------------------------------------------------------------------

const MODULE_LABELS: Record<ModuleName, string> = {
  structural: "Structural",
  asl: "ASL",
  population: "Population",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExecutionDashboard() {
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);
  const config = useProcessingStore((s) => s.config);
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const processingPhase = useProcessingStore((s) => s.processingPhase);

  const statusIndex = useMemo(() => indexSubjectStatuses(subjectStatuses), [subjectStatuses]);

  const selectedSubjects = useMemo(() => {
    if (!config) return [];
    const set = new Set(config.subjects);
    return availableSubjects
      .filter((s) => set.has(s.subjectSession))
      .sort((a, b) =>
        a.subjectSession.localeCompare(b.subjectSession, undefined, { numeric: true }),
      );
  }, [config, availableSubjects]);

  const enabledModules = useMemo(() => {
    return (config?.modules ?? []) as ModuleName[];
  }, [config?.modules]);

  if (!config || enabledModules.length === 0) {
    return (
      <Text size="sm" c="dimmed" data-testid="execution-dashboard-empty">
        Configure pipeline and select subjects to view execution dashboard.
      </Text>
    );
  }

  return (
    <Stack gap="sm" data-testid="execution-dashboard">
      <Accordion multiple defaultValue={enabledModules} variant="separated">
        {enabledModules.map((module) => (
          <Accordion.Item key={module} value={module}>
            <Accordion.Control>
              <ModuleHeader module={module} subjects={selectedSubjects} statusIndex={statusIndex} />
            </Accordion.Control>
            <Accordion.Panel>
              {module === "population" ? (
                <PopulationSection statuses={subjectStatuses} processingPhase={processingPhase} />
              ) : (
                <SubjectModuleSection
                  module={module}
                  subjects={selectedSubjects}
                  statusIndex={statusIndex}
                  processingPhase={processingPhase}
                />
              )}
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Module header (in accordion control)
// ---------------------------------------------------------------------------

const ModuleHeader = memo(function ModuleHeader({
  module,
  subjects,
  statusIndex,
}: {
  module: ModuleName;
  subjects: SubjectInfo[];
  statusIndex: ReturnType<typeof indexSubjectStatuses>;
}) {
  const { complete, total } = useMemo(
    () => calcModuleProgressFromIndex(subjects, module, statusIndex),
    [subjects, module, statusIndex],
  );
  const pct = total === 0 ? 0 : Math.round((complete / total) * 100);

  return (
    <Group justify="space-between" align="center" pr="md" data-testid="module-header">
      <Group gap="sm">
        <Text fw={600} size="sm">
          {MODULE_LABELS[module]}
        </Text>
        <Badge size="xs" variant="light" color={complete === total && total > 0 ? "teal" : "blue"}>
          {complete}/{total}
        </Badge>
      </Group>
      <Progress
        value={pct}
        size="xs"
        w={100}
        color={complete === total && total > 0 ? "teal" : "blue"}
      />
    </Group>
  );
});

// ---------------------------------------------------------------------------
// Structural / ASL section
// ---------------------------------------------------------------------------

function SubjectModuleSection({
  module,
  subjects,
  statusIndex,
  processingPhase,
}: {
  module: "structural" | "asl";
  subjects: SubjectInfo[];
  statusIndex: ReturnType<typeof indexSubjectStatuses>;
  processingPhase: ProcessingPhase;
}) {
  const eligible = useMemo(
    () => subjects.filter((s) => (module === "structural" ? s.hasStructural : s.hasASL)),
    [subjects, module],
  );

  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});

  const toggleExpand = (subjSession: string) => {
    setExpandedSubjects((prev) => ({
      ...prev,
      [subjSession]: !prev[subjSession],
    }));
  };

  if (eligible.length === 0) {
    return (
      <Text size="xs" c="dimmed" data-testid="no-subjects-msg">
        No eligible subjects for {MODULE_LABELS[module]}.
      </Text>
    );
  }

  return (
    <Stack gap={0} data-testid={`${module}-section`}>
      {eligible.map((subject) => {
        const runs = module === "asl" ? getRunsForSubjectInfoFromIndex(subject, statusIndex) : [];
        const hasMultipleRuns = module === "asl" && runs.length > 1;

        const {
          status: overallStatus,
          locked: overallLocked,
          completedRunsCount,
        } = getSubjectOverallStatusFromIndex(statusIndex, subject.subjectSession, module);

        const singleRun = module === "asl" && runs.length === 1 ? runs[0] : undefined;
        const steps = getStepsForSubjectFromIndex(
          statusIndex,
          subject.subjectSession,
          module,
          singleRun,
        );

        const isExpanded = !!expandedSubjects[subject.subjectSession];

        return (
          <div key={subject.subjectSession}>
            <MemoizedSubjectRow
              subjectSession={subject.subjectSession}
              steps={hasMultipleRuns ? [] : steps}
              status={overallStatus}
              locked={overallLocked}
              processingPhase={processingPhase}
              run={hasMultipleRuns ? undefined : singleRun}
              runsCount={hasMultipleRuns ? runs.length : undefined}
              completedRunsCount={hasMultipleRuns ? completedRunsCount : undefined}
              expanded={hasMultipleRuns ? isExpanded : undefined}
              onToggleExpand={
                hasMultipleRuns ? () => toggleExpand(subject.subjectSession) : undefined
              }
            />
            {hasMultipleRuns && (
              <Collapse expanded={isExpanded}>
                <Stack gap={0} pb="xs">
                  {runs.map((run) => {
                    const runEntry = getStatusForSubjectFromIndex(
                      statusIndex,
                      subject.subjectSession,
                      "asl",
                      run,
                    );
                    const runSteps = getStepsForSubjectFromIndex(
                      statusIndex,
                      subject.subjectSession,
                      "asl",
                      run,
                    );
                    return (
                      <MemoizedRunSubRow
                        key={`${subject.subjectSession}-${run}`}
                        run={run}
                        steps={runSteps}
                        locked={runEntry?.locked ?? false}
                        status={runEntry?.status ?? "pending"}
                        processingPhase={processingPhase}
                      />
                    );
                  })}
                </Stack>
              </Collapse>
            )}
            <Divider />
          </div>
        );
      })}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Population section (single row)
// ---------------------------------------------------------------------------

const PopulationSection = memo(function PopulationSection({
  statuses,
  processingPhase,
}: {
  statuses: SubjectModuleStatus[];
  processingPhase: ProcessingPhase;
}) {
  const entry = statuses.find((s) => s.module === "population");
  const steps: StepStatus[] =
    entry?.completedSteps.map((name) => ({
      name,
      status: "complete" as const,
    })) ?? [];
  if (entry?.locked && entry?.status !== "complete") {
    steps.push({ name: "Processing...", status: "running" });
  }

  return (
    <Stack gap={0} data-testid="population-status-section">
      <SubjectRow
        subjectSession="Population (group)"
        steps={steps}
        status={entry?.status ?? "pending"}
        locked={entry?.locked ?? false}
        processingPhase={processingPhase}
      />
      <Divider />
    </Stack>
  );
});
