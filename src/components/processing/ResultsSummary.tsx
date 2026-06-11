import { useMemo } from "react";
import { Accordion, Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { IconFolderOpen } from "@tabler/icons-react";
import { openPath } from "@tauri-apps/plugin-opener";

import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModuleDetail {
  module: string;
  status: "complete" | "incomplete" | "pending";
  lastStep: string | null;
}

interface SubjectResult {
  subjectSession: string;
  status: "complete" | "incomplete" | "pending";
  moduleDetails: ModuleDetail[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifySubjects(
  subjectStatuses: Array<{
    subjectSession: string;
    module: string;
    status: string;
    completedSteps: string[];
  }>,
  selectedSubjects: string[],
): SubjectResult[] {
  const bySubject = new Map<string, ModuleDetail[]>();

  for (const s of subjectStatuses) {
    if (!bySubject.has(s.subjectSession)) {
      bySubject.set(s.subjectSession, []);
    }
    const lastStep =
      s.completedSteps.length > 0
        ? s.completedSteps[s.completedSteps.length - 1]
        : null;
    bySubject.get(s.subjectSession)!.push({
      module: s.module,
      status: s.status as ModuleDetail["status"],
      lastStep,
    });
  }

  const results: SubjectResult[] = [];

  for (const sub of selectedSubjects) {
    const modules = bySubject.get(sub);
    if (!modules || modules.length === 0) {
      results.push({ subjectSession: sub, status: "pending", moduleDetails: [] });
      continue;
    }

    const hasIncomplete = modules.some((m) => m.status === "incomplete");
    const allPending = modules.every((m) => m.status === "pending");
    const overallStatus: SubjectResult["status"] = hasIncomplete
      ? "incomplete"
      : allPending
        ? "pending"
        : "complete";

    results.push({ subjectSession: sub, status: overallStatus, moduleDetails: modules });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ResultsSummary() {
  const phase = useProcessingStore((s) => s.processingPhase);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);
  const config = useProcessingStore((s) => s.config);
  const rootPath = useProjectStore((s) => s.project?.projectMeta.rootPath);

  const results = useMemo(
    () => classifySubjects(subjectStatuses, config?.subjects ?? []),
    [subjectStatuses, config?.subjects],
  );

  const succeeded = results.filter((r) => r.status === "complete").length;
  const failed = results.filter((r) => r.status === "incomplete").length;
  const skipped = results.filter((r) => r.status === "pending").length;
  const failedSubjects = results.filter((r) => r.status === "incomplete");

  const isTerminal = phase === "completed" || phase === "failed" || phase === "cancelled";
  if (!isTerminal) return null;

  const outputDir = rootPath ? `${rootPath}/derivatives/ExploreASL` : null;

  const handleOpenOutput = async () => {
    if (!outputDir) return;
    try {
      await openPath(outputDir);
    } catch (err) {
      console.error("Failed to open output directory:", err);
    }
  };

  return (
    <div data-testid="results-summary">
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Text fw={600} size="lg" data-testid="results-phase-label">
            Processing {phase}
          </Text>

          <Group gap="lg">
            <Group gap="xs">
              <Text size="sm" c="dimmed">Succeeded:</Text>
              <span data-testid="results-succeeded">
                <Badge color="teal" variant="light">{succeeded}</Badge>
              </span>
            </Group>
            <Group gap="xs">
              <Text size="sm" c="dimmed">Failed:</Text>
              <span data-testid="results-failed">
                <Badge color="red" variant="light">{failed}</Badge>
              </span>
            </Group>
            <Group gap="xs">
              <Text size="sm" c="dimmed">Skipped:</Text>
              <span data-testid="results-skipped">
                <Badge color="gray" variant="light">{skipped}</Badge>
              </span>
            </Group>
          </Group>

          <span data-testid="open-output-dir-btn">
            <Button
              variant="light"
              leftSection={<IconFolderOpen size={16} />}
              onClick={handleOpenOutput}
              disabled={!outputDir}
            >
              Open Output Directory
            </Button>
          </span>

          {failedSubjects.length > 0 && (
            <span data-testid="failed-details-accordion">
              <Accordion variant="separated">
                <Accordion.Item value="failed">
                  <Accordion.Control>
                    <Group gap="sm">
                      <Text size="sm" fw={500}>Failed Subjects</Text>
                      <Badge color="red" size="xs">{failedSubjects.length}</Badge>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap={4}>
                      {failedSubjects.map((s) => (
                        <div key={s.subjectSession}>
                          <Text size="sm" ff="monospace" data-testid="failed-subject-name">
                            {s.subjectSession}
                          </Text>
                          {s.moduleDetails
                            .filter((m) => m.status === "incomplete")
                            .map((m) => (
                              <Group key={m.module} gap="xs" pl="sm">
                                <Text size="xs" c="dimmed" data-testid="failed-module-name">
                                  {m.module}
                                </Text>
                                {m.lastStep && (
                                  <Text size="xs" c="dimmed" data-testid="failed-last-step">
                                    last: {m.lastStep}
                                  </Text>
                                )}
                              </Group>
                            ))}
                        </div>
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </span>
          )}
        </Stack>
      </Paper>
    </div>
  );
}
