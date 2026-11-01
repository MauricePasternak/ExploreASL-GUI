import { comboboxTestIds } from "../common/comboboxTestIds";
import { Alert, Select, Stack, Text } from "@mantine/core";
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
      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" data-testid="data-selection-error">
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
      {qcbfSource && <JoinConfig />}
    </Stack>
  );
}
