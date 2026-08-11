import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActionIcon, Badge, Box, Button, Group, Modal, Tabs, Text, Tooltip } from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";

import { MAX_REVIEWERS } from "../../schemas/manifestSchemas";
import { useProjectStore } from "../../stores/projectStore";

export interface ReviewerTabsProps {
  /** Subject-sessions eligible for review; excludes No Info rows. */
  eligibleSubjectSessions: Iterable<string>;
  /** Reports whether every reviewer completed every eligible subject-session. */
  onMultiReviewerReady?: (ready: boolean) => void;
  children: (reviewerId?: string, addControl?: ReactNode) => ReactNode;
}

type ReviewerVerdictSlices = Record<string, Record<string, unknown>>;

function verdictSlices(value: unknown): ReviewerVerdictSlices {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as ReviewerVerdictSlices;
}

export default function ReviewerTabs({
  eligibleSubjectSessions,
  onMultiReviewerReady,
  children,
}: ReviewerTabsProps) {
  const manifest = useProjectStore((state) => state.project?.uiState.manifest);
  const addReviewer = useProjectStore((state) => state.addReviewer);
  const removeReviewer = useProjectStore((state) => state.removeReviewer);
  const setActiveReviewerId = useProjectStore((state) => state.setActiveReviewerId);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);

  const reviewers = manifest?.reviewers ?? [];
  const multiReviewer = reviewers.length > 1;
  const activeReviewerId = reviewers.some((reviewer) => reviewer.id === manifest?.activeReviewerId)
    ? manifest?.activeReviewerId
    : (reviewers[0]?.id ?? null);
  const slices = verdictSlices(manifest?.verdicts);
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
  const multiReviewerReady =
    multiReviewer &&
    reviewers.every((reviewer) => completion(reviewer.id) === eligibleSessions.length);

  useEffect(() => {
    if (multiReviewer) onMultiReviewerReady?.(multiReviewerReady);
  }, [multiReviewer, multiReviewerReady, onMultiReviewerReady]);

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

  if (!multiReviewer) {
    return <Box data-testid="reviewer-tabs-controls">{children(undefined, addControl)}</Box>;
  }

  return (
    <>
      <Tabs
        value={activeReviewerId}
        onChange={(reviewerId) => reviewerId && setActiveReviewerId(reviewerId)}
        keepMounted={false}
        data-testid="reviewer-tabs"
      >
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
            {children(reviewer.id, addControl)}
          </Tabs.Panel>
        ))}
      </Tabs>

      <Modal
        opened={pendingRemovalId !== null}
        onClose={() => setPendingRemovalId(null)}
        title="Remove reviewer?"
        data-testid="remove-reviewer-confirmation"
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
