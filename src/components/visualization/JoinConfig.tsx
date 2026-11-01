import { comboboxTestIds } from "../common/comboboxTestIds";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Pill,
  Select,
  Stack,
  TagsInput,
  Text,
} from "@mantine/core";
import { IconAlertTriangle, IconUpload } from "@tabler/icons-react";
import { commands, unwrap } from "../../lib/ipc";
import type { ExternalDataInspection_Serialize as ExternalInspection } from "../../generated/bindings";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

import { useProjectStore } from "../../stores/projectStore";
import { useVisualizationStore } from "../../stores/visualizationStore";
import { visualizationSettings } from "../../stores/visualizationStore";
import JoinDiagram from "./JoinDiagram";
import SanityChecks from "./SanityChecks";
import PathEntryButton from "../common/PathEntryButton";
import { captureProjectLease, isCurrentProjectLease } from "../../lib/projectLifecycle";

const DEFAULT_NA_TOKENS = ["", "NaN", "NA", "n/a", "<NA>"];
const IDENTIFIER_COLUMNS = ["participant_id", "subject", "session", "run"];

export default function JoinConfig() {
  const joinConfig = useProjectStore((s) => visualizationSettings(s.project).joinConfig);
  const setJoinConfig = useVisualizationStore((s) => s.setJoinConfig);
  const qcbfSource = useProjectStore((s) => visualizationSettings(s.project).qcbfSource);
  const inspection = useVisualizationStore((s) => s.inspection);
  const project = useProjectStore((s) => s.project);
  const externalSourceAvailability = useVisualizationStore((s) => s.externalSourceAvailability);
  const setExternalSourceAvailability = useVisualizationStore(
    (s) => s.setExternalSourceAvailability,
  );
  const relinkMatchingExternalSource = useVisualizationStore((s) => s.relinkMatchingExternalSource);
  const relinkChangedExternalSource = useVisualizationStore((s) => s.relinkChangedExternalSource);
  const [extInspection, setExtInspection] = useState<ExternalInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRelink, setPendingRelink] = useState<{
    absolutePath: string;
    inspection: ExternalInspection;
  } | null>(null);

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
    const lease = captureProjectLease();
    async function loadExt() {
      try {
        console.log(
          "[JoinConfig] Inspecting external file:",
          currentPath,
          "with delimiter:",
          currentDelimiter,
        );
        const result = await unwrap(
          commands.inspectExternalData(currentPath, null, currentDelimiter),
        );
        if (active && (!lease || isCurrentProjectLease(lease))) {
          console.log("[JoinConfig] External file inspection success:", result);
          setExtInspection(result);
          setExternalSourceAvailability(
            result.fileHash === currentHash
              ? { status: "available", savedPath: currentPath, message: null }
              : {
                  status: "changed",
                  savedPath: currentPath,
                  message:
                    "External data content changed. Relink and confirm before resetting dependent visualization setup.",
                },
          );
          lastInspectedRef.current = {
            path: currentPath,
            hash: currentHash,
            delimiter: currentDelimiter,
          };
        }
      } catch (err) {
        if (active && (!lease || isCurrentProjectLease(lease))) {
          console.error("[JoinConfig] Failed to inspect external file:", err);
          setError(
            `Failed to inspect external file: ${err instanceof Error ? err.message : "Unknown error"}`,
          );
          setExternalSourceAvailability({
            status: "unreadable",
            savedPath: currentPath,
            message:
              "The saved external visualization file is missing or unreadable. Relink it to restore joined data.",
          });
        }
      }
    }
    loadExt();
    return () => {
      active = false;
    };
  }, [joinConfig, extInspection, setExternalSourceAvailability]);

  async function handleBrowse(selectedPath?: string) {
    const lease = captureProjectLease();
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

    console.log("[JoinConfig] Browsing for external file...");
    const selected =
      selectedPath ??
      (await open({
        filters: [{ name: "Data files", extensions: ["csv", "tsv", "xlsx"] }],
        multiple: false,
        defaultPath,
      }));
    if (lease && !isCurrentProjectLease(lease)) return;
    if (!selected || typeof selected !== "string") {
      console.log("[JoinConfig] File browse cancelled");
      return;
    }
    console.log("[JoinConfig] Selected file path:", selected);
    if (!project) return;
    setError(null);
    try {
      console.log("[JoinConfig] Inspecting selected file:", selected);
      const result = await unwrap(
        commands.inspectExternalData(selected, null, joinConfig?.delimiter ?? "auto"),
      );
      if (lease && !isCurrentProjectLease(lease)) return;
      console.log("[JoinConfig] Selected file inspection success:", result);
      setExtInspection(result);
      lastInspectedRef.current = {
        path: selected,
        hash: result.fileHash,
        delimiter: joinConfig?.delimiter ?? "auto",
      };
      const existing = joinConfig;
      if (existing) {
        if (result.fileHash === existing.externalSource.fileHash) {
          relinkMatchingExternalSource({
            absolutePath: selected,
            fileHash: result.fileHash,
            sheetName: result.sheetName,
          });
        } else {
          setPendingRelink({ absolutePath: selected, inspection: result });
        }
        return;
      }
      const newKeys: Array<{ left: string; right: string }> = [];
      setJoinConfig({
        externalSource: {
          absolutePath: selected,
          fileHash: result.fileHash,
          sheetName: result.sheetName,
        },
        keys: newKeys,
        dropRightOn: true,
        naTokens: DEFAULT_NA_TOKENS,
        delimiter: "auto",
      });
    } catch (err) {
      if (lease && !isCurrentProjectLease(lease)) return;
      console.error("[JoinConfig] Failed to inspect selected file:", err);
      setError(
        `Failed to inspect external file: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }

  function handleRemoveExternal() {
    console.log("[JoinConfig] Removing external dataset join configuration");
    setJoinConfig(null);
    setExternalSourceAvailability({ status: "unconfigured", savedPath: null, message: null });
    setExtInspection(null);
    lastInspectedRef.current = null;
  }

  function handleAddKeyPair() {
    if (!joinConfig) return;
    setJoinConfig(
      (current) =>
        current && {
          ...current,
          keys: [...current.keys, { left: "", right: "" }],
        },
    );
  }

  function handleKeyPairChange(index: number, side: "left" | "right", value: string | null) {
    if (!joinConfig) return;
    setJoinConfig(
      (current) =>
        current && {
          ...current,
          keys: current.keys.map((key, i) => (i === index ? { ...key, [side]: value ?? "" } : key)),
        },
    );
  }

  function handleRemoveKeyPair(index: number) {
    if (!joinConfig) return;
    setJoinConfig(
      (current) =>
        current && {
          ...current,
          keys: current.keys.filter((_, i) => i !== index),
        },
    );
  }

  function handleNaTokensChange(tokens: string[]) {
    if (!joinConfig) return;
    setJoinConfig((current) => current && { ...current, naTokens: tokens });
  }

  function handleDropRightOnChange(checked: boolean) {
    if (!joinConfig) return;
    setJoinConfig((current) => current && { ...current, dropRightOn: checked });
  }

  async function handleDelimiterChange(value: string | null) {
    if (!joinConfig || !project) return;
    const lease = captureProjectLease();
    const newDelimiter = value ?? "auto";
    setJoinConfig((current) => current && { ...current, delimiter: newDelimiter });
    try {
      const result = await unwrap(
        commands.inspectExternalData(joinConfig.externalSource.absolutePath, null, newDelimiter),
      );
      if (lease && !isCurrentProjectLease(lease)) return;
      setExtInspection(result);
      lastInspectedRef.current = {
        path: joinConfig.externalSource.absolutePath,
        hash: result.fileHash,
        delimiter: newDelimiter,
      };
    } catch (err) {
      if (lease && !isCurrentProjectLease(lease)) return;
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
              onClick={() => void handleBrowse()}
              data-testid="browse-external-btn"
            >
              Browse...
            </Button>
            <PathEntryButton
              title="Select external data file"
              testId="external-data-path"
              extensions={["csv", "tsv", "xlsx"]}
              onSelect={handleBrowse}
            />
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
      {["missing", "unreadable", "changed"].includes(externalSourceAvailability.status) && (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={16} />}
          data-testid="external-source-warning"
        >
          <Stack gap="xs">
            <Text size="sm">{externalSourceAvailability.message}</Text>
            <Text size="sm" ff="monospace" data-testid="external-source-path">
              {externalSourceAvailability.savedPath}
            </Text>
            <Button
              variant="light"
              size="xs"
              onClick={() => void handleBrowse()}
              data-testid="external-source-relink-btn"
            >
              Relink
            </Button>
          </Stack>
        </Alert>
      )}
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
            onClick={() => void handleBrowse()}
            data-testid="change-external-btn"
          >
            Change file...
          </Button>
          <PathEntryButton
            title="Select external data file"
            testId="external-data-path"
            defaultPath={joinConfig.externalSource.absolutePath}
            extensions={["csv", "tsv", "xlsx"]}
            onSelect={handleBrowse}
          />
        </Stack>
      </Paper>

      <Modal
        opened={pendingRelink !== null}
        onClose={() => setPendingRelink(null)}
        title="External data content changed"
        data-testid="external-relink-mismatch-dialog"
        attributes={{ close: { "data-testid": "external-relink-mismatch-dialog-close" } }}
      >
        <Stack>
          <Text size="sm">
            Replacement content does not match the saved SHA-256 hash. Continuing resets join keys,
            column types, level ordering, axes, filters, and loaded chart data.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setPendingRelink(null)}
              data-testid="external-relink-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              color="orange"
              onClick={() => {
                if (pendingRelink) {
                  relinkChangedExternalSource({
                    absolutePath: pendingRelink.absolutePath,
                    fileHash: pendingRelink.inspection.fileHash,
                    sheetName: pendingRelink.inspection.sheetName,
                  });
                  setExtInspection(pendingRelink.inspection);
                }
                setPendingRelink(null);
              }}
              data-testid="external-relink-confirm-btn"
            >
              Relink and reset setup
            </Button>
          </Group>
        </Stack>
      </Modal>

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
                {...comboboxTestIds(`key-pair-${i}-left`)}
              />
              <Text>↔</Text>
              <Select
                placeholder="column from external data"
                data={extColumns}
                value={pair.right || null}
                onChange={(val) => handleKeyPairChange(i, "right", val)}
                {...comboboxTestIds(`key-pair-${i}-right`)}
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
            {...comboboxTestIds("delimiter-select")}
          />
          <Text fw={500} size="sm">
            Missing values
          </Text>
          <TagsInput
            label="NA tokens"
            description="Values treated as missing in the external file"
            value={joinConfig.naTokens}
            onChange={handleNaTokensChange}
            {...comboboxTestIds("na-tokens-input")}
            renderPill={({ option, onRemove, disabled }) => (
              <Pill
                withRemoveButton
                onRemove={onRemove}
                disabled={disabled}
                attributes={{ remove: { "data-testid": `na-tokens-input-remove-${option.value}` } }}
              >
                {option.label}
              </Pill>
            )}
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
