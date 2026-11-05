import { Alert, Badge, Button, Card, Code, Group, Modal, Stack, Switch, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowRight,
  IconCheck,
  IconDatabase,
  IconFolderSearch,
} from "@tabler/icons-react";
import { commands, unwrap } from "../../lib/ipc";
import { open } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { extractUniqueValues } from "../../lib/tokenizerUtils";
import { isTokenizerComplete } from "../../lib/importStepAccess";

import { logAction } from "../../lib/debug";
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
  type ProjectLease,
} from "../../lib/projectLifecycle";
import { discoverPathPatterns } from "../../lib/pathUtils";
import { inspectSourcePath, resolveLogicalSource } from "../../lib/projectPaths";
import { areDicomStructuresCompatible } from "../../lib/dicomRelink";
import type { PathPattern } from "../../schemas/importSchemas";
import { useGlobalStore } from "../../stores/globalStore";
import {
  acceptedImportSettings,
  EMPTY_IMPORT_SETTINGS,
  useImportStore,
} from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import HeaderCard from "../common/HeaderCard";
import HelpTooltip from "../common/HelpTooltip";
import PathEntryButton from "../common/PathEntryButton";
import ImportStepLayout from "./ImportStepLayout";

/**
 * Step 1: DICOM Ingestion.
 *
 * User selects a sourcedata directory, toggles match mode,
 * and scans for DICOM files. Results show unique path patterns.
 */
