import { comboboxTestIds } from "../common/comboboxTestIds";
import {
  Alert,
  Box,
  Group,
  Image,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { fetchReportImage, fetchSubjectQC, type QcMeasure } from "../../lib/reportViewer";
import { getQcMeasureLabel } from "../../lib/qcLabels";

interface ReportViewerModalProps {
  opened: boolean;
  onClose: () => void;
  projectRoot: string | undefined;
  subjectSession: string;
  module: "structural" | "asl";
  runs?: string[];
}

interface ImageCardProps {
  title: string;
  opened: boolean;
  projectRoot: string | undefined;
  subjectSession: string;
  module: "structural" | "asl" | "m0";
  run?: string;
  view: "axial" | "coronal";
  errorLabel: string;
  testIdPrefix: string;
}

function ImageCard({
  title,
  opened,
  projectRoot,
  subjectSession,
  module,
  run,
  view,
  errorLabel,
  testIdPrefix,
}: ImageCardProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const loading = Boolean(opened && projectRoot && subjectSession && !url && !error);

  useEffect(() => {
    if (!opened || !projectRoot || !subjectSession) return;

    let active = true;
    let objectUrl: string | null = null;

    const loadImage = async () => {
      try {
        const bytes = await fetchReportImage(projectRoot, subjectSession, module, run, view);
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
        setUrl(objectUrl);
      } catch (err) {
        console.error(err);
        if (active) setError(true);
      }
    };

    void loadImage();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [opened, projectRoot, subjectSession, module, run, view]);

  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-sm)",
        overflow: "hidden",
      }}
      data-testid={`${testIdPrefix}-container`}
    >
      <Text
        size="sm"
        fw={600}
        p="xs"
        bg="var(--mantine-color-default-hover)"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        {title}
      </Text>
      {loading ? (
        <Box
          style={{ display: "flex", justifyContent: "center", padding: 30 }}
          data-testid={`${testIdPrefix}-loading`}
        >
          <Loader size="sm" />
        </Box>
      ) : error ? (
        <Alert
          color="orange"
          m="xs"
          icon={<IconAlertCircle size={16} />}
          data-testid={`${testIdPrefix}-error`}
        >
          {errorLabel}
        </Alert>
      ) : url ? (
        <Image
          src={url}
          alt={title}
          fit="contain"
          style={{ width: "100%", height: "auto", display: "block" }}
          data-testid={`${testIdPrefix}-image`}
          onError={() => setError(true)}
        />
      ) : null}
    </Box>
  );
}

