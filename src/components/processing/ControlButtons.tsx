import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { memo, useCallback, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import { useProcessingStore } from "../../stores/processingStore";
import {
  CompletedSubjectEntry,
  findCompletedSubjects,
  getButtonProps,
} from "./ControlButton.helpers";

// ---------------------------------------------------------------------------
// ConfirmReprocessDialog
// ---------------------------------------------------------------------------
function ConfirmReprocessDialog({
  opened,
  onClose,
  onConfirm,
  entries,
}: {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  entries: CompletedSubjectEntry[];
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Re-process completed subjects?"
      data-testid="confirm-reprocess-dialog"
    >
      <Text size="sm">
        The following {entries.length} subject(s) have already completed processing for the selected
        module(s). Re-processing will overwrite their existing output.
      </Text>
      <div
        style={{
          height: Math.min(entries.length * 28, 300),
          marginTop: "var(--mantine-spacing-sm)",
        }}
      >
        <Virtuoso
          data={entries}
          itemContent={(_index, entry) => (
            <div style={{ padding: "2px 0" }}>
              <Text size="sm" component="span" ff="monospace">
                {entry.subjectSession}
              </Text>
              {" — "}
              {entry.modules.map((m) => (m === "asl" ? "ASL" : "Structural")).join(", ")}
            </div>
          )}
        />
      </div>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose} data-testid="confirm-reprocess-cancel">
          Cancel
        </Button>
        <Button color="orange" onClick={onConfirm} data-testid="confirm-reprocess-confirm">
          Re-process anyway
        </Button>
      </Group>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ControlButtonsProps {
  startDisabled?: boolean;
}

const ControlButtons = memo(function ControlButtons({
  startDisabled = false,
}: ControlButtonsProps = {}) {
  const phase = useProcessingStore((s) => s.processingPhase);
  const startProcessing = useProcessingStore((s) => s.startProcessing);
  const killProcessing = useProcessingStore((s) => s.killProcessing);
  const pendingRawdataWarning = useProcessingStore((s) => s.pendingRawdataWarning);
  const clearPendingRawdataWarning = useProcessingStore((s) => s.clearPendingRawdataWarning);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reprocessEntries, setReprocessEntries] = useState<CompletedSubjectEntry[]>([]);

  const { label, color, icon: Icon, action } = getButtonProps(phase);
  const isStartAction = action === "start";

  const handleClick = useCallback(() => {
    if (action === "kill") {
      setConfirmOpen(true);
    } else {
      const { config, subjectStatuses } = useProcessingStore.getState();
      if (!config) return;

      const completed = findCompletedSubjects(config.subjects, config.modules, subjectStatuses);

      if (completed.length > 0) {
        setReprocessEntries(completed);
      } else {
        startProcessing();
      }
    }
  }, [action, startProcessing]);

  const handleConfirmKill = useCallback(() => {
    setConfirmOpen(false);
    killProcessing();
  }, [killProcessing]);

  const handleCancelKill = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  const handleConfirmReprocess = useCallback(() => {
    setReprocessEntries([]);
    startProcessing();
  }, [startProcessing]);

  const handleCancelReprocess = useCallback(() => {
    setReprocessEntries([]);
  }, []);

  const handleRawdataWarningCancel = useCallback(() => {
    // User declined — abort processing; do NOT call startProcessing(true)
    clearPendingRawdataWarning();
  }, [clearPendingRawdataWarning]);

  const handleRawdataWarningConfirm = useCallback(() => {
    // User confirmed — proceed past the warning. startProcessing(true) skips
    // the ensure_rawdata_dir call (already invoked) and clears the warning
    // state from inside the store on success.
    void startProcessing(true);
  }, [startProcessing]);

  return (
    <>
      <Group gap="sm" data-testid="control-buttons">
        <Button
          leftSection={<Icon size={16} />}
          color={color}
          onClick={handleClick}
          disabled={phase === "preparing" || (isStartAction && startDisabled)}
          data-testid={isStartAction ? "start-btn" : "stop-btn"}
        >
          {label}
        </Button>
      </Group>

      <Modal
        opened={confirmOpen}
        onClose={handleCancelKill}
        title="Stop Processing"
        size="sm"
        data-testid="stop-confirm-modal"
        returnFocus={false}
      >
        <Stack gap="md">
          <Text size="sm">Stop all running processing jobs? This cannot be undone.</Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="xs"
              onClick={handleCancelKill}
              data-testid="stop-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              color="red"
              size="xs"
              onClick={handleConfirmKill}
              data-testid="stop-confirm-btn"
            >
              Stop
            </Button>
          </Group>
        </Stack>
      </Modal>

      <ConfirmReprocessDialog
        opened={reprocessEntries.length > 0}
        onClose={handleCancelReprocess}
        onConfirm={handleConfirmReprocess}
        entries={reprocessEntries}
      />

      {/*
        BIDS-direct rawdata/ warning modal — required by Phase 8.2 spec
        ("processing MUST wait for user confirmation before proceeding").
        Pending warning state is set by processingStore.startProcessing()
        when ensure_rawdata_dir returns a non-empty sub-directory count.
      */}
      <Modal
        opened={pendingRawdataWarning != null}
        onClose={handleRawdataWarningCancel}
        title="Existing rawdata/ directory"
        size="lg"
        data-testid="bids-rawdata-warning-modal"
        returnFocus={false}
        transitionProps={{ duration: 0, exitDuration: 0 }}
      >
        <Stack gap="md">
          <Text size="sm" ff="monospace" data-testid="bids-rawdata-warning-text">
            {pendingRawdataWarning ?? ""}
          </Text>
          <Text size="sm">
            The{" "}
            <Text span ff="monospace" size="xs">
              subjectFolder
            </Text>{" "}
            override scans root-level subjects only; files inside{" "}
            <Text span ff="monospace" size="xs">
              rawdata/
            </Text>{" "}
            will be ignored by ExploreASL. Proceed?
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={handleRawdataWarningCancel}
              data-testid="bids-rawdata-warning-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              color="orange"
              onClick={handleRawdataWarningConfirm}
              data-testid="bids-rawdata-warning-confirm-btn"
            >
              Proceed anyway
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
});

export default ControlButtons;
