import { useCallback, useState } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";

import type { ProcessingPhase } from "../../schemas/processingSchemas";
import { useProcessingStore } from "../../stores/processingStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getButtonProps(phase: ProcessingPhase) {
  switch (phase) {
    case "running":
      return { label: "Kill", color: "red", icon: IconPlayerStop, action: "kill" as const };
    case "preparing":
      return { label: "Kill", color: "red", icon: IconPlayerStop, action: "kill" as const };
    case "idle":
    case "completed":
    case "failed":
    case "cancelled":
    default:
      return { label: "Start", color: "teal", icon: IconPlayerPlay, action: "start" as const };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ControlButtons() {
  const phase = useProcessingStore((s) => s.processingPhase);
  const startProcessing = useProcessingStore((s) => s.startProcessing);
  const killProcessing = useProcessingStore((s) => s.killProcessing);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { label, color, icon: Icon, action } = getButtonProps(phase);

  const handleClick = useCallback(() => {
    if (action === "kill") {
      setConfirmOpen(true);
    } else {
      startProcessing();
    }
  }, [action, startProcessing]);

  const handleConfirmKill = useCallback(() => {
    setConfirmOpen(false);
    killProcessing();
  }, [killProcessing]);

  const handleCancelKill = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  return (
    <>
      <Group gap="sm" data-testid="control-buttons">
        <Button
          leftSection={<Icon size={16} />}
          color={color}
          onClick={handleClick}
          disabled={phase === "preparing"}
          data-testid={action === "kill" ? "kill-btn" : "start-btn"}
        >
          {label}
        </Button>
      </Group>

      <Modal
        opened={confirmOpen}
        onClose={handleCancelKill}
        title="Kill Processing"
        size="sm"
        data-testid="kill-confirm-modal"
        transitionDuration={0}
        returnFocus={false}
      >
        <Stack gap="md">
          <Text size="sm">
            Stop all running processing jobs? This cannot be undone.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="xs"
              onClick={handleCancelKill}
              data-testid="kill-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              color="red"
              size="xs"
              onClick={handleConfirmKill}
              data-testid="kill-confirm-btn"
            >
              Kill
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
