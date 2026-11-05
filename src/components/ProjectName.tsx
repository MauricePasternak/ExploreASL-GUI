import { ActionIcon, Group, Text, TextInput } from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { useProjectStore } from "../stores/projectStore";

function nameError(name: string): string | null {
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(name))
    return "Project name must be a single line without control characters";
  return name.trim() ? null : "Project name cannot be blank";
}

export default function ProjectName({
  name,
  projectId,
  generation,
  inputRef,
}: {
  name: string;
  projectId: string;
  generation: number;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const renameProject = useProjectStore((state) => state.renameProject);
  const setDraftError = useProjectStore((state) => state.setDraftError);
  const discardRejectedEdit = useProjectStore((state) => state.discardRejectedEdit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const cancelled = useRef(false);
  const returnFocus = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const rejectedEdit = useRef<Promise<void> | null>(null);

  function discardRejection() {
    if (rejectedEdit.current) discardRejectedEdit(rejectedEdit.current);
    rejectedEdit.current = null;
  }

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing, inputRef]);

  useEffect(() => () => setDraftError("projectName", null), [setDraftError]);

  async function submit() {
    const current = useProjectStore.getState().project;
    if (
      cancelled.current ||
      pending.current ||
      current?.projectMeta.id !== projectId ||
      current.activationGeneration !== generation
    )
      return;
    const message = nameError(draft);
    setError(message);
    setDraftError("projectName", message);
    if (message) {
      returnFocus.current = false;
      return;
    }
    if (draft.trim() === current.projectMeta.name) {
      discardRejection();
      setDraftError("projectName", null);
      setEditing(false);
      return;
    }
    pending.current = true;
    setSubmitting(true);
    const operation = renameProject(draft.trim());
    try {
      await operation;
      rejectedEdit.current = null;
      setEditing(false);
    } catch (failure) {
      returnFocus.current = false;
      const active = useProjectStore.getState().project;
      if (active?.projectMeta.id === projectId && active.activationGeneration === generation) {
        rejectedEdit.current = operation;
        const message = failure instanceof Error ? failure.message : String(failure);
        setError(message);
        setDraftError("projectName", message);
      }
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Group gap={4} wrap="nowrap" miw={0} data-testid="layout-project-name">
      {editing ? (
        <TextInput
          ref={inputRef}
          aria-label="Project name"
          size="xs"
          w="clamp(8rem, 28vw, 30rem)"
          value={draft}
          readOnly={submitting}
          error={error}
          errorProps={{ role: "alert", "data-testid": "layout-project-name-error" }}
          onChange={(event) => {
            returnFocus.current = false;
            const value = event.currentTarget.value;
            setDraft(value);
            const message = nameError(value);
            setDraftError("projectName", message);
            setError(error ? message : null);
          }}
          onBlur={() => void submit()}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || submitting) return;
            if (event.key === "Enter") {
              event.preventDefault();
              returnFocus.current = true;
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelled.current = true;
              returnFocus.current = true;
              discardRejection();
              setDraftError("projectName", null);
              setEditing(false);
            }
          }}
          data-testid="layout-project-name-input"
        />
      ) : (
        <Text c="dimmed" truncate maw="35vw" title={name} data-testid="layout-project-name-text">
          {name}
        </Text>
      )}
      <ActionIcon
        ref={editButton}
        variant="subtle"
        color="gray"
        size="sm"
        aria-label="Rename project"
        title="Rename project"
        disabled={editing}
        onClick={() => {
          cancelled.current = false;
          setDraft(name);
          setError(null);
          setEditing(true);
        }}
        data-testid="layout-project-rename-btn"
      >
        <IconPencil size={14} aria-hidden="true" data-testid="layout-project-rename-icon" />
      </ActionIcon>
    </Group>
  );
}
