import { Button, Divider, List, Paper, Stack, Text, Title } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";

interface WelcomeCardProps {
  onOpenSettings: () => void;
}

export default function WelcomeCard({ onOpenSettings }: WelcomeCardProps) {
  return (
    <Paper
      withBorder
      shadow="sm"
      p="xl"
      radius="md"
      data-testid="welcome-card"
      style={{ maxWidth: 560, margin: "0 auto" }}
    >
      <Stack gap="md">
        <Title order={2} data-testid="welcome-card-title">
          Welcome to ExploreASL GUI
        </Title>
        <Text c="dimmed" data-testid="welcome-card-description">
          Before you can import or process ASL MRI data, configure an execution profile with paths
          to MATLAB and ExploreASL. Profiles let the app run pipelines with the correct environment
          on your machine.
        </Text>
        <List type="ordered" spacing="xs" data-testid="welcome-card-steps">
          <List.Item>Click &quot;Open Settings&quot;</List.Item>
          <List.Item>Add a MATLAB profile</List.Item>
          <List.Item>Create your first project</List.Item>
        </List>
        <Divider my="xs" data-testid="welcome-card-divider" />
        <Stack gap="xs" data-testid="welcome-card-project-types">
          <Text size="sm" fw={700}>
            Supported Project Types:
          </Text>
          <Text size="sm" c="dimmed">
            • <strong>DICOM Projects:</strong> Import raw DICOM MRI data which the GUI will
            automatically convert to BIDS structure.
          </Text>
          <Text size="sm" c="dimmed">
            • <strong>BIDS Projects:</strong> Open or skip import for pre-existing, BIDS-compliant
            datasets (containing sub-* directories).
          </Text>
        </Stack>
        <Button
          size="lg"
          leftSection={<IconSettings size={20} />}
          onClick={onOpenSettings}
          data-testid="welcome-open-settings-btn"
        >
          Open Settings
        </Button>
      </Stack>
    </Paper>
  );
}
