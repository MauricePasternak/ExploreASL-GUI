import { Card, Center, RingProgress, Stack, Text } from "@mantine/core";
import { IconBrain } from "@tabler/icons-react";

import { useProcessingStore } from "../../stores/processingStore";

export default function PreparingTransition() {
  const preparingMessage = useProcessingStore((s) => s.preparingMessage);

  return (
    <Center style={{ flex: 1, minHeight: 400 }} data-testid="preparing-transition">
      <Card
        shadow="md"
        padding="xl"
        radius="lg"
        withBorder
        w={400}
        style={{
          background: "var(--mantine-color-body)",
          borderColor: "var(--mantine-color-default-border)",
        }}
      >
        <Stack align="center" gap="lg" py="md">
          <div className="spin-forward" data-testid="preparing-ring-container">
            <RingProgress
              size={140}
              thickness={8}
              sections={[{ value: 35, color: "teal" }]}
              data-testid="preparing-ring"
              label={
                <Center className="spin-reverse">
                  <IconBrain
                    size={48}
                    color="var(--mantine-color-teal-filled)"
                    className="pulse-icon"
                    data-testid="preparing-brain-icon"
                  />
                </Center>
              }
            />
          </div>

          <Stack gap="xs" align="center">
            <Text size="lg" fw={600} ta="center" data-testid="preparing-title">
              Preparing Pipeline
            </Text>
            <Text
              size="sm"
              c="dimmed"
              ta="center"
              data-testid="preparing-message"
              style={{ minHeight: 20 }}
            >
              {preparingMessage ?? "Setting up execution environment..."}
            </Text>
            <Text size="xs" c="dimmed" ta="center" mt="xs">
              Please wait while ExploreASL initializes.
            </Text>
          </Stack>
        </Stack>
      </Card>
    </Center>
  );
}
