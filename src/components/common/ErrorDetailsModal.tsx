import { Button, Group, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";

import { useErrorDetailsStore } from "../../lib/errorNotifications";

function ErrorDetailsContent({ message, details }: { message: string; details: string }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyDetails() {
    const text = [message, details].filter(Boolean).join("\n\n");
    try {
      try {
        await writeText(text);
      } catch {
        await navigator.clipboard.writeText(text);
      }
      setCopyStatus("copied");
    } catch (error) {
      console.error("[error-details] Could not copy error details", error);
      setCopyStatus("failed");
    }
  }

  return (
    <Stack data-testid="error-details-content">
      <Text fw={500} style={{ overflowWrap: "anywhere" }} data-testid="error-details-message">
        {message}
      </Text>
      <ScrollArea.Autosize mah="55vh" data-testid="error-details-scroll">
        <Text
          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          data-testid="error-details-explanation"
        >
          {details}
        </Text>
      </ScrollArea.Autosize>
      {copyStatus === "failed" && (
        <Text size="sm" c="red" role="alert" data-testid="error-details-copy-error">
          Could not copy details. Select the text and copy it manually.
        </Text>
      )}
      <Group justify="flex-end" data-testid="error-details-actions">
        <Button variant="light" onClick={() => void copyDetails()} data-testid="error-details-copy">
          {copyStatus === "copied" ? "Copied" : "Copy details"}
        </Button>
        <Button
          onClick={() => useErrorDetailsStore.setState({ error: null })}
          data-testid="error-details-done"
        >
          Close
        </Button>
      </Group>
    </Stack>
  );
}

export default function ErrorDetailsModal() {
  const error = useErrorDetailsStore((state) => state.error);

  return (
    <Modal
      opened={error !== null}
      onClose={() => useErrorDetailsStore.setState({ error: null })}
      title={error?.title ?? "Error details"}
      size="lg"
      centered
      closeButtonProps={{
        "aria-label": "Close error details",
      }}
      attributes={{ close: { "data-testid": "error-details-modal-close" } }}
      data-testid="error-details-modal"
    >
      {error && (
        <ErrorDetailsContent
          key={`${error.id}:${error.message}:${error.details}`}
          message={error.message}
          details={error.details}
        />
      )}
    </Modal>
  );
}
