import { comboboxTestIds } from "../common/comboboxTestIds";
import { Alert, Code, Paper, Select, Stack, Text } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { commands, unwrap } from "../../lib/ipc";
import { useState } from "react";

import { useVisualizationStore } from "../../stores/visualizationStore";
import { visualizationSettings } from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";
import { parseStatsFileName } from "../../lib/tsvUtils";
import JoinConfig from "./JoinConfig";
import { captureProjectLease, isCurrentProjectLease } from "../../lib/projectLifecycle";

export default function DataSelection() {
  const availableFiles = useVisualizationStore((s) => s.availableFiles);
  const setInspection = useVisualizationStore((s) => s.setInspection);
  const inspection = useVisualizationStore((s) => s.inspection);
  const qcbfSource = useProjectStore((s) => visualizationSettings(s.project).qcbfSource);
  const setQcbfSource = useVisualizationStore((s) => s.setQcbfSource);
  const setColumnTypes = useVisualizationStore((s) => s.setColumnTypes);
  const setIdentifiers = useVisualizationStore((s) => s.setIdentifiers);
  const invalidateContract = useVisualizationStore((s) => s.invalidateContract);
  const project = useProjectStore((s) => s.project);
  const [error, setError] = useState<string | null>(null);

  const data = availableFiles.map((f) => {
    const parsed = parseStatsFileName(f.fileName);
    const label = parsed
      ? `${f.fileName} (${parsed.metric ?? "?"} · ${parsed.tissue ?? "?"} · ${parsed.atlas ?? "?"})`
      : f.fileName;
    return { value: f.relativePath, label };
  });

  async function handleSelectQcbf(relativePath: string | null) {
    if (!project) return;
    const lease = captureProjectLease();
    setError(null);

    if (qcbfSource && qcbfSource.relativePath !== relativePath) {
      invalidateContract();
    }

    if (!relativePath) {
      setInspection(null);
      setQcbfSource(null);
      return;
    }

    try {
      const result = await unwrap(
        commands.loadQcbfData(project.projectMeta.rootPath, relativePath),
      );
      if (lease && !isCurrentProjectLease(lease)) return;

      setInspection(result);
      setQcbfSource({ relativePath, fileHash: result.qcbfHash });

      const types: Record<string, string> = {};
      for (const col of result.columns) {
        types[col.name] = col.inferredType;
      }
      setColumnTypes(types);

      const subjectCol = result.columns.find((c) => c.name === "subject");
      const sessionCol = result.columns.find((c) => c.name === "session");
      const runCol = result.columns.find((c) => c.name === "run");
      if (subjectCol && sessionCol && runCol) {
        setIdentifiers({
          subject: subjectCol.name,
          session: sessionCol.name,
          run: runCol.name,
        });
      }
    } catch (err) {
      if (lease && !isCurrentProjectLease(lease)) return;
      console.error("Failed to load qCBF data:", err);
      setError(`Failed to inspect file: ${err instanceof Error ? err.message : "Unknown error"}`);
      setInspection(null);
      setQcbfSource(null);
    }
  }

  if (availableFiles.length === 0) {
    return (
      <Stack data-testid="data-selection">
        <Text c="dimmed">No TSV files found in Population/Stats.</Text>
      </Stack>
    );
  }

  return (
    <Stack data-testid="data-selection">
      <Paper withBorder p="md" data-testid="data-selection-source" className="dataviz-setup-panel">
        <Stack gap="sm" data-testid="data-selection-source-content">
          <Text component="h2" size="md" fw={600} m={0} data-testid="data-selection-heading">
            Population statistics
          </Text>
          <Code data-testid="data-selection-directory" className="dataviz-path">
            derivatives/ExploreASL/Population/Stats/
          </Code>
          {error && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              data-testid="data-selection-error"
            >
              {error}
            </Alert>
          )}
          {!qcbfSource && !error && <Text c="dimmed">Select a TSV file to begin.</Text>}
          <Select
            label="Stats file"
            placeholder="Choose a TSV file"
            data={data}
            value={qcbfSource?.relativePath ?? null}
            onChange={handleSelectQcbf}
            searchable
            {...comboboxTestIds("qcbf-file-dropdown")}
          />
          {qcbfSource && (
            <Code className="dataviz-path" data-testid="data-selection-file">
              {qcbfSource.relativePath}
            </Code>
          )}
          {inspection && (
            <Text size="sm" data-testid="data-selection-inspection">
              {inspection.rowCount.toLocaleString()} loaded rows · {inspection.columns.length}{" "}
              columns · {inspection.qcbfRowCount.toLocaleString()} original qCBF rows
            </Text>
          )}
          <Text size="xs" c="dimmed" data-testid="data-selection-help">
            Changing the Stats file resets dependent setup. GUI Session = ExploreASL Visit; GUI Run
            = ExploreASL Session.
          </Text>
        </Stack>
      </Paper>
      {qcbfSource && <JoinConfig />}
    </Stack>
  );
}
