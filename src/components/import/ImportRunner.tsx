import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconAlertCircle, IconArrowLeft, IconPlayerPlay } from "@tabler/icons-react";

import { useGlobalStore } from "../../stores/globalStore";
import { useImportStore } from "../../stores/importStore";

export default function ImportRunner() {
  const setActiveStep = useImportStore((state) => state.setActiveStep);
  const importProgress = useImportStore((state) => state.importProgress);
  const importSummary = useImportStore((state) => state.importSummary);
  const importRunning = useImportStore((state) => state.importRunning);
  const settings = useGlobalStore((state) => state.settings);

  const matlabConfigured = settings.matlabInstallations.length > 0;
  const exploreAslConfigured = settings.exploreAslPath.trim().length > 0;
  const canRunImport = matlabConfigured && exploreAslConfigured;

  function handleBack() {
    setActiveStep(3);
  }

  return (
    <Card withBorder p="md" data-testid="runner-card">
      <Stack gap="md">
        {!canRunImport && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Import settings required"
            color="yellow"
            variant="light"
            data-testid="runner-alert-no-settings"
          >
            Configure at least one MATLAB installation and the ExploreASL path
            before running the import.
          </Alert>
        )}

        <Card withBorder p="md" data-testid="runner-progress-card">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>Import Progress</Text>
              {importRunning && <Badge color="blue">Running</Badge>}
            </Group>

            {Object.keys(importProgress).length === 0 ? (
              <Text c="dimmed" size="sm">
                No import progress yet. Start an import to populate this table.
              </Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Subject</Table.Th>
                    <Table.Th>Session</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Current Step</Table.Th>
                    <Table.Th>Error</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Object.values(importProgress).map((entry) => (
                    <Table.Tr key={`${entry.subject}-${entry.session}`}>
                      <Table.Td>{entry.subject}</Table.Td>
                      <Table.Td>{entry.session}</Table.Td>
                      <Table.Td>{entry.status}</Table.Td>
                      <Table.Td>{entry.currentStep ?? "—"}</Table.Td>
                      <Table.Td>{entry.error ?? "—"}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}

            {importSummary && (
              <Alert color="blue" variant="light" title="Latest Summary">
                Succeeded: {importSummary.succeeded}, failed: {importSummary.failed}
              </Alert>
            )}
          </Stack>
        </Card>

        <Group justify="space-between">
          <Button
            leftSection={<IconArrowLeft size={16} />}
            variant="light"
            onClick={handleBack}
            data-testid="runner-back-btn"
          >
            Back: Metadata
          </Button>
          <Button
            leftSection={<IconPlayerPlay size={16} />}
            disabled={!canRunImport}
            data-testid="runner-run-import-btn"
          >
            Run Import
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}