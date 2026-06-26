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
import { useEffect, useRef, useState } from "react";

import { fetchReportImage, fetchSubjectQC, type QcMeasure } from "../../lib/reportViewer";

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
  url: string | null;
  loading: boolean;
  error: boolean;
  errorLabel: string;
  testIdPrefix: string;
}

function ImageCard({ title, url, loading, error, errorLabel, testIdPrefix }: ImageCardProps) {
  const [decodeError, setDecodeError] = useState(false);

  useEffect(() => {
    setDecodeError(false);
  }, [url]);

  const hasError = error || decodeError;

  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-gray-3)",
        borderRadius: "var(--mantine-radius-sm)",
        overflow: "hidden",
      }}
      data-testid={`${testIdPrefix}-container`}
    >
      <Text
        size="sm"
        fw={600}
        p="xs"
        bg="var(--mantine-color-gray-1)"
        style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}
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
      ) : hasError ? (
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
          onError={() => setDecodeError(true)}
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
  const [selectedRun, setSelectedRun] = useState<string>("1");

  const [axialUrl, setAxialUrl] = useState<string | null>(null);
  const [coronalUrl, setCoronalUrl] = useState<string | null>(null);
  const [m0AxialUrl, setM0AxialUrl] = useState<string | null>(null);
  const [m0CoronalUrl, setM0CoronalUrl] = useState<string | null>(null);

  const [axialLoading, setAxialLoading] = useState(false);
  const [coronalLoading, setCoronalLoading] = useState(false);
  const [m0AxialLoading, setM0AxialLoading] = useState(false);
  const [m0CoronalLoading, setM0CoronalLoading] = useState(false);

  const [axialErr, setAxialErr] = useState(false);
  const [coronalErr, setCoronalErr] = useState(false);
  const [m0AxialErr, setM0AxialErr] = useState(false);
  const [m0CoronalErr, setM0CoronalErr] = useState(false);

  const axialUrlRef = useRef<string | null>(null);
  const coronalUrlRef = useRef<string | null>(null);
  const m0AxialUrlRef = useRef<string | null>(null);
  const m0CoronalUrlRef = useRef<string | null>(null);

  const [qcMeasures, setQcMeasures] = useState<QcMeasure[]>([]);
  const [qcLoading, setQcLoading] = useState(false);
  const [qcError, setQcError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setQcMeasures([]);
    setQcLoading(false);
    setQcError(null);

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

  useEffect(() => {
    if (runs && runs.length > 0) {
      setSelectedRun(runs[0]);
    } else {
      setSelectedRun("1");
    }
  }, [runs, subjectSession]);

  const cleanupUrls = () => {
    if (axialUrlRef.current) {
      URL.revokeObjectURL(axialUrlRef.current);
      axialUrlRef.current = null;
    }
    if (coronalUrlRef.current) {
      URL.revokeObjectURL(coronalUrlRef.current);
      coronalUrlRef.current = null;
    }
    if (m0AxialUrlRef.current) {
      URL.revokeObjectURL(m0AxialUrlRef.current);
      m0AxialUrlRef.current = null;
    }
    if (m0CoronalUrlRef.current) {
      URL.revokeObjectURL(m0CoronalUrlRef.current);
      m0CoronalUrlRef.current = null;
    }
  };

  const loadImage = async (
    mod: "structural" | "asl" | "m0",
    view: "axial" | "coronal",
    runVal: string | undefined,
    setUrl: (url: string | null) => void,
    setLoad: (l: boolean) => void,
    setErr: (e: boolean) => void,
    urlRef: React.MutableRefObject<string | null>,
    active: { current: boolean },
  ) => {
    if (!projectRoot || !subjectSession) return;
    setLoad(true);
    setErr(false);
    setUrl(null);
    try {
      const bytes = await fetchReportImage(projectRoot, subjectSession, mod, runVal, view);
      if (!active.current) return;
      const blob = new Blob([bytes as BlobPart], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setUrl(url);
    } catch (err) {
      console.error(err);
      if (!active.current) return;
      setErr(true);
    } finally {
      if (active.current) {
        setLoad(false);
      }
    }
  };

  useEffect(() => {
    const active = { current: true };
    cleanupUrls();
    setAxialUrl(null);
    setCoronalUrl(null);
    setM0AxialUrl(null);
    setM0CoronalUrl(null);
    setAxialErr(false);
    setCoronalErr(false);
    setM0AxialErr(false);
    setM0CoronalErr(false);

    if (!opened || !projectRoot || !subjectSession) {
      return;
    }

    const runParam = module === "asl" ? selectedRun : undefined;

    if (module === "structural") {
      loadImage(
        "structural",
        "axial",
        undefined,
        setAxialUrl,
        setAxialLoading,
        setAxialErr,
        axialUrlRef,
        active,
      );
      loadImage(
        "structural",
        "coronal",
        undefined,
        setCoronalUrl,
        setCoronalLoading,
        setCoronalErr,
        coronalUrlRef,
        active,
      );
    } else {
      loadImage(
        "asl",
        "axial",
        runParam,
        setAxialUrl,
        setAxialLoading,
        setAxialErr,
        axialUrlRef,
        active,
      );
      loadImage(
        "asl",
        "coronal",
        runParam,
        setCoronalUrl,
        setCoronalLoading,
        setCoronalErr,
        coronalUrlRef,
        active,
      );
      loadImage(
        "m0",
        "axial",
        runParam,
        setM0AxialUrl,
        setM0AxialLoading,
        setM0AxialErr,
        m0AxialUrlRef,
        active,
      );
      loadImage(
        "m0",
        "coronal",
        runParam,
        setM0CoronalUrl,
        setM0CoronalLoading,
        setM0CoronalErr,
        m0CoronalUrlRef,
        active,
      );
    }

    return () => {
      active.current = false;
      cleanupUrls();
    };
  }, [opened, projectRoot, subjectSession, module, selectedRun]);

  // Parse subject and session labels
  const [sub, ses] = subjectSession ? subjectSession.split("_") : ["", ""];
  const subjectLabel = sub.startsWith("sub-") ? sub.slice(4) : sub;
  const sessionLabel = ses || "01";

  const showRunSelect = module === "asl" && runs.length > 1;

  const modalTitle = `${module === "structural" ? "Structural" : "ASL"} QC Report — sub-${subjectLabel} / ses-${sessionLabel}`;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={600}>{modalTitle}</Text>}
      size="85%"
      data-testid="report-viewer-modal"
    >
      <Stack gap="lg">
        {showRunSelect && (
          <Group justify="flex-start" align="center">
            <Text size="sm" fw={500}>
              Select Run:
            </Text>
            <Select
              data={runs.map((r) => ({ value: r, label: `Run ${r}` }))}
              value={selectedRun}
              onChange={(val) => setSelectedRun(val || "1")}
              style={{ width: 120 }}
              data-testid="report-run-select"
            />
          </Group>
        )}

        {module === "structural" ? (
          <Stack gap="md" data-testid="structural-report-section">
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
                title="Axial View (Transversal)"
                url={axialUrl}
                loading={axialLoading}
                error={axialErr}
                errorLabel="Structural axial registration image not found."
                testIdPrefix="axial"
              />
              <ImageCard
                title="Coronal View"
                url={coronalUrl}
                loading={coronalLoading}
                error={coronalErr}
                errorLabel="Structural coronal registration image not found."
                testIdPrefix="coronal"
              />
            </SimpleGrid>
          </Stack>
        ) : (
          <Stack gap="xl" data-testid="asl-report-section">
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
                  title="ASL-Structural Registration (Axial View)"
                  url={axialUrl}
                  loading={axialLoading}
                  error={axialErr}
                  errorLabel="ASL-Structural axial registration image not found."
                  testIdPrefix="asl-axial"
                />
                <ImageCard
                  title="ASL-Structural Registration (Coronal View)"
                  url={coronalUrl}
                  loading={coronalLoading}
                  error={coronalErr}
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
                  title="M0-ASL Registration (Axial View)"
                  url={m0AxialUrl}
                  loading={m0AxialLoading}
                  error={m0AxialErr}
                  errorLabel="M0-ASL axial registration image not found."
                  testIdPrefix="m0-axial"
                />
                <ImageCard
                  title="M0-ASL Registration (Coronal View)"
                  url={m0CoronalUrl}
                  loading={m0CoronalLoading}
                  error={m0CoronalErr}
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
                border: "1px solid var(--mantine-color-gray-3)",
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
                          {measure.label}
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