export default function ReportViewerModal({
  opened,
  onClose,
  projectRoot,
  subjectSession,
  module,
  runs = [],
}: ReportViewerModalProps) {
  const [prevRunsJoined, setPrevRunsJoined] = useState<string>("");
  const [prevSubjectSession, setPrevSubjectSession] = useState<string>("");
  const [selectedRun, setSelectedRun] = useState<string>("1");

  const [qcMeasures, setQcMeasures] = useState<QcMeasure[]>([]);
  const [qcLoading, setQcLoading] = useState(false);
  const [qcError, setQcError] = useState<string | null>(null);

  // Sync selectedRun when runs or subjectSession change
  const runsJoined = runs.join(",");
  if (runsJoined !== prevRunsJoined || subjectSession !== prevSubjectSession) {
    setPrevRunsJoined(runsJoined);
    setPrevSubjectSession(subjectSession);
    setSelectedRun(runs && runs.length > 0 ? runs[0] : "1");
  }

  // Reset QC state and remount image cards when report parameters change.
  const [prevQCKey, setPrevQCKey] = useState<string>("");
  const reportKey = JSON.stringify([opened, projectRoot, subjectSession, module, selectedRun]);
  if (reportKey !== prevQCKey) {
    setPrevQCKey(reportKey);
    setQcMeasures([]);
    setQcLoading(Boolean(opened && projectRoot && subjectSession));
    setQcError(null);
  }

  useEffect(() => {
    let active = true;

    if (!opened || !projectRoot || !subjectSession) {
      return;
    }

    const runParam = module === "asl" ? selectedRun : undefined;

    const loadQC = async () => {
      setQcLoading(true);
      try {
        const measures = await fetchSubjectQC(projectRoot, subjectSession, module, runParam);
        if (!active) return;
        setQcMeasures(measures);
      } catch (err) {
        console.error(err);
        if (!active) return;
        setQcError("Failed to load Quality Control metrics.");
      } finally {
        if (active) {
          setQcLoading(false);
        }
      }
    };

    void loadQC();

    return () => {
      active = false;
    };
  }, [opened, projectRoot, subjectSession, module, selectedRun]);

  // Parse subject and session labels
  const [sub, ses] = subjectSession ? subjectSession.split("_") : ["", ""];
  const subjectLabel = sub.startsWith("sub-") ? sub.slice(4) : sub;
  const sessionLabel = ses || "01";

  const showRunSelect = module === "asl" && runs.length > 1;

  const modalTitle = `${module === "structural" ? "Structural" : "ASL"} QC Report — sub-${subjectLabel} / ses-${sessionLabel}`;
  const imageProps = {
    opened,
    projectRoot,
    subjectSession,
    run: module === "asl" ? selectedRun : undefined,
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={600}>{modalTitle}</Text>}
      size="85%"
      data-testid="report-viewer-modal"
      attributes={{ close: { "data-testid": "report-viewer-modal-close" } }}
    >
      <Stack gap="lg">
        {showRunSelect && (
          <Group justify="flex-start" align="center">
            <Text size="sm" fw={500}>
              Select Run:
            </Text>
            <Select
              aria-label="ASL report run"
              data={runs.map((r) => ({ value: r, label: `Run ${r}` }))}
              value={selectedRun}
              onChange={(val) => setSelectedRun(val || "1")}
              style={{ width: 120 }}
              {...comboboxTestIds("report-run-select")}
            />
          </Group>
        )}

        {module === "structural" ? (
          <Stack key={reportKey} gap="md" data-testid="structural-report-section">
            <Stack gap="xs">
              <Title order={4} data-testid="report-heading" style={{ lineHeight: 1.3 }}>
                {`Registration to standard space and white matter segmentation for Subject ${subjectLabel} Session ${sessionLabel}`}
              </Title>
              <Text size="sm" c="dimmed" data-testid="report-description">
                This report displays the registration of the structural T1w image to standard space,
                with the white matter segmentation overlaid in red. Use the axial and coronal
                mosaics below to visually check for alignment accuracy and segmentation quality.
              </Text>
            </Stack>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" style={{ marginTop: 10 }}>
              <ImageCard
                {...imageProps}
                title="Axial View (Transversal)"
                module="structural"
                view="axial"
                errorLabel="Structural axial registration image not found."
                testIdPrefix="axial"
              />
              <ImageCard
                {...imageProps}
                title="Coronal View"
                module="structural"
                view="coronal"
                errorLabel="Structural coronal registration image not found."
                testIdPrefix="coronal"
              />
            </SimpleGrid>
          </Stack>
        ) : (
          <Stack key={reportKey} gap="xl" data-testid="asl-report-section">
            {/* 1. ASL-Structural Registration */}
            <Stack gap="md" data-testid="asl-struct-section">
              <Stack gap="xs">
                <Title order={4} data-testid="asl-struct-heading" style={{ lineHeight: 1.3 }}>
                  {`ASL-Structural Registration for Subject ${subjectLabel} Session ${sessionLabel} [Run ${selectedRun}]`}
                </Title>
                <Text size="sm" c="dimmed" data-testid="asl-struct-description">
                  This report displays the registration of the ASL qCBF image to the
                  structural/standard space. The structural white matter segmentation contour is
                  overlaid in red on the qCBF map. Use the axial and coronal mosaics below to
                  visually inspect the alignment between the ASL and structural images.
                </Text>
              </Stack>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                <ImageCard
                  {...imageProps}
                  title="ASL-Structural Registration (Axial View)"
                  module="asl"
                  view="axial"
                  errorLabel="ASL-Structural axial registration image not found."
                  testIdPrefix="asl-axial"
                />
                <ImageCard
                  {...imageProps}
                  title="ASL-Structural Registration (Coronal View)"
                  module="asl"
                  view="coronal"
                  errorLabel="ASL-Structural coronal registration image not found."
                  testIdPrefix="asl-coronal"
                />
              </SimpleGrid>
            </Stack>

            {/* 2. M0-ASL Registration */}
            <Stack gap="md" data-testid="m0-asl-section">
              <Stack gap="xs">
                <Title order={4} data-testid="m0-asl-heading" style={{ lineHeight: 1.3 }}>
                  {`M0-ASL Registration for Subject ${subjectLabel} Session ${sessionLabel} [Run ${selectedRun}]`}
                </Title>
                <Text size="sm" c="dimmed" data-testid="m0-asl-description">
                  This report displays the registration of the M0 calibration image to the ASL qCBF
                  space. The grey matter segmentation contour is overlaid in red on the M0 map. Use
                  the axial and coronal mosaics below to visually inspect the alignment between the
                  M0 and qCBF images.
                </Text>
              </Stack>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                <ImageCard
                  {...imageProps}
                  title="M0-ASL Registration (Axial View)"
                  module="m0"
                  view="axial"
                  errorLabel="M0-ASL axial registration image not found."
                  testIdPrefix="m0-axial"
                />
                <ImageCard
                  {...imageProps}
                  title="M0-ASL Registration (Coronal View)"
                  module="m0"
                  view="coronal"
                  errorLabel="M0-ASL coronal registration image not found."
                  testIdPrefix="m0-coronal"
                />
              </SimpleGrid>
            </Stack>
          </Stack>
        )}

        {/* Quality Control Metrics section */}
        <Stack gap="xs" data-testid="qc-metrics-section" style={{ marginTop: 15 }}>
          <Title order={4} data-testid="qc-metrics-heading">
            Quality Control Metrics
          </Title>
          {qcLoading ? (
            <Box
              style={{ display: "flex", justifyContent: "center", padding: 20 }}
              data-testid="qc-metrics-loading"
            >
              <Loader size="sm" />
            </Box>
          ) : qcError ? (
            <Alert
              color="orange"
              icon={<IconAlertCircle size={16} />}
              data-testid="qc-metrics-error"
            >
              {qcError}
            </Alert>
          ) : qcMeasures.length > 0 ? (
            <Box
              style={{
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: "var(--mantine-radius-sm)",
                overflow: "hidden",
              }}
              data-testid="qc-metrics-table-container"
            >
              <Table striped highlightOnHover data-testid="qc-metrics-table">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: "50%" }}>Metric</Table.Th>
                    <Table.Th style={{ width: "50%" }}>Value</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {qcMeasures.map((measure) => (
                    <Table.Tr key={measure.key} data-testid={`qc-row-${measure.key}`}>
                      <Table.Td>
                        <Text size="sm" fw={500} data-testid={`qc-label-${measure.key}`}>
                          {getQcMeasureLabel(measure.key)}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ maxWidth: 300 }}>
                        <Text
                          size="sm"
                          truncate="end"
                          data-testid={`qc-value-${measure.key}`}
                          title={measure.value}
                        >
                          {measure.value}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          ) : (
            <Text size="sm" c="dimmed" data-testid="qc-metrics-empty">
              No quality control metrics available.
            </Text>
          )}
        </Stack>
      </Stack>
    </Modal>
  );
}
