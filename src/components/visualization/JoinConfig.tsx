import {
  Alert,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  Stack,
  TagsInput,
  Text,
} from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

import { useProjectStore } from "../../stores/projectStore";
import { useVisualizationStore } from "../../stores/visualizationStore";
import JoinDiagram from "./JoinDiagram";
import SanityChecks from "./SanityChecks";

const DEFAULT_NA_TOKENS = ["", "NaN", "NA", "n/a", "<NA>"];
const IDENTIFIER_COLUMNS = ["participant_id", "subject", "session", "run"];

export default function JoinConfig() {
  const joinConfig = useVisualizationStore((s) => s.joinConfig);
  const setJoinConfig = useVisualizationStore((s) => s.setJoinConfig);
  const qcbfSource = useVisualizationStore((s) => s.qcbfSource);
  const inspection = useVisualizationStore((s) => s.inspection);
  const project = useProjectStore((s) => s.project);
  const [extInspection, setExtInspection] = useState<{
    columns: Array<{ name: string; inferredType: string; levels: string[]; isIdentifier: boolean }>;
    rowCount: number;
    fileHash: string;
    sheetName: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastInspectedRef = useRef<{ path: string; hash: string; delimiter: string } | null>(null);

  useEffect(() => {
    if (!joinConfig) {
      lastInspectedRef.current = null;
      return;
    }

    const currentPath = joinConfig.externalSource.absolutePath;
    const currentHash = joinConfig.externalSource.fileHash;
    const currentDelimiter = joinConfig.delimiter;

    if (
      extInspection &&
      lastInspectedRef.current &&
      lastInspectedRef.current.path === currentPath &&
      lastInspectedRef.current.hash === currentHash &&
      lastInspectedRef.current.delimiter === currentDelimiter
    ) {
      return;
    }

    let active = true;
    async function loadExt() {
      try {
        const result = await invoke<{
          columns: Array<{
            name: string;
            inferredType: string;
            levels: string[];
            isIdentifier: boolean;
          }>;
          rowCount: number;
          fileHash: string;
          sheetName: string | null;
        }>("inspect_external_data", {
          absolutePath: currentPath,
          delimiter: currentDelimiter,
        });
        if (active) {
          setExtInspection(result);
          lastInspectedRef.current = {
            path: currentPath,
            hash: currentHash,
            delimiter: currentDelimiter,
          };
        }
      } catch (err) {
        if (active) {
          setError(
            `Failed to inspect external file: ${err instanceof Error ? err.message : "Unknown error"}`,
          );
        }
      }
    }
    loadExt();
    return () => {
      active = false;
    };
  }, [joinConfig, extInspection]);

  async function handleBrowse() {
    let defaultPath: string | undefined = undefined;
    if (joinConfig?.externalSource?.absolutePath) {
      const lastSlash = Math.max(
        joinConfig.externalSource.absolutePath.lastIndexOf("/"),
        joinConfig.externalSource.absolutePath.lastIndexOf("\\"),
      );
      if (lastSlash !== -1) {
        defaultPath = joinConfig.externalSource.absolutePath.substring(0, lastSlash);
      }
    } else if (project?.projectMeta?.rootPath) {
      defaultPath = project.projectMeta.rootPath;
    }

    const selected = await open({
      filters: [{ name: "Data files", extensions: ["csv", "tsv", "xlsx"] }],
      multiple: false,
      defaultPath,
    });
    if (!selected || typeof selected !== "string") return;
    if (!project) return;
    setError(null);
    try {
      const result = await invoke<{
        columns: Array<{
          name: string;
          inferredType: string;
          levels: string[];
          isIdentifier: boolean;
        }>;
        rowCount: number;
        fileHash: string;
        sheetName: string | null;
      }>("inspect_external_data", {
        absolutePath: selected,
        delimiter: joinConfig?.delimiter ?? "auto",
      });
      setExtInspection(result);
      lastInspectedRef.current = {
        path: selected,
        hash: result.fileHash,
        delimiter: joinConfig?.delimiter ?? "auto",
      };
      // Reset keys to empty array when changing external data
      const existing = joinConfig;
      const newKeys: Array<{ left: string; right: string }> = [];
      setJoinConfig({
        externalSource: {
          absolutePath: selected,
          fileHash: result.fileHash,
          sheetName: result.sheetName,
        },
        keys: newKeys,
        dropRightOn: existing?.dropRightOn ?? true,
        naTokens: existing?.naTokens ?? DEFAULT_NA_TOKENS,
        delimiter: existing?.delimiter ?? "auto",
      });
    } catch (err) {
      setError(
        `Failed to inspect external file: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }

  function handleRemoveExternal() {
    setJoinConfig(null);
    setExtInspection(null);
    lastInspectedRef.current = null;
  }

  function handleAddKeyPair() {
    if (!joinConfig) return;
    setJoinConfig({
      ...joinConfig,
      keys: [...joinConfig.keys, { left: "", right: "" }],
    });
  }

  function handleKeyPairChange(index: number, side: "left" | "right", value: string | null) {
    if (!joinConfig) return;
    const newKeys = joinConfig.keys.map((key, i) => {
      if (i !== index) return key;
      return { ...key, [side]: value ?? "" };
    });
    setJoinConfig({ ...joinConfig, keys: newKeys });
  }

  function handleRemoveKeyPair(index: number) {
    if (!joinConfig) return;
    setJoinConfig({
      ...joinConfig,
      keys: joinConfig.keys.filter((_, i) => i !== index),
    });
  }

  function handleNaTokensChange(tokens: string[]) {
    if (!joinConfig) return;
    setJoinConfig({ ...joinConfig, naTokens: tokens });
  }

  function handleDropRightOnChange(checked: boolean) {
    if (!joinConfig) return;
    setJoinConfig({ ...joinConfig, dropRightOn: checked });
  }

  async function handleDelimiterChange(value: string | null) {
    if (!joinConfig || !project) return;
    const newDelimiter = value ?? "auto";
    setJoinConfig({ ...joinConfig, delimiter: newDelimiter });
    try {
      const result = await invoke<{
        columns: Array<{
          name: string;
          inferredType: string;
          levels: string[];
          isIdentifier: boolean;
        }>;
        rowCount: number;
        fileHash: string;
        sheetName: string | null;
      }>("inspect_external_data", {
        absolutePath: joinConfig.externalSource.absolutePath,
        delimiter: newDelimiter,
      });
      setExtInspection(result);
      lastInspectedRef.current = {
        path: joinConfig.externalSource.absolutePath,
        hash: result.fileHash,
        delimiter: newDelimiter,
      };
    } catch (err) {
      setError(
        `Failed to inspect external file: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }

  if (!joinConfig) {
    return (
      <Stack data-testid="join-config">
        <Paper p="md" withBorder>
          <Stack gap="sm">
            <Text fw={500}>External Data (optional)</Text>
            <Text c="dimmed" size="sm">
              Left-join covariates (Diagnosis, Age, etc.) onto your qCBF data.
            </Text>
            <Button
              leftSection={<IconUpload size={16} />}
              variant="default"
              onClick={handleBrowse}
              data-testid="browse-external-btn"
            >
              Browse...
            </Button>
            {error && <Alert color="red">{error}</Alert>}
          </Stack>
        </Paper>
      </Stack>
    );
  }

  const extColumns = extInspection?.columns?.map((c) => ({ value: c.name, label: c.name })) ?? [];
  const leftColumns = IDENTIFIER_COLUMNS.filter((col) =>
    inspection?.columns.some((c) => c.originalName === col),
  ).map((c) => ({ value: c, label: c }));

  const keyPairs = joinConfig.keys;

  return (
    <Stack data-testid="join-config-active">
      {error && (
        <Alert color="red" data-testid="join-config-error">
          {error}
        </Alert>
      )}
      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={500}>External Data</Text>
            <Button
              variant="subtle"
              size="xs"
              onClick={handleRemoveExternal}
              data-testid="remove-external-btn"
            >
              Remove
            </Button>
          </Group>
          <Text c="dimmed" size="sm" ff="monospace">
            {joinConfig.externalSource.absolutePath}
          </Text>
          <Button
            leftSection={<IconUpload size={16} />}
            variant="default"
            size="xs"
            onClick={handleBrowse}
            data-testid="change-external-btn"
          >
            Change file...
          </Button>
        </Stack>
      </Paper>

      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Text fw={500}>Join Keys</Text>
          {keyPairs.map((pair, i) => (
            <Group key={i} gap="xs" data-testid={`key-pair-${i}`}>
              <Select
                placeholder="column from qCBF data"
                data={leftColumns}
                value={pair.left || null}
                onChange={(val) => handleKeyPairChange(i, "left", val)}
                data-testid={`key-pair-${i}-left`}
              />
              <Text>↔</Text>
              <Select
                placeholder="column from external data"
                data={extColumns}
                value={pair.right || null}
                onChange={(val) => handleKeyPairChange(i, "right", val)}
                data-testid={`key-pair-${i}-right`}
              />
              <Button
                variant="subtle"
                size="xs"
                onClick={() => handleRemoveKeyPair(i)}
                data-testid={`key-pair-${i}-remove`}
              >
                Remove
              </Button>
            </Group>
          ))}
          <Button
            variant="default"
            size="xs"
            onClick={handleAddKeyPair}
            data-testid="add-key-pair-btn"
          >
            Add key pair
          </Button>
        </Stack>
      </Paper>

      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Text fw={500}>Options</Text>
          <Checkbox
            label="Drop join-key columns from external data (recommended)"
            checked={joinConfig.dropRightOn}
            onChange={(e) => handleDropRightOnChange(e.currentTarget.checked)}
            data-testid="drop-right-on-toggle"
          />
          <Text fw={500} size="sm">
            CSV Delimiter
          </Text>
          <Select
            data={[
              { value: "auto", label: "Auto-detect" },
              { value: ",", label: "Comma (,)" },
              { value: ";", label: "Semicolon (;)" },
              { value: "\t", label: "Tab (\\t)" },
            ]}
            value={joinConfig.delimiter}
            onChange={handleDelimiterChange}
            data-testid="delimiter-select"
          />
          <Text fw={500} size="sm">
            Missing values
          </Text>
          <TagsInput
            label="NA tokens"
            description="Values treated as missing in the external file"
            value={joinConfig.naTokens}
            onChange={handleNaTokensChange}
            data-testid="na-tokens-input"
          />
          {joinConfig.naTokens.length === 0 && (
            <Alert color="yellow" data-testid="no-na-tokens-warning">
              No NA tokens specified — all values treated as present.
            </Alert>
          )}
        </Stack>
      </Paper>

      {keyPairs.some((p) => p.left && p.right) && inspection && extInspection?.columns && (
        <>
          <JoinDiagram
            qcbfFileName={qcbfSource?.relativePath ?? ""}
            qcbfRowCount={inspection.qcbfRowCount ?? inspection.rowCount}
            qcbfColumns={inspection.columns
              .filter((c) => c.source === "qcbf")
              .map((c) => ({ name: c.originalName, isIdentifier: c.isIdentifier }))}
            extFilePath={joinConfig.externalSource.absolutePath}
            extRowCount={extInspection.rowCount ?? 0}
            extColumns={extInspection.columns}
            keyPairs={
              keyPairs.filter((p) => p.left && p.right) as { left: string; right: string }[]
            }
          />
          <SanityChecks
            qcbfRelativePath={qcbfSource?.relativePath ?? ""}
            externalAbsolutePath={joinConfig.externalSource.absolutePath}
            keys={keyPairs.filter((p) => p.left && p.right) as { left: string; right: string }[]}
            naTokens={joinConfig.naTokens}
            sheetName={joinConfig.externalSource.sheetName}
            delimiter={joinConfig.delimiter}
            qcbfRowCount={inspection.qcbfRowCount ?? inspection.rowCount}
          />
        </>
      )}
    </Stack>
  );
}