export default function DicomIngestion() {
  const project = useProjectStore((state) => state.project);
  const tokenSubDelimiters = useGlobalStore((s) => s.settings.tokenSubDelimiters);
  const sourceDataPath = useProjectStore((s) => s.project?.mappingState.sourceDataPath ?? "");
  const setSourceDataPath = useImportStore((s) => s.setSourceDataPath);
  const bMatchDirectories = useProjectStore(
    (s) => s.project?.mappingState.bMatchDirectories ?? true,
  );
  const setBMatchDirectories = useImportStore((s) => s.setBMatchDirectories);
  const pathPatterns = useProjectStore(
    (s) => s.project?.mappingState.pathPatterns ?? EMPTY_IMPORT_SETTINGS.pathPatterns,
  );
  const ingestionComplete = useProjectStore(
    (s) => s.project?.mappingState.ingestionComplete ?? false,
  );
  const setIngestionResults = useImportStore((s) => s.setIngestionResults);
  const setActiveStep = useImportStore((s) => s.setActiveStep);
  const sourceAvailability = useImportStore((s) => s.sourceAvailability);
  const relinkCompatibleSource = useImportStore((s) => s.relinkCompatibleSource);
  const relinkIncompatibleSource = useImportStore((s) => s.relinkIncompatibleSource);
  const rawPaths = project?.mappingState.rawPaths ?? EMPTY_IMPORT_SETTINGS.rawPaths;
  const tokenizerConfigs =
    project?.mappingState.tokenizerConfigs ?? EMPTY_IMPORT_SETTINGS.tokenizerConfigs;
  const capturedCounts = useMemo(() => {
    if (!isTokenizerComplete({ ingestionComplete, pathPatterns, tokenizerConfigs })) return null;
    const subjects = new Set<string>();
    const visits = new Set<string>();
    const entries = new Set<string>();
    for (const pattern of pathPatterns) {
      const assignments = tokenizerConfigs[pattern.signature] ?? [];
      for (const path of rawPaths) {
        const capturedSubjects = extractUniqueValues(
          [path],
          sourceDataPath,
          assignments,
          "Subject",
          pattern,
          tokenSubDelimiters,
        );
        const capturedVisits = extractUniqueValues(
          [path],
          sourceDataPath,
          assignments,
          "Session",
          pattern,
          tokenSubDelimiters,
        );
        capturedSubjects.forEach((subject) => {
          subjects.add(subject);
          (capturedVisits.length ? capturedVisits : ["01"]).forEach((visit) =>
            entries.add(JSON.stringify([subject, visit])),
          );
        });
        capturedVisits.forEach((visit) => visits.add(visit));
      }
    }
    return { subjects: subjects.size, visits: visits.size, entries: entries.size };
  }, [
    ingestionComplete,
    pathPatterns,
    tokenizerConfigs,
    rawPaths,
    sourceDataPath,
    tokenSubDelimiters,
  ]);

  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRelink, setPendingRelink] = useState<{
    lease: ProjectLease;
    path: string;
    rawPaths: string[];
    patterns: PathPattern[];
  } | null>(null);
  const sourceUnavailable = ["missing", "unreadable", "ambiguous"].includes(
    sourceAvailability.status,
  );

  async function logicalSelectedPath(selectedPath: string) {
    const inspection = await inspectSourcePath(project?.projectMeta.rootPath ?? "", selectedPath);
    if (!inspection.exists || !inspection.readable || !inspection.isDirectory) {
      throw new Error("Selected source directory is unavailable or unreadable.");
    }
    return inspection.ownership === "internal"
      ? (inspection.projectRelativePath ?? selectedPath)
      : inspection.absolutePath;
  }

  async function handleSelectFolder(selectedPath?: string) {
    const lease = captureProjectLease();
    if (!lease || !isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
    logAction("dicom_select_folder");
    const selected =
      selectedPath ??
      (await open({
        defaultPath: project?.projectMeta.rootPath,
        directory: true,
        multiple: false,
        title: "Select DICOM source directory",
      }));
    if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
    if (selected) {
      try {
        const path = selected as string;
        const logicalPath = await logicalSelectedPath(path);
        if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
        await setSourceDataPath(path, lease);
        if (!isCurrentProjectLease(lease)) return;
        setError(null);
        logAction("dicom_folder_selected", { path: logicalPath });
      } catch (err) {
        if (!isCurrentProjectLease(lease)) return;
        setError(
          `Failed to inspect source directory: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async function handleRelink(selectedPath?: string) {
    const lease = captureProjectLease();
    if (!lease || !isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
    const selected =
      selectedPath ??
      (await open({
        defaultPath: project?.projectMeta.rootPath,
        directory: true,
        multiple: false,
        title: "Relink DICOM source directory",
      }));
    if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted() || typeof selected !== "string")
      return;

    setScanning(true);
    setError(null);
    try {
      const logicalPath = await logicalSelectedPath(selected);
      if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
      const resolvedSource = resolveLogicalSource(
        project?.projectMeta.rootPath ?? "",
        logicalPath,
        "dicom",
      );
      const paths = await unwrap(commands.walkDirectory(resolvedSource, 20, bMatchDirectories));
      if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
      if (paths.length === 0) throw new Error("Replacement contains no DICOM locations.");
      const patterns = discoverPathPatterns(paths, "", tokenSubDelimiters);
      if (
        areDicomStructuresCompatible(
          acceptedImportSettings().rawPaths,
          pathPatterns,
          paths,
          patterns,
        )
      ) {
        await relinkCompatibleSource(selected, lease);
      } else {
        setPendingRelink({ lease, path: selected, rawPaths: paths, patterns });
      }
    } catch (err) {
      if (!isCurrentProjectLease(lease)) return;
      setError(`Failed to relink source: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (isCurrentProjectLease(lease)) setScanning(false);
    }
  }

  async function handleScan() {
    const lease = captureProjectLease();
    if (!sourceDataPath || !lease || !isCurrentProjectLease(lease) || !isProjectWorkAccepted())
      return;

    setScanning(true);
    setError(null);
    logAction("dicom_scan_start", { path: sourceDataPath, bMatchDirectories });

    try {
      const resolvedSource = resolveLogicalSource(
        project?.projectMeta.rootPath ?? "",
        sourceDataPath,
        "dicom",
      );
      const paths = await unwrap(commands.walkDirectory(resolvedSource, 20, bMatchDirectories));
      if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
      const patterns = discoverPathPatterns(paths, "", tokenSubDelimiters);
      await setIngestionResults(paths, patterns, lease);
      if (!isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
      if (paths.length === 0) {
        setError(
          "No DICOM (.dcm) files found in the provided directory tree. Check that the folders contain valid DICOM data.",
        );
        logAction("dicom_scan_empty", { path: sourceDataPath });
        return;
      }

      logAction("dicom_scan_success", {
        path: sourceDataPath,
        pathCount: paths.length,
        patternCount: patterns.length,
      });
    } catch (err) {
      if (!isCurrentProjectLease(lease)) return;
      setError(`Failed to scan directory: ${err instanceof Error ? err.message : String(err)}`);
      logAction("dicom_scan_error", { path: sourceDataPath, error: String(err) });
    } finally {
      if (isCurrentProjectLease(lease)) setScanning(false);
    }
  }

  function handleNext() {
    logAction("dicom_next_step");
    setActiveStep(1);
  }

  const totalPaths = pathPatterns.reduce((sum, p) => sum + p.count, 0);

  return (
    <ImportStepLayout
      testId="dicom-ingestion"
      navigation={
        <Group justify="flex-end" data-testid="dicom-nav">
          <Button
            rightSection={<IconArrowRight size={16} />}
            onClick={handleNext}
            disabled={!ingestionComplete}
            data-testid="dicom-next-btn"
          >
            Next: Tokenize Paths
          </Button>
        </Group>
      }
    >
      <HeaderCard
        icon={IconDatabase}
        title="DICOM Ingestion"
        subtitle="Choose the folder that contains this study's scan files, then scan it so the app can learn how the folders are organized."
        color="blue"
        dataTestId="dicom-ingestion-header"
      />

      {sourceUnavailable && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="DICOM source unavailable"
          color="yellow"
          data-testid="dicom-missing-source-warning"
        >
          <Stack gap="xs">
            <Text size="sm">{sourceAvailability.message}</Text>
            <Code data-testid="dicom-missing-source-path">{sourceAvailability.savedPath}</Code>
            <Button
              variant="light"
              onClick={() => void handleRelink()}
              loading={scanning}
              data-testid="dicom-relink-btn"
            >
              Relink
            </Button>
            <PathEntryButton
              title="Relink DICOM source directory"
              testId="dicom-relink-path"
              defaultPath={project?.projectMeta.rootPath}
              disabled={scanning}
              onSelect={handleRelink}
            />
          </Stack>
        </Alert>
      )}

      {/* Folder selection */}
      <Card withBorder p="md" data-testid="dicom-source-card">
        <Stack gap="sm">
          <Group justify="space-between">
            <div style={{ minWidth: 0, flex: "1 1 240px" }}>
              <Group gap="xs">
                <Text fw={500} size="sm">
                  Folder containing your scan files
                </Text>
                <HelpTooltip
                  label="What folder should I choose?"
                  tooltip="Choose the main folder that contains this project's DICOM scan files. The app will scan this folder and everything inside it to identify the folder structure."
                />
              </Group>
              {sourceDataPath ? (
                <Code block className="dicom-import-literal" data-testid="dicom-source-value">
                  {sourceDataPath}
                </Code>
              ) : (
                <Text c="dimmed" size="sm">
                  No folder selected yet
                </Text>
              )}
            </div>
            <Group gap="xs">
              <Button
                leftSection={<IconFolderSearch size={16} />}
                variant="light"
                onClick={() => void handleSelectFolder()}
                disabled={sourceUnavailable}
                data-testid="dicom-browse-btn"
              >
                Browse
              </Button>
              <PathEntryButton
                title="Select DICOM source directory"
                testId="dicom-source-path"
                defaultPath={project?.projectMeta.rootPath}
                disabled={sourceUnavailable || scanning}
                onSelect={handleSelectFolder}
              />
            </Group>
          </Group>

          <div>
            <Group gap="xs" mb={4}>
              <Text fw={500} size="sm">
                How are your DICOM files organised?
              </Text>
              <HelpTooltip
                label="What does this mean?"
                tooltip="ON = each scan series lives in its own subfolder (the typical layout from scanner exports or PACS downloads). The scanner groups one folder per series. OFF = all DICOM files sit together in one or a few flat directories, with no per-series subfolders. When ON, the scanner returns unique folder paths; when OFF, it returns individual file paths."
              />
            </Group>
            <Switch
              label="Group by subfolder (one folder per scan series)"
              description="Each DICOM series is stored in its own subfolder. Disable if all DICOMs are in a single flat directory."
              checked={bMatchDirectories}
              onChange={(e) => setBMatchDirectories(e.currentTarget.checked)}
              data-testid="dicom-match-directories"
            />
          </div>

          <Group data-testid="dicom-scan-actions">
            <Button
              leftSection={<IconFolderSearch size={16} />}
              disabled={!sourceDataPath || sourceUnavailable}
              loading={scanning}
              onClick={handleScan}
              data-testid="scan-dicoms-btn"
            >
              Scan for DICOMs
            </Button>
          </Group>
        </Stack>
      </Card>

      {/* Error */}
      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Scan Error"
          color="red"
          variant="light"
          data-testid="dicom-scan-error"
        >
          {error}
        </Alert>
      )}

      <Modal
        opened={pendingRelink !== null}
        onClose={() => setPendingRelink(null)}
        title="DICOM folder structure changed"
        data-testid="dicom-relink-mismatch-dialog"
        attributes={{ close: { "data-testid": "dicom-relink-mismatch-dialog-close" } }}
      >
        <Stack>
          <Text size="sm">
            Replacement structure differs from saved DICOM inventory. Continuing resets tokenizer,
            alias, metadata, and prior import snapshot setup.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setPendingRelink(null)}
              data-testid="dicom-relink-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              color="orange"
              onClick={async () => {
                if (pendingRelink) {
                  if (!isCurrentProjectLease(pendingRelink.lease) || !isProjectWorkAccepted())
                    return;
                  try {
                    await relinkIncompatibleSource(
                      pendingRelink.path,
                      pendingRelink.rawPaths,
                      pendingRelink.patterns,
                      pendingRelink.lease,
                    );
                  } catch (err) {
                    if (!isCurrentProjectLease(pendingRelink.lease)) return;
                    setError(
                      `Failed to relink source: ${err instanceof Error ? err.message : String(err)}`,
                    );
                    return;
                  }
                  if (!isCurrentProjectLease(pendingRelink.lease)) return;
                }
                setPendingRelink(null);
              }}
              data-testid="dicom-relink-confirm-btn"
            >
              Relink and reset setup
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Results */}
      {ingestionComplete && (
        <Card withBorder p="md" data-testid="dicom-inventory">
          <Stack gap="sm">
            <Group>
              <IconCheck size={20} color="var(--mantine-color-green-6)" />
              <Text fw={500}>
                Found {totalPaths} DICOM location{totalPaths !== 1 ? "s" : ""} across{" "}
                {pathPatterns.length} unique path pattern
                {pathPatterns.length !== 1 ? "s" : ""}
              </Text>
            </Group>
            <Text size="sm" c="dimmed" data-testid="dicom-captured-counts">
              {capturedCounts
                ? `${capturedCounts.subjects} subjects · ${capturedCounts.visits} captured visit labels · ${capturedCounts.entries} subject/session entries`
                : "Subject, captured visit-label and subject/session counts become available after tokenization."}
            </Text>

            {pathPatterns.map((pattern) => (
              <Card
                key={pattern.signature}
                withBorder
                p="sm"
                data-testid={`pattern-result-card-${pattern.signature}`}
              >
                <Group gap="xs" mb="xs">
                  <Badge variant="light" color="gray" size="sm">
                    {pattern.count} location{pattern.count !== 1 ? "s" : ""}
                  </Badge>
                  <Badge variant="outline" size="sm">
                    depth {pattern.depth}
                  </Badge>
                </Group>
                <Text size="sm" fw={500} mb={4}>
                  Pattern
                </Text>
                <Code block className="dicom-import-literal">
                  {pattern.signature}
                </Code>
                <Text size="xs" c="dimmed" mb={4}>
                  Example for this pattern:
                </Text>
                <Code block className="dicom-import-literal">
                  {pattern.samplePath}
                </Code>
              </Card>
            ))}
          </Stack>
        </Card>
      )}
    </ImportStepLayout>
  );
}
