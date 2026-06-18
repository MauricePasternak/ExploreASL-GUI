import { useMemo, useState } from "react";
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

import type {
  SubjectInfo,
  SubjectModuleStatus,
} from "../../schemas/processingSchemas";
import type { ProcessingPhase } from "../../schemas/processingSchemas";
import { PROCESSING_MODULES } from "../../schemas/processingSchemas";
import { useProcessingStore } from "../../stores/processingStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModuleName = (typeof PROCESSING_MODULES)[number];

interface StepStatus {
  name: string;
  status: "pending" | "running" | "complete";
}

// ---------------------------------------------------------------------------
// Step icon
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: StepStatus["status"] }) {
  switch (status) {
    case "complete":
      return <IconCheck size={14} color="var(--mantine-color-teal-6)" data-testid="step-complete" />;
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
    (locked || status === "incomplete") &&
    processingPhase !== "failed" &&
    processingPhase !== "cancelled";

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
    (locked || status === "incomplete") &&
    processingPhase !== "failed" &&
    processingPhase !== "cancelled";

  return (
    <Group
      justify="space-between"
      align="center"
      pl={40}
      pr="md"
      py={4}
      data-testid="run-sub-row"
    >
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getStepsForSubject(
  subjectSession: string,
  module: ModuleName,
  statuses: SubjectModuleStatus[],
  run?: string,
): StepStatus[] {
  const entry = statuses.find(
    (s) =>
      s.subjectSession === subjectSession &&
      s.module === module &&
      (run === undefined || s.run === run),
  );
  if (!entry) return [];
  const steps: StepStatus[] = entry.completedSteps.map((name) => ({
    name,
    status: "complete" as const,
  }));
  if (entry.locked && entry.status !== "complete") {
    steps.push({ name: "Processing...", status: "running" });
  }
  return steps;
}

function getStatusForSubject(
  subjectSession: string,
  module: ModuleName,
  statuses: SubjectModuleStatus[],
  run?: string,
): SubjectModuleStatus | undefined {
  return statuses.find(
    (s) =>
      s.subjectSession === subjectSession &&
      s.module === module &&
      (run === undefined || s.run === run),
  );
}

export function getRunsForSubjectInfo(
  subject: SubjectInfo,
  statuses: SubjectModuleStatus[],
): string[] {
  const fromSubject = subject.aslRuns ?? [];
  const fromLock = statuses
    .filter((s) => s.subjectSession === subject.subjectSession && s.module === "asl" && s.run !== undefined)
    .map((s) => s.run!);
  const union = Array.from(new Set([...fromSubject, ...fromLock]));
  if (union.length === 0) {
    return ["1"];
  }
  return union.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function getSubjectOverallStatus(
  subjectSession: string,
  module: ModuleName,
  statuses: SubjectModuleStatus[],
): {
  status: SubjectModuleStatus["status"];
  locked: boolean;
  completedRunsCount: number;
} {
  const subjectStatuses = statuses.filter(
    (s) => s.subjectSession === subjectSession && s.module === module,
  );

  if (subjectStatuses.length === 0) {
    return { status: "pending", locked: false, completedRunsCount: 0 };
  }

  const locked = subjectStatuses.some((s) => s.locked);
  const completedRunsCount = subjectStatuses.filter((s) => s.status === "complete").length;

  let status: SubjectModuleStatus["status"] = "pending";
  if (subjectStatuses.every((s) => s.status === "complete")) {
    status = "complete";
  } else if (subjectStatuses.some((s) => s.status === "complete" || s.status === "incomplete")) {
    status = "incomplete";
  }

  return { status, locked, completedRunsCount };
}

export function calcModuleProgress(
  subjects: SubjectInfo[],
  module: ModuleName,
  statuses: SubjectModuleStatus[],
): { complete: number; total: number } {
  const eligible = subjects.filter((s) => {
    if (module === "structural") return s.hasStructural;
    if (module === "asl") return s.hasASL;
    return true;
  });

  const complete = eligible.filter((s) => {
    const { status } = getSubjectOverallStatus(s.subjectSession, module, statuses);
    return status === "complete";
  }).length;

  return { complete, total: eligible.length };
}

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
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>

      <Accordion
        multiple
        defaultValue={enabledModules}
        variant="separated"
      >
        {enabledModules.map((module) => (
          <Accordion.Item key={module} value={module}>
            <Accordion.Control>
              <ModuleHeader
                module={module}
                subjects={selectedSubjects}
                statuses={subjectStatuses}
              />
            </Accordion.Control>
            <Accordion.Panel>
              {module === "population" ? (
                <PopulationSection
                  statuses={subjectStatuses}
                  processingPhase={processingPhase}
                />
              ) : (
                <SubjectModuleSection
                  module={module}
                  subjects={selectedSubjects}
                  statuses={subjectStatuses}
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

function ModuleHeader({
  module,
  subjects,
  statuses,
}: {
  module: ModuleName;
  subjects: SubjectInfo[];
  statuses: SubjectModuleStatus[];
}) {
  const { complete, total } = calcModuleProgress(subjects, module, statuses);
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
}

// ---------------------------------------------------------------------------
// Structural / ASL section
// ---------------------------------------------------------------------------

function SubjectModuleSection({
  module,
  subjects,
  statuses,
  processingPhase,
}: {
  module: "structural" | "asl";
  subjects: SubjectInfo[];
  statuses: SubjectModuleStatus[];
  processingPhase: ProcessingPhase;
}) {
  const eligible = useMemo(
    () =>
      subjects.filter((s) =>
        module === "structural" ? s.hasStructural : s.hasASL,
      ),
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
        const runs = module === "asl" ? getRunsForSubjectInfo(subject, statuses) : [];
        const hasMultipleRuns = module === "asl" && runs.length > 1;

        const {
          status: overallStatus,
          locked: overallLocked,
          completedRunsCount,
        } = getSubjectOverallStatus(subject.subjectSession, module, statuses);

        const singleRun = module === "asl" && runs.length === 1 ? runs[0] : undefined;
        const steps = getStepsForSubject(
          subject.subjectSession,
          module,
          statuses,
          singleRun,
        );

        const isExpanded = !!expandedSubjects[subject.subjectSession];

        return (
          <div key={subject.subjectSession}>
            <SubjectRow
              subjectSession={subject.subjectSession}
              steps={hasMultipleRuns ? [] : steps}
              status={overallStatus}
              locked={overallLocked}
              processingPhase={processingPhase}
              run={hasMultipleRuns ? undefined : singleRun}
              runsCount={hasMultipleRuns ? runs.length : undefined}
              completedRunsCount={hasMultipleRuns ? completedRunsCount : undefined}
              expanded={hasMultipleRuns ? isExpanded : undefined}
              onToggleExpand={hasMultipleRuns ? () => toggleExpand(subject.subjectSession) : undefined}
            />
            {hasMultipleRuns && (
              <Collapse in={isExpanded}>
                <Stack gap={0} pb="xs">
                  {runs.map((run) => {
                    const runEntry = getStatusForSubject(
                      subject.subjectSession,
                      "asl",
                      statuses,
                      run,
                    );
                    const runSteps = getStepsForSubject(
                      subject.subjectSession,
                      "asl",
                      statuses,
                      run,
                    );
                    return (
                      <RunSubRow
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

function PopulationSection({
  statuses,
  processingPhase,
}: {
  statuses: SubjectModuleStatus[];
  processingPhase: ProcessingPhase;
}) {
  const entry = statuses.find((s) => s.module === "population");
  const steps: StepStatus[] = (entry?.completedSteps.map((name) => ({
    name,
    status: "complete" as const,
  })) ?? []);
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
}
