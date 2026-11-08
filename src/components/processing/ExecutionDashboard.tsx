import {
  Accordion,
  ActionIcon,
  Badge,
  Box,
  Collapse,
  Group,
  Loader,
  Progress,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconChevronDown, IconChevronRight, IconPointFilled } from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";

import { aslRunsEqual } from "../../lib/aslRun";
import type {
  ProcessingPhase,
  SubjectInfo,
  SubjectModuleStatus,
} from "../../schemas/processingSchemas";
import { useProcessingStore } from "../../stores/processingStore";
import type { ModuleName, StepStatus } from "./ExecutionDashboard.helpers";
import {
  calcModuleProgress,
  getRunsForSubjectInfo,
  getStatusForSubject,
  getStepsForSubject,
  getSubjectOverallStatus,
  processingStepLabel,
  remainingStepNames,
} from "./ExecutionDashboard.helpers";
import { getEntriesFor, indexSubjectStatuses } from "./subjectStatusIndex";

// ---------------------------------------------------------------------------
// Step icon
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: StepStatus["status"] }) {
  switch (status) {
    case "complete":
      return (
        <IconCheck size={14} color="var(--mantine-color-blue-6)" data-testid="step-complete" />
      );
    case "running":
      return <Loader size={14} color="pink" data-testid="step-running" />;
    case "pending":
    default:
      return (
        <IconPointFilled size={4} color="var(--mantine-color-gray-5)" data-testid="step-pending" />
      );
  }
}

// ---------------------------------------------------------------------------
// Step timeline
// ---------------------------------------------------------------------------

