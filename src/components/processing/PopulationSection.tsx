import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Group,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconBook } from "@tabler/icons-react";

import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";
import { useDataParStore } from "../../stores/dataParStore";
import type { SubjectModuleStatus } from "../../schemas/processingSchemas";
import type { LogFileInfo, LogContent } from "../../lib/logViewer";
import { fetchModuleLogs, fetchLogContent } from "../../lib/logViewer";
import LogViewerModal from "./LogViewerModal";

function countEligibleSubjects(
  availableSubjects: { subjectSession: string }[],
  subjectStatuses: SubjectModuleStatus[],
): number {
  const eligible = new Set<string>();
  for (const subj of availableSubjects) {
    const hasStructural = subjectStatuses.some(
      (s) => s.subjectSession === subj.subjectSession && s.module === "structural" && s.status === "complete",
    );
    const hasAsl = subjectStatuses.some(
      (s) => s.subjectSession === subj.subjectSession && s.module === "asl" && s.status === "complete",
    );
    if (hasStructural && hasAsl) {
      eligible.add(subj.subjectSession);
    }
  }
  return eligible.size;
}

export default function PopulationSection() {
  const config = useProcessingStore((s) => s.config);
  const setConfig = useProcessingStore((s) => s.setConfig);
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);
  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const projectRoot = useProjectStore((s) => s.project?.projectMeta.rootPath);
  const atlases = useDataParStore((s) => s.dataPar.Atlases);

  const populationSelected = config?.modules.includes("population") ?? false;
  const structuralSelected = config?.modules.includes("structural") ?? false;
  const aslSelected = config?.modules.includes("asl") ?? false;
  const subjectModuleSelected = structuralSelected || aslSelected;

  const eligibleCount = useMemo(
    () => countEligibleSubjects(availableSubjects, subjectStatuses),
    [availableSubjects, subjectStatuses],
  );

  const totalCount = availableSubjects.length;
  const hasEligible = eligibleCount > 0;

  const checkboxDisabled = subjectModuleSelected || !hasEligible;

  const tooltipLabel = useMemo(() => {
    const parts: string[] = [];
    if (subjectModuleSelected) {
      parts.push("Population must run independently. Deselect Structural and ASL modules to enable.");
    }
    if (!hasEligible) {
      parts.push("At least one subject/session must have both Structural and ASL complete.");
    }
    return parts.join(" ");
  }, [subjectModuleSelected, hasEligible]);

  const handleToggle = useCallback(() => {
    if (!config) return;
    if (populationSelected) {
      setConfig({ ...config, modules: [] });
    } else {
      setConfig({ ...config, modules: ["population"] });
    }
  }, [config, populationSelected, setConfig]);

  // Log viewing logic
  const [logs, setLogs] = useState<LogFileInfo[]>([]);
  const [modalOpened, setModalOpened] = useState(false);
  const [modalContent, setModalContent] = useState<LogContent | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadLogs = useCallback(() => {
    if (!projectRoot) return;
    fetchModuleLogs(projectRoot)
      .then((files) => {
        const popLogs = files.filter((f) => f.module === "population");
        setLogs(popLogs);
      })
      .catch(() => {
        setLogs([]);
      });
  }, [projectRoot]);

  // Load logs on mount, when project root changes, or when phase changes (e.g. processing ends)
  useEffect(() => {
    loadLogs();
  }, [loadLogs, processingPhase]);

  const hasLog = logs.length > 0;
  const hasError = logs.some((l) => l.hasError);

  const handleViewLog = useCallback(async () => {
    if (!projectRoot || !hasLog) return;
    setModalOpened(true);
    setModalLoading(true);
    setModalError(null);
    try {
      const content = await fetchLogContent(projectRoot, "", "population");
      setModalContent(content);
    } catch {
      setModalError("Failed to load population log content");
      setModalContent(null);
    } finally {
      setModalLoading(false);
    }
  }, [projectRoot, hasLog]);

  const handleCloseModal = useCallback(() => {
    setModalOpened(false);
    setModalContent(null);
    setModalLoading(false);
    setModalError(null);
  }, []);

  const runErrorMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const f of logs) {
      map[f.filename] = f.hasError;
    }
    return map;
  }, [logs]);

  return (
    <Card withBorder p="md" data-testid="population-section">
      <Stack gap="sm">
        <Text fw={600} size="sm">
          Population Analysis
        </Text>

        <Text size="sm" data-testid="population-eligibility">
          {eligibleCount}/{totalCount} subjects eligible (structural + ASL complete)
        </Text>

        <Text size="xs" c="dimmed">
          Population analysis requires at least one subject/session with both Structural and ASL modules complete. Population runs independently and cannot be combined with other modules.
        </Text>

        <Tooltip label={tooltipLabel} disabled={!tooltipLabel} withinPortal>
          <div style={{ display: "inline-block" }}>
            <Checkbox
              label="Enable population analysis"
              checked={populationSelected}
              onChange={handleToggle}
              disabled={checkboxDisabled}
              data-testid="population-checkbox"
            />
          </div>
        </Tooltip>

        <Group gap="xs" align="center">
          <Text size="xs" c="dimmed" data-testid="population-atlas-recap">
            Atlases: {atlases && atlases.length > 0 ? atlases.join(", ") : "No atlases configured"}
          </Text>
          <Text size="xs" c="dimmed">
            — Configured in Parameters
          </Text>
        </Group>

        <Group>
          <Button
            size="xs"
            variant="outline"
            color={hasError ? "red" : "gray"}
            disabled={!hasLog}
            leftSection={<IconBook size={14} />}
            onClick={handleViewLog}
            data-testid="population-log-btn"
          >
            {hasError ? "View Errors" : "View Logs"}
          </Button>
        </Group>
      </Stack>

      <LogViewerModal
        opened={modalOpened}
        onClose={handleCloseModal}
        logContent={modalContent}
        module="population"
        subjectSession=""
        loading={modalLoading}
        error={modalError}
        runErrorMap={runErrorMap}
      />
    </Card>
  );
}
