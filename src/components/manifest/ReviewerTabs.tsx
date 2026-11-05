import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ActionIcon, Badge, Box, Button, Group, Modal, Tabs, Text, Tooltip } from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";

import { MAX_REVIEWERS } from "../../schemas/manifestSchemas";
import { useProjectStore } from "../../stores/projectStore";

export interface ReviewerTabsProps {
  /** Subject-sessions eligible for review; excludes No Info rows. */
  eligibleSubjectSessions: Iterable<string>;
  inventoryCount: number;
  children: (reviewerId?: string) => ReactNode;
}

export default function ReviewerTabs({
  eligibleSubjectSessions,
  inventoryCount,
  children,
}: ReviewerTabsProps) {
  const manifest = useProjectStore((state) => state.project?.uiState.manifest);
  const addReviewer = useProjectStore((state) => state.addReviewer);
  const removeReviewer = useProjectStore((state) => state.removeReviewer);
  const setActiveReviewerId = useProjectStore((state) => state.setActiveReviewerId);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);

  const reviewers = manifest?.reviewers ?? [];
  const multiReviewer = reviewers.length > 1;
  const activeReviewerId = manifest?.activeReviewerId;
  const slices = useMemo(() => manifest?.verdicts ?? {}, [manifest?.verdicts]);
  const eligibleSessions = useMemo(
    () => Array.from(new Set(eligibleSubjectSessions)),
    [eligibleSubjectSessions],
  );
  const pendingReviewer = reviewers.find((reviewer) => reviewer.id === pendingRemovalId);

  const completion = useCallback(
    (reviewerId: string) => {
      const reviewerVerdicts = slices[reviewerId] ?? {};
      return eligibleSessions.reduce(
        (resolved, subjectSession) => resolved + Number(subjectSession in reviewerVerdicts),
        0,
      );
    },
    [eligibleSessions, slices],
  );
  const requestRemoval = useCallback(
    (reviewerId: string) => {
      if (Object.keys(slices[reviewerId] ?? {}).length === 0) {
        removeReviewer(reviewerId);
        return;
      }
      setPendingRemovalId(reviewerId);
    },
    [removeReviewer, slices],
  );

  const confirmRemoval = useCallback(() => {
    if (pendingRemovalId) removeReviewer(pendingRemovalId);
    setPendingRemovalId(null);
  }, [pendingRemovalId, removeReviewer]);

  const addControl = (
    <Tooltip label="Maximum of 5 reviewers reached" disabled={reviewers.length < MAX_REVIEWERS}>
      <Box component="span">
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          disabled={reviewers.length >= MAX_REVIEWERS}
          onClick={addReviewer}
          data-testid="add-reviewer"
        >
          Add Reviewer
        </Button>
      </Box>
    </Tooltip>
  );
  const heading = (
    <Group justify="space-between" align="start" mb="md" data-testid="qc-worklist-heading">
      <Box>
        <Text fw={600} size="lg">
          QC work list
        </Text>
        <Text size="xs" c="dimmed" data-testid="qc-cohort-summary">
          {inventoryCount.toLocaleString()} inventory entries ·{" "}
          {eligibleSessions.length.toLocaleString()} eligible ·{" "}
          {(inventoryCount - eligibleSessions.length).toLocaleString()} No Info
        </Text>
      </Box>
      {addControl}
    </Group>
  );

  if (!multiReviewer) {
    return (
      <Box className="manifest-worklist" data-testid="reviewer-tabs-controls">
        {heading}
        {activeReviewerId && (
          <Text size="sm" fw={600} mb="sm" data-testid="single-reviewer-completion">
            {reviewers[0]?.label} · {completion(activeReviewerId)}/{eligibleSessions.length}{" "}
            complete
          </Text>
        )}
        {children(activeReviewerId)}
      </Box>
    );
  }

  return (
    <>
      <Tabs
        className="manifest-worklist"
        value={activeReviewerId}
        onChange={(reviewerId) => reviewerId && setActiveReviewerId(reviewerId)}
        keepMounted={false}
        data-testid="reviewer-tabs"
      >
        {heading}
        <Group justify="space-between" align="center" mb="sm" wrap="wrap">
          <Tabs.List>
            {reviewers.map((reviewer) => (
              <Group
                key={reviewer.id}
                gap={2}
                wrap="nowrap"
                data-testid={`reviewer-tab-group-${reviewer.id}`}
              >
                <Tabs.Tab value={reviewer.id} data-testid={`reviewer-tab-${reviewer.id}`}>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm">{reviewer.label}</Text>
                    <Badge
                      size="xs"
                      variant="light"
                      data-testid={`reviewer-completion-${reviewer.id}`}
                    >
                      {completion(reviewer.id)}/{eligibleSessions.length}
                    </Badge>
                  </Group>
                </Tabs.Tab>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label={`Remove ${reviewer.label}`}
                  onClick={() => requestRemoval(reviewer.id)}
                  data-testid={`remove-reviewer-${reviewer.id}`}
                >
                  <IconX size={14} />
                </ActionIcon>
              </Group>
            ))}
          </Tabs.List>
        </Group>

        {reviewers.map((reviewer) => (
          <Tabs.Panel key={reviewer.id} value={reviewer.id} pt="sm">
            {children(reviewer.id)}
          </Tabs.Panel>
        ))}
      </Tabs>

      <Modal
        opened={pendingRemovalId !== null}
        onClose={() => setPendingRemovalId(null)}
        title="Remove reviewer?"
        data-testid="remove-reviewer-confirmation"
        attributes={{ close: { "data-testid": "remove-reviewer-confirmation-close" } }}
        centered
      >
        <Text size="sm">
          Removing {pendingReviewer?.label ?? "this reviewer"} will permanently delete their
          verdicts.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button
            variant="default"
            onClick={() => setPendingRemovalId(null)}
            data-testid="cancel-remove-reviewer"
          >
            Cancel
          </Button>
          <Button color="red" onClick={confirmRemoval} data-testid="confirm-remove-reviewer">
            Remove Reviewer
          </Button>
        </Group>
      </Modal>
    </>
  );
}