function StepTimeline({
  steps,
  status,
  module,
}: {
  steps: StepStatus[];
  status: SubjectModuleStatus["status"];
  module: ModuleName;
}) {
  const remaining = remainingStepNames(
    module,
    steps.filter((step) => step.status === "complete").map((step) => step.name),
  );
  const running = steps.some((step) => step.status === "running");
  const timeline: StepStatus[] =
    status === "complete"
      ? steps.length
        ? steps
        : [{ name: "Completed", status: "complete" }]
      : [
          ...steps.map((step) =>
            step.status === "running" && remaining.length ? { ...step, name: remaining[0] } : step,
          ),
          ...remaining.slice(running && remaining.length ? 1 : 0).map((name): StepStatus => ({
            name,
            status: "pending",
          })),
        ];
  return (
    <div className="processing-timeline" data-testid="step-timeline">
      {timeline.map((step, i) => (
        <Tooltip
          key={`${step.name}-${i}`}
          label={
            step.status === "running" && step.name !== "Processing..." ? (
              <span data-testid="step-running-description">
                {processingStepLabel(step.name)}
                <br />
                Processing this module
              </span>
            ) : (
              processingStepLabel(step.name)
            )
          }
          events={{ hover: true, focus: true, touch: true }}
        >
          <span
            className="processing-step"
            tabIndex={0}
            role="img"
            aria-label={`${processingStepLabel(step.name)}: ${step.status}`}
            data-testid="timeline-step"
          >
            <StepIcon status={step.status} />
            {i < timeline.length - 1 && (
              <span aria-hidden="true" data-testid="timeline-step-connector" />
            )}
          </span>
        </Tooltip>
      ))}
    </div>
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
  module: ModuleName;
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
  module,
  runsCount,
  completedRunsCount,
  expanded,
  onToggleExpand,
}: SubjectRowProps) {
  const isRunning =
    status !== "complete" &&
    locked &&
    ["preparing", "running", "finalizing", "cancelling"].includes(processingPhase);

  const isCollapsible = runsCount !== undefined && runsCount > 1;

  return (
    <Box className="processing-progress-row" px="md" py="xs" data-testid="subject-row">
      <Group gap="xs" align="center" wrap="nowrap" data-testid="progress-subject-label">
        {isCollapsible && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={`${expanded ? "Collapse" : "Expand"} ASL runs for ${subjectSession}`}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand?.();
            }}
            data-testid="expand-toggle"
          >
            {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </ActionIcon>
        )}
        <Group gap="xs" data-testid="progress-subject-identity">
          <Text size="sm" ff="monospace" data-testid="progress-subject-name">
            {subjectSession}
          </Text>
        </Group>
      </Group>
      {isCollapsible ? (
        <Text
          component="button"
          type="button"
          size="xs"
          c="pink"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          data-testid="runs-summary-text"
        >
          {completedRunsCount} of {runsCount} runs complete · {expanded ? "hide" : "show"} run lanes
        </Text>
      ) : (
        <StepTimeline steps={steps} status={status} module={module} />
      )}

      <Group gap="xs" align="center" style={{ flexShrink: 0 }}>
        {isRunning && (
          <Badge size="xs" color="pink" variant="light">
            Running
          </Badge>
        )}
        {status === "complete" && (
          <Badge size="xs" color="blue" variant="light">
            Done
          </Badge>
        )}
        {!isRunning && status !== "complete" && (
          <Badge size="xs" color="gray" variant="light">
            Pending
          </Badge>
        )}
      </Group>
    </Box>
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
    ["preparing", "running", "finalizing", "cancelling"].includes(processingPhase);

  return (
    <Box className="processing-progress-row" pl={40} pr="md" py="xs" data-testid="run-sub-row">
      <Text size="xs" fw={600} data-testid="progress-run-label">
        Run {run.padStart(2, "0")}
      </Text>
      <StepTimeline steps={steps} status={status} module="asl" />

      <Group gap="xs" align="center" style={{ flexShrink: 0 }}>
        {isRunning && (
          <Badge size="xs" color="pink" variant="light">
            Running
          </Badge>
        )}
        {status === "complete" && (
          <Badge size="xs" color="blue" variant="light">
            Done
          </Badge>
        )}
        {!isRunning && status !== "complete" && (
          <Badge size="xs" color="gray" variant="light">
            Pending
          </Badge>
        )}
      </Group>
    </Box>
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
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const snapshot = useProcessingStore((s) => s.snapshot);
  const activeRunId = useProcessingStore((s) => s.activeRunId);
  const attached = snapshot?.runId === activeRunId ? snapshot : null;

  const statusIndex = useMemo(
    () =>
      indexSubjectStatuses(
        subjectStatuses.filter((status) =>
          attached?.expectedTargets.some(
            (target) =>
              target.module === status.module &&
              (target.subjectSession ?? "") === status.subjectSession &&
              aslRunsEqual(target.run ?? undefined, status.run),
          ),
        ),
      ),
    [attached, subjectStatuses],
  );

  const selectedSubjects = useMemo(() => {
    if (!attached) return [];
    return attached.selectedSubjectSessions
      .map((id) => {
        const discovered = availableSubjects.find((s) => s.subjectSession === id);
        const expected = attached.expectedTargets.filter((t) => t.subjectSession === id);
        return {
          subjectSession: id,
          subject: discovered?.subject ?? id.slice(4, id.lastIndexOf("_")),
          session: discovered?.session ?? id.slice(id.lastIndexOf("_") + 1),
          hasStructural: expected.length
            ? expected.some((t) => t.module === "structural")
            : (discovered?.hasStructural ?? attached.selectedModules.includes("structural")),
          hasASL: expected.length
            ? expected.some((t) => t.module === "asl")
            : (discovered?.hasASL ?? attached.selectedModules.includes("asl")),
          aslRuns: expected.length
            ? expected.filter((t) => t.module === "asl" && t.run).map((t) => t.run!)
            : (discovered?.aslRuns ?? []),
        };
      })
      .sort((a, b) =>
        a.subjectSession.localeCompare(b.subjectSession, undefined, { numeric: true }),
      );
  }, [attached, availableSubjects]);

  const enabledModules = attached?.selectedModules ?? [];

  if (!attached || enabledModules.length === 0) {
    return (
      <Text size="sm" c="dimmed" data-testid="execution-dashboard-empty">
        Loading run details...
      </Text>
    );
  }

  return (
    <Stack gap="sm" data-testid="execution-dashboard">
      <Accordion
        key={attached.runId}
        multiple
        defaultValue={enabledModules}
        variant="separated"
        className="processing-module-grid"
        data-testid="execution-modules"
      >
        {enabledModules.map((module) => (
          <Accordion.Item key={module} value={module} data-testid={`execution-module-${module}`}>
            <Accordion.Control data-testid={`execution-module-${module}-toggle`}>
              <ModuleHeader module={module} subjects={selectedSubjects} statusIndex={statusIndex} />
            </Accordion.Control>
            <Accordion.Panel data-testid={`execution-module-${module}-panel`}>
              {module === "population" ? (
                <PopulationSection
                  statuses={getEntriesFor(statusIndex, "", "population")}
                  processingPhase={processingPhase}
                />
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
    () => calcModuleProgress(subjects, module, statusIndex),
    [subjects, module, statusIndex],
  );
  const pct = total === 0 ? 0 : Math.round((complete / total) * 100);

  return (
    <Group justify="space-between" align="center" pr="md" data-testid="module-header">
      <Group gap="sm">
        <Text fw={600} size="sm">
          {MODULE_LABELS[module]}
        </Text>
        <Badge size="sm" variant="light" color={module === "asl" ? "pink" : "blue"}>
          {complete} / {total} complete
        </Badge>
      </Group>
      <Progress
        value={pct}
        size="sm"
        w={150}
        color={module === "asl" ? "pink" : "blue"}
        aria-label={`${MODULE_LABELS[module]} module progress`}
        data-testid={`${module}-module-progress`}
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
      [subjSession]: !(prev[subjSession] ?? true),
    }));
  };

  if (eligible.length === 0) {
    return (
      <Text size="xs" c="dimmed" data-testid="no-subjects-msg">
        No selected sessions have {MODULE_LABELS[module]} data.
      </Text>
    );
  }

  return (
    <Stack gap={0} data-testid={`${module}-section`}>
      {eligible.map((subject) => {
        const runs = module === "asl" ? getRunsForSubjectInfo(subject, statusIndex) : [];
        const hasMultipleRuns = module === "asl" && runs.length > 1;

        const {
          status: overallStatus,
          locked: overallLocked,
          completedRunsCount,
        } = getSubjectOverallStatus(statusIndex, subject.subjectSession, module);

        const singleRun = module === "asl" && runs.length === 1 ? runs[0] : undefined;
        const steps = getStepsForSubject(statusIndex, subject.subjectSession, module, singleRun);

        const isExpanded = expandedSubjects[subject.subjectSession] ?? true;

        return (
          <div key={subject.subjectSession}>
            <MemoizedSubjectRow
              subjectSession={subject.subjectSession}
              steps={hasMultipleRuns ? [] : steps}
              status={overallStatus}
              locked={overallLocked}
              processingPhase={processingPhase}
              module={module}
              runsCount={hasMultipleRuns ? runs.length : undefined}
              completedRunsCount={hasMultipleRuns ? completedRunsCount : undefined}
              expanded={hasMultipleRuns ? isExpanded : undefined}
              onToggleExpand={
                hasMultipleRuns ? () => toggleExpand(subject.subjectSession) : undefined
              }
            />
            {hasMultipleRuns && (
              <Collapse expanded={isExpanded}>
                <Stack gap={0} className="processing-run-lanes" data-testid="run-lanes">
                  {runs.map((run) => {
                    const runEntry = getStatusForSubject(
                      statusIndex,
                      subject.subjectSession,
                      "asl",
                      run,
                    );
                    const runSteps = getStepsForSubject(
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
        module="population"
      />
    </Stack>
  );
});
