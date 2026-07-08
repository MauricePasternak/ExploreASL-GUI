import { Alert, Badge, Button, Card, Code, Group, Stack, Switch, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowRight,
  IconCheck,
  IconDatabase,
  IconFolderSearch,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { logAction } from "../../lib/debug";
import { discoverPathPatterns } from "../../lib/pathUtils";
import { useGlobalStore } from "../../stores/globalStore";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import HeaderCard from "../common/HeaderCard";
import HelpTooltip from "../common/HelpTooltip";

/**
 * Step 1: DICOM Ingestion.
 *
 * User selects a sourcedata directory, toggles match mode,
 * and scans for DICOM files. Results show unique path patterns.
 */
export default function DicomIngestion() {
  const project = useProjectStore((state) => state.project);
  const tokenSubDelimiters = useGlobalStore((s) => s.settings.tokenSubDelimiters);
  const sourceDataPath = useImportStore((s) => s.sourceDataPath);
  const setSourceDataPath = useImportStore((s) => s.setSourceDataPath);
  const bMatchDirectories = useImportStore((s) => s.bMatchDirectories);
  const setBMatchDirectories = useImportStore((s) => s.setBMatchDirectories);
  const pathPatterns = useImportStore((s) => s.pathPatterns);
  const ingestionComplete = useImportStore((s) => s.ingestionComplete);
  const setIngestionResults = useImportStore((s) => s.setIngestionResults);
  const setActiveStep = useImportStore((s) => s.setActiveStep);

  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelectFolder() {
    logAction("dicom_select_folder");
    const selected = await open({
      defaultPath: project?.projectMeta.rootPath,
      directory: true,
      multiple: false,
      title: "Select DICOM source directory",
    });

    if (selected) {
      setSourceDataPath(selected as string);
      setError(null);
      logAction("dicom_folder_selected", { path: selected as string });
    }
  }

  async function handleScan() {
    if (!sourceDataPath) return;

    setScanning(true);
    setError(null);
    logAction("dicom_scan_start", { path: sourceDataPath, bMatchDirectories });

    try {
      const paths = await invoke<string[]>("walk_directory", {
        root: sourceDataPath,
        maxDepth: 20,
        bMatchDirectories,
      });

      if (paths.length === 0) {
        setError(
          "No DICOM (.dcm) files found in the provided directory tree. Check that the folders contain valid DICOM data.",
        );
        setIngestionResults([], []);
        logAction("dicom_scan_empty", { path: sourceDataPath });
        return;
      }

      // Convert to full paths for pattern discovery
      const fullPaths = paths.map((p) => `${sourceDataPath}/${p}`);
      const patterns = discoverPathPatterns(fullPaths, sourceDataPath, tokenSubDelimiters);

      setIngestionResults(fullPaths, patterns);
      logAction("dicom_scan_success", {
        path: sourceDataPath,
        pathCount: paths.length,
        patternCount: patterns.length,
      });
    } catch (err) {
      setError(`Failed to scan directory: ${err instanceof Error ? err.message : String(err)}`);
      setIngestionResults([], []);
      logAction("dicom_scan_error", { path: sourceDataPath, error: String(err) });
    } finally {
      setScanning(false);
    }
  }

  function handleNext() {
    logAction("dicom_next_step");
    setActiveStep(1);
  }

  const totalPaths = pathPatterns.reduce((sum, p) => sum + p.count, 0);

  return (
    <Stack gap="md" data-testid="dicom-ingestion">
      <HeaderCard
        icon={IconDatabase}
        title="DICOM Ingestion"
        subtitle="Choose the folder that contains this study's scan files, then scan it so the app can learn how the folders are organized."
        color="blue"
        dataTestId="dicom-ingestion-header"
      />

      {/* Folder selection */}
      <Card withBorder p="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
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
                <Code>{sourceDataPath}</Code>
              ) : (
                <Text c="dimmed" size="sm">
                  No folder selected yet
                </Text>
              )}
            </div>
            <Button
              leftSection={<IconFolderSearch size={16} />}
              variant="light"
              onClick={handleSelectFolder}
              data-testid="dicom-browse-btn"
            >
              Browse
            </Button>
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

          <Button
            leftSection={<IconFolderSearch size={16} />}
            disabled={!sourceDataPath}
            loading={scanning}
            onClick={handleScan}
            data-testid="scan-dicoms-btn"
          >
            Scan for DICOMs
          </Button>
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

      {/* Results */}
      {ingestionComplete && (
        <Card withBorder p="md">
          <Stack gap="sm">
            <Group>
              <IconCheck size={20} color="var(--mantine-color-green-6)" />
              <Text fw={500}>
                Found {totalPaths} DICOM location{totalPaths !== 1 ? "s" : ""} across{" "}
                {pathPatterns.length} unique path pattern
                {pathPatterns.length !== 1 ? "s" : ""}
              </Text>
            </Group>

            {pathPatterns.map((pattern) => (
              <Card
                key={pattern.signature}
                withBorder
                p="sm"
                data-testid={`pattern-result-card-${pattern.signature}`}
              >
                <Group gap="xs" mb="xs">
                  <Badge variant="light" size="sm">
                    {pattern.count} path{pattern.count !== 1 ? "s" : ""}
                  </Badge>
                  <Badge variant="outline" size="sm">
                    depth {pattern.depth}
                  </Badge>
                </Group>
                <Text size="sm" fw={500} mb={4}>
                  Pattern: {pattern.signature}
                </Text>
                <Text size="xs" c="dimmed" mb={4}>
                  Example for this pattern:
                </Text>
                <Code block>{pattern.samplePath}</Code>
              </Card>
            ))}
          </Stack>
        </Card>
      )}

      <Group
        justify="flex-end"
        pos="sticky"
        bottom={40}
        style={{
          zIndex: 2,
          paddingTop: "var(--mantine-spacing-md)",
          paddingBottom: "var(--mantine-spacing-md)",
          backgroundColor: "var(--mantine-color-body)",
          boxShadow: "0 -4px 6px -1px rgba(0, 0, 0, 0.06)",
        }}
        data-testid="dicom-nav"
      >
        <Button
          rightSection={<IconArrowRight size={16} />}
          onClick={handleNext}
          disabled={!ingestionComplete}
          data-testid="dicom-next-btn"
        >
          Next: Tokenize Paths
        </Button>
      </Group>
    </Stack>
  );
}
