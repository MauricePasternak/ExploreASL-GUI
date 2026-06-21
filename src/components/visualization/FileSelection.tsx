import { Alert, Select, Stack, Text } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

import { useVisualizationStore } from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";
import { parseStatsFileName } from "../../lib/tsvUtils";

export default function FileSelection() {
  const availableFiles = useVisualizationStore((s) => s.availableFiles);
  const setInspection = useVisualizationStore((s) => s.setInspection);
  const contractSources = useVisualizationStore((s) => s.contractSources);
  const setContractSources = useVisualizationStore((s) => s.setContractSources);
  const setColumnTypes = useVisualizationStore((s) => s.setColumnTypes);
  const setIdentifiers = useVisualizationStore((s) => s.setIdentifiers);
  const invalidateContract = useVisualizationStore((s) => s.invalidateContract);
  const project = useProjectStore((s) => s.project);
  const [error, setError] = useState<string | null>(null);

  const selectedFile = contractSources[0]?.relativePath ?? null;

  const data = availableFiles.map((f) => {
    const parsed = parseStatsFileName(f.fileName);
    const label = parsed
      ? `${f.fileName} (${parsed.metric ?? "?"} · ${parsed.tissue ?? "?"} · ${parsed.atlas ?? "?"})`
      : f.fileName;
    return { value: f.relativePath, label };
  });

  async function handleSelect(relativePath: string | null) {
    if (!project) return;
    setError(null);

    if (selectedFile && selectedFile !== relativePath) {
      invalidateContract();
    }

    if (!relativePath) {
      setInspection(null);
      setContractSources([]);
      return;
    }

    try {
      const result = await invoke<{
        columns: Array<{
          name: string;
          units: string;
          inferredType: string;
          levels: string[];
          isIdentifier: boolean;
        }>;
        rowCount: number;
        fileHash: string;
      }>("inspect_tsv", {
        projectRoot: project.projectMeta.rootPath,
        relativePath,
      });

      setInspection(result);
      setContractSources([{ relativePath, fileHash: result.fileHash }]);

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
      console.error("Failed to inspect TSV:", err);
      setError(`Failed to inspect file: ${err instanceof Error ? err.message : "Unknown error"}`);
      setInspection(null);
      setContractSources([]);
    }
  }

  if (availableFiles.length === 0) {
    return (
      <Stack data-testid="file-selection">
        <Text c="dimmed">No TSV files found in Population/Stats.</Text>
      </Stack>
    );
  }

  return (
    <Stack data-testid="file-selection">
      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" data-testid="file-selection-error">
          {error}
        </Alert>
      )}
      {!selectedFile && !error && <Text c="dimmed">Select a TSV file to begin.</Text>}
      <Select
        label="Stats file"
        placeholder="Choose a TSV file"
        data={data}
        value={selectedFile}
        onChange={handleSelect}
        searchable
        data-testid="file-selection-dropdown"
      />
    </Stack>
  );
}
