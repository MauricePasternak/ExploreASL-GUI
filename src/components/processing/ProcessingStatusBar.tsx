import { useEffect, useState } from "react";
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

export default function ProcessingStatusBar() {
  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const navigate = useNavigate();
  const params = useParams();
  const project = useProjectStore((s) => s.project);

  const [progress, setProgress] = useState({ completeCount: 0, totalCount: 0 });

  useEffect(() => {
    const state = useProcessingStore.getState();
    setProgress({
      completeCount: state.subjectStatuses.filter((s) => s.status === "complete").length,
      totalCount: state.subjectStatuses.length,
    });
  }, [processingPhase]);

  if (processingPhase === "idle") {
    return null;
  }

  const { completeCount, totalCount } = progress;
  const label = PHASE_LABELS[processingPhase] ?? processingPhase;
  const color = PHASE_COLORS[processingPhase] ?? "gray";

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
      {totalCount > 0 && (
        <Text size="xs" c="dimmed">
          {completeCount}/{totalCount} subjects
        </Text>
      )}
    </Group>
  );
}
