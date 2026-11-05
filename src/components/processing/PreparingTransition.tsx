import { Card, Group, Loader, Stack, Text } from "@mantine/core";

import { useProcessingStore } from "../../stores/processingStore";

export default function PreparingTransition() {
  const preparingMessage = useProcessingStore((s) => s.preparingMessage);

  return (
    <Card
      padding="md"
      radius="md"
      withBorder
      data-testid="preparing-transition"
      style={{
        background: "var(--mantine-color-body)",
        borderColor: "var(--mantine-color-default-border)",
      }}
    >
      <Group gap="md" wrap="nowrap" data-testid="preparing-content">
        <Loader
          size={48}
          color="teal"
          aria-label="Preparing processing"
          data-testid="preparing-ring"
        />

        <Stack gap={4} data-testid="preparing-copy">
          <Text size="sm" fw={600} data-testid="preparing-title">
            Preparing processing
          </Text>
          <Text size="sm" c="dimmed" data-testid="preparing-message" style={{ minHeight: 20 }}>
            {preparingMessage ?? "Getting ready to start..."}
          </Text>
        </Stack>
      </Group>
    </Card>
  );
}
