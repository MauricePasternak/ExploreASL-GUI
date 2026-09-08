import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { memo, useCallback, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";
import {
  commitBidsProjectMutations,
  preflightBidsSetupRepair,
  type SetupPlan,
} from "../../lib/bids/setup";
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
  const bidsCompatibilityError = useProcessingStore((s) => s.bidsCompatibilityError);
  const clearBidsCompatibilityError = useProcessingStore((s) => s.clearBidsCompatibilityError);
  const projectRoot = useProjectStore((s) => s.project?.projectMeta.rootPath ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reprocessEntries, setReprocessEntries] = useState<CompletedSubjectEntry[]>([]);
  const [repairPlan, setRepairPlan] = useState<SetupPlan | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);

  const { label, color, icon: Icon, action } = getButtonProps(phase);
  const isStartAction = action === "start";

  const handleClick = useCallback(() => {
    if (action === "kill") {
      setConfirmOpen(true);
    } else if (action === "start") {
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

  const handleCompatibilityErrorClose = useCallback(() => {
    void clearBidsCompatibilityError();
  }, [clearBidsCompatibilityError]);

  const handleReviewRepair = useCallback(async () => {
    if (!projectRoot) return;
    setRepairLoading(true);
    setRepairError(null);
    try {
      setRepairPlan(await preflightBidsSetupRepair(projectRoot));
    } catch (error) {
      setRepairError(
        error instanceof Error ? error.message : "Could not inspect BIDS setup repair.",
      );
    } finally {
      setRepairLoading(false);
    }
  }, [projectRoot]);

  const handleCommitRepair = useCallback(async () => {
    if (!repairPlan || repairPlan.conflicts.length > 0) return;
    setRepairLoading(true);
    try {
      await commitBidsProjectMutations(repairPlan.planId);
      setRepairPlan(null);
      setRepairError(null);
      void clearBidsCompatibilityError();
    } catch (error) {
      setRepairError(error instanceof Error ? error.message : "BIDS setup repair failed.");
    } finally {
      setRepairLoading(false);
    }
  }, [clearBidsCompatibilityError, repairPlan]);

  return (
    <>
      <Group gap="sm" data-testid="control-buttons">
        <Button
          leftSection={<Icon size={16} />}
          color={color}
          onClick={handleClick}
          disabled={action === "wait" || (isStartAction && startDisabled)}
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

      <Modal
        opened={bidsCompatibilityError != null}
        onClose={handleCompatibilityErrorClose}
        title="BIDS setup needs repair"
        size="lg"
        data-testid="bids-compatibility-error-modal"
        returnFocus={false}
        transitionProps={{ duration: 0, exitDuration: 0 }}
      >
        <Stack gap="md">
          <Text size="sm" ff="monospace" data-testid="bids-compatibility-error-text">
            {bidsCompatibilityError ?? ""}
          </Text>
          <Text size="sm">
            Processing did not modify this project. Review and confirm a BIDS setup repair before
            retrying processing.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={handleCompatibilityErrorClose}
              data-testid="bids-compatibility-error-close-btn"
            >
              Close
            </Button>
            <Button onClick={handleReviewRepair} data-testid="bids-repair-preflight-btn">
              Review repair
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={repairPlan !== null || repairError !== null}
        onClose={() => {
          setRepairPlan(null);
          setRepairError(null);
        }}
        title="Review BIDS setup repair"
        data-testid="bids-repair-review-modal"
      >
        <Stack gap="sm">
          {repairError && (
            <Text c="red" data-testid="bids-repair-error">
              {repairError}
            </Text>
          )}
          {repairLoading && !repairPlan && (
            <Text data-testid="bids-repair-loading">Loading repair plan…</Text>
          )}
          {repairPlan?.operations.map((operation) => (
            <Stack
              key={operation.path}
              gap={0}
              data-testid={`bids-repair-operation-${operation.path.replace(/[/.]/g, "-")}`}
            >
              <Text size="sm">
                <strong>{operation.operation}</strong> {operation.path}
              </Text>
              {operation.textPreview && (
                <Text
                  ff="monospace"
                  size="xs"
                  style={{ whiteSpace: "pre-wrap" }}
                  data-testid={`bids-repair-preview-${operation.path.replace(/[/.]/g, "-")}`}
                >
                  {operation.textPreview}
                </Text>
              )}
            </Stack>
          ))}
          {repairPlan?.conflicts.map((conflict) => (
            <Text key={conflict} c="red" data-testid="bids-repair-conflict">
              {conflict}
            </Text>
          ))}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setRepairPlan(null)}
              data-testid="bids-repair-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              loading={repairLoading}
              disabled={!repairPlan || repairPlan.conflicts.length > 0}
              onClick={handleCommitRepair}
              data-testid="bids-repair-confirm-btn"
            >
              Confirm repair
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
});

export default ControlButtons;
