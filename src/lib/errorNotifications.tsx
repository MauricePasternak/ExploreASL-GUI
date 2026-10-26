import { Anchor, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { create } from "zustand";

interface ErrorDetails {
  id: string;
  title: string;
  message: string;
  details: string;
}

export const useErrorDetailsStore = create<{ error: ErrorDetails | null }>(() => ({
  error: null,
}));

interface ErrorNotification {
  id: string;
  title: string;
  /** Human-facing operation summary, never an arbitrary caught error's message. */
  message: string;
  details?: string;
  error?: unknown;
}

let errorPriority = 0;

function readableText(text: string) {
  return text
    .replace(
      // oxlint-disable-next-line no-control-regex -- Remove terminal CSI/OSC sequences, not user text.
      /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))|\u009b[0-?]*[ -/]*[@-~]/g,
      "",
    )
    .replace(/\r\n?/g, "\n")
    .trim();
}

function applicationDetails(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    "details" in error &&
    typeof error.details === "string"
  ) {
    return error.details;
  }
  return "";
}

export function showErrorNotification(options: ErrorNotification) {
  if (options.error !== undefined) {
    // IDs may contain a selected project path; do not add them to diagnostics.
    console.error(`[notification] ${options.title}`, options.error);
  }

  const message = readableText(options.message);
  const explanation = readableText(options.details ?? applicationDetails(options.error));
  const error: ErrorDetails = {
    id: options.id,
    title: readableText(options.title),
    message,
    details: explanation === message ? "" : explanation,
  };
  const notification = {
    id: error.id,
    color: "red",
    title: error.title,
    autoClose: false as const,
    priority: ++errorPriority,
    message: (
      <Stack gap={4} data-testid={`error-notification-${error.id}`}>
        <Text size="sm" data-testid="error-notification-message">
          {error.message}
        </Text>
        {error.details && (
          <Anchor
            component="button"
            type="button"
            size="sm"
            ta="left"
            onClick={() => useErrorDetailsStore.setState({ error })}
            data-testid="error-notification-details"
          >
            See details
          </Anchor>
        )}
      </Stack>
    ),
  };

  // show ignores existing IDs; update ignores missing IDs. Together they upsert,
  // including queued notifications, without maintaining a second notification registry.
  notifications.show(notification);
  notifications.update(notification);
  if (useErrorDetailsStore.getState().error?.id === error.id) {
    useErrorDetailsStore.setState({ error });
  }
  return error.id;
}
