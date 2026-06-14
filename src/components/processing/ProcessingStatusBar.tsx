import { Badge, Group, Text } from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useNavigate, useParams } from "react-router";

import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";

const PHASE_LABELS: Record<string, string> = {
  preparing: "Preparing",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const PHASE_COLORS: Record<string, string> = {
  preparing: "blue",
  running: "orange",
  completed: "teal",
  failed: "red",
  cancelled: "gray",
};

const MODULE_LABELS: Record<string, string> = {
  structural: "Structural",
  asl: "ASL",
  population: "Population",
};

/**
 * Compute per-module completion: for each module present in the statuses,
 * count distinct subject-sessions and how many of those are "complete".
 */
function computeModuleStats(statuses: { subjectSession?: string; module: string; status: string }[]) {
  // module → Set of all sessions, Set of complete sessions
  const moduleMap = new Map<string, { total: Set<string>; complete: Set<string> }>();

  for (const s of statuses) {
    const key = s.subjectSession ?? "";
    if (!moduleMap.has(s.module)) {
      moduleMap.set(s.module, { total: new Set(), complete: new Set() });
    }
    const entry = moduleMap.get(s.module)!;
    entry.total.add(key);
    if (s.status === "complete") {
      entry.complete.add(key);
    }
  }

  // Return in a stable order: structural → asl → population → anything else
  const ORDER = ["structural", "asl", "population"];
  const sorted = [...moduleMap.entries()].sort(
    (a, b) => (ORDER.indexOf(a[0]) === -1 ? 99 : ORDER.indexOf(a[0])) -
              (ORDER.indexOf(b[0]) === -1 ? 99 : ORDER.indexOf(b[0])),
  );

  return sorted.map(([mod, { total, complete }]) => ({
    module: mod,
    label: MODULE_LABELS[mod] ?? mod,
    completeCount: complete.size,
    totalCount: total.size,
  }));
}

export default function ProcessingStatusBar() {
  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);
  const navigate = useNavigate();
  const params = useParams();
  const project = useProjectStore((s) => s.project);

  if (processingPhase === "idle") {
    return null;
  }

  const label = PHASE_LABELS[processingPhase] ?? processingPhase;
  const color = PHASE_COLORS[processingPhase] ?? "gray";
  const moduleStats = computeModuleStats(subjectStatuses);

  const handleClick = () => {
    const id = params.id ?? project?.projectMeta.id;
    if (id) {
      navigate(`/project/${id}/processing`);
    }
  };

  return (
    <Group
      gap="xs"
      align="center"
      onClick={handleClick}
      style={{ cursor: "pointer" }}
      data-testid="processing-status-bar"
    >
      <IconPlayerPlay size={14} />
      <Badge size="sm" variant="light" color={color}>
        {label}
      </Badge>
      {moduleStats.length > 0 && (
        <Text size="xs" c="dimmed" data-testid="processing-status-bar-progress">
          {moduleStats
            .map((m) => `${m.label} ${m.completeCount}/${m.totalCount}`)
            .join(" · ")}
        </Text>
      )}
    </Group>
  );
}

