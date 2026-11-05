import { Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { useFocusReturn } from "@mantine/hooks";
import { exists } from "@tauri-apps/plugin-fs";
import { useState, type ReactNode } from "react";
import { isAbsolutePath } from "../../lib/projectPaths";

interface PathEntryButtonProps {
  title: string;
  testId: string;
  defaultPath?: string;
  extensions?: readonly string[];
  save?: boolean;
  disabled?: boolean;
  onSelect: (path: string) => Promise<void>;
  renderTrigger?: (open: () => void) => ReactNode;
}

/** Manual alternative to native choosers; callers retain their normal validation. */
export default function PathEntryButton({
  title,
  testId,
  defaultPath = "",
  extensions = [],
  save = false,
  disabled = false,
  onSelect,
  renderTrigger,
}: PathEntryButtonProps) {
  const [opened, setOpened] = useState(false);
  const [path, setPath] = useState(defaultPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  useFocusReturn({ opened });

  function openDialog() {
    if (disabled || busy) return;
    setPath(defaultPath);
    setError(null);
    setReplace(false);
    setOpened(true);
  }

  async function submit() {
    if (busy || disabled) return;
    if (!isAbsolutePath(path) || path.includes("\0")) {
      setError("Enter an absolute filesystem path.");
      return;
    }
    if (
      extensions.length &&
      !extensions.some((extension) => path.toLowerCase().endsWith(`.${extension}`))
    ) {
      setError(
        `Choose a file ending in ${extensions.map((extension) => `.${extension}`).join(", ")}.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (save && !replace && (await exists(path))) {
        setReplace(true);
        return;
      }
      await onSelect(path);
      setOpened(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {renderTrigger ? (
        renderTrigger(openDialog)
      ) : (
        <Button
          variant="subtle"
          size="sm"
          disabled={disabled}
          aria-label={`${title} by path`}
          data-testid={testId}
          onClick={openDialog}
        >
          Enter path…
        </Button>
      )}
      {opened && (
        <Modal
          opened={opened}
          onClose={() => {
            if (!busy) setOpened(false);
          }}
          title={title}
          data-testid={`${testId}-dialog`}
          attributes={{ close: { "data-testid": `${testId}-close` } }}
          closeOnEscape={!busy}
          closeOnClickOutside={!busy}
          returnFocus={false}
        >
          <form
            data-testid={`${testId}-form`}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Stack data-testid={`${testId}-fields`}>
              <TextInput
                label="Absolute path"
                description="Full filepaths only, no URLs or relative paths."
                data-autofocus
                data-testid={`${testId}-input`}
                maxLength={4096}
                value={path}
                disabled={busy}
                onChange={(event) => {
                  setPath(event.currentTarget.value);
                  setReplace(false);
                  setError(null);
                }}
              />
              {error && (
                <Text c="red" role="alert" data-testid={`${testId}-error`}>
                  {error}
                </Text>
              )}
              {replace && (
                <Text data-testid={`${testId}-overwrite-warning`}>
                  File already exists. Replace it?
                </Text>
              )}
              <Group justify="flex-end" data-testid={`${testId}-actions`}>
                <Button
                  variant="default"
                  disabled={busy}
                  onClick={() => setOpened(false)}
                  data-testid={`${testId}-cancel`}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={busy}
                  disabled={disabled || !path.trim()}
                  color={replace ? "orange" : undefined}
                  data-testid={`${testId}-confirm`}
                >
                  {replace ? "Replace file" : save ? "Save" : "Use path"}
                </Button>
              </Group>
            </Stack>
          </form>
        </Modal>
      )}
    </>
  );
}
