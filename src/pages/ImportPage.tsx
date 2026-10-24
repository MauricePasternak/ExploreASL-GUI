import { Alert, Box, Button, Code, Group, Stack, Stepper, Text } from "@mantine/core";
import {
  IconDatabase,
  IconEye,
  IconFileImport,
  IconPlayerPlay,
  IconRoute,
  IconTags,
  IconAlertTriangle,
} from "@tabler/icons-react";

import AliasResolution from "../components/import/AliasResolution";
import BIDSReviewPanel from "../components/import/BIDSReviewPanel";
import DicomIngestion from "../components/import/DicomIngestion";
import ImportExecution from "../components/import/ImportExecution";
import ImportPreview from "../components/import/ImportPreview";
import MetadataGrouping from "../components/import/MetadataGrouping";
import PathTokenizer from "../components/import/PathTokenizer";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";

const IMPORT_STEPS = [
  { label: "Ingest DICOMs", icon: IconDatabase, description: "Scan folders" },
  { label: "Tokenize Paths", icon: IconRoute, description: "Assign tags" },
  { label: "Resolve Aliases", icon: IconTags, description: "Map names" },
  { label: "Metadata", icon: IconFileImport, description: "BIDS params" },
  { label: "Preview Import", icon: IconEye, description: "Review" },
  { label: "Run Import Module", icon: IconPlayerPlay, description: "Execute" },
] as const;

/** Keep in sync with Layout AppShell header/footer heights and padding. */
const APP_SHELL_HEADER_HEIGHT = 56;
const APP_SHELL_FOOTER_HEIGHT = 40;

/** Main scrolls below the fixed header, so only its inner padding is needed. */
const IMPORT_STEPPER_STICKY_TOP = "var(--mantine-spacing-md)";
const IMPORT_STEPPER_MAX_HEIGHT = `calc(100vh - ${APP_SHELL_HEADER_HEIGHT}px - ${APP_SHELL_FOOTER_HEIGHT}px - 2 * var(--mantine-spacing-md))`;

/**
 * Import wizard page with vertical stepper on the left.
 * Each step renders its own content panel on the right.
 *
 * The stepper is display-only — navigation happens via
 * Next/Back buttons inside each step component.
 */
export default function ImportPage() {
  const savedStep = useProjectStore((s) => s.project?.uiState.import?.activeStep ?? 0);
  const phase = useImportStore((s) => s.importPhase);
  const stagingStatus = useImportStore((s) => s.stagingPreflight.status);
  const activeStep =
    savedStep === 5 && phase === "idle" && stagingStatus !== "valid" ? 4 : savedStep;
  const dataSource = useProjectStore((s) => s.project?.projectMeta?.dataSource);
  const sourceAvailability = useImportStore((s) => s.sourceAvailability);
  const setActiveStep = useImportStore((s) => s.setActiveStep);

  // BIDS-direct: render BIDSReviewPanel only (skip stepper sidebar)
  if (dataSource === "bids") {
    return <BIDSReviewPanel />;
  }

  const sourceUnavailable = ["missing", "unreadable", "ambiguous"].includes(
    sourceAvailability.status,
  );

  return (
    <Stack>
      {sourceUnavailable && activeStep !== 0 && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="yellow"
          title="DICOM source unavailable"
          data-testid="import-missing-source-warning"
        >
          <Stack gap="xs">
            <Text size="sm">{sourceAvailability.message}</Text>
            <Code data-testid="import-missing-source-path">{sourceAvailability.savedPath}</Code>
            <Button
              variant="light"
              onClick={() => setActiveStep(0)}
              data-testid="import-relink-btn"
            >
              Relink
            </Button>
          </Stack>
        </Alert>
      )}
      <Group align="flex-start" gap="lg" wrap="nowrap" style={{ minHeight: "calc(100vh - 140px)" }}>
        {/* Vertical stepper sidebar — sticky while step content scrolls */}
        <Box
          data-testid="import-stepper-sidebar"
          style={{
            width: 200,
            flexShrink: 0,
            position: "sticky",
            top: IMPORT_STEPPER_STICKY_TOP,
            alignSelf: "flex-start",
            maxHeight: IMPORT_STEPPER_MAX_HEIGHT,
            overflowY: "auto",
            zIndex: 1,
            paddingTop: 4,
            paddingBottom: 4,
          }}
        >
          <Stepper active={activeStep} orientation="vertical" size="sm">
            {IMPORT_STEPS.map((step, index) => (
              <Stepper.Step
                key={step.label}
                label={step.label}
                description={step.description}
                icon={<step.icon size={18} />}
                allowStepSelect={false}
                data-testid={`import-step-${index}`}
              />
            ))}
          </Stepper>
        </Box>

        {/* Step content panel */}
        <Box style={{ flex: 1, minWidth: 0 }}>
          {activeStep === 0 && <DicomIngestion />}
          {activeStep === 1 && <PathTokenizer />}
          {activeStep === 2 && <AliasResolution />}
          {activeStep === 3 && <MetadataGrouping />}
          {activeStep === 4 && <ImportPreview />}
          {activeStep === 5 && <ImportExecution />}
        </Box>
      </Group>
    </Stack>
  );
}
