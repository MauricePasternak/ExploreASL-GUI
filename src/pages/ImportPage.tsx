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
import { useState } from "react";

import AliasResolution from "../components/import/AliasResolution";
import BIDSReviewPanel from "../components/import/BIDSReviewPanel";
import DicomIngestion from "../components/import/DicomIngestion";
import ImportExecution from "../components/import/ImportExecution";
import ImportPreview from "../components/import/ImportPreview";
import { ImportNavigationTargetContext } from "../components/import/ImportNavigationTargetContext";
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

/**
 * Import wizard page with vertical stepper on the left.
 * Each step renders its own content panel on the right.
 *
 * Step labels are display-only. Each step owns its Next/Back buttons,
 * rendered inside the stepper sidebar.
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
  const [navigationTarget, setNavigationTarget] = useState<HTMLDivElement | null>(null);

  // BIDS-direct: render BIDSReviewPanel only (skip stepper sidebar)
  if (dataSource === "bids") {
    return <BIDSReviewPanel />;
  }

  const sourceUnavailable = ["missing", "unreadable", "ambiguous"].includes(
    sourceAvailability.status,
  );

  return (
    <Stack style={{ flex: 1, minHeight: 0 }} data-testid="import-page">
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
      <ImportNavigationTargetContext value={navigationTarget}>
        <Group
          align="stretch"
          gap="lg"
          wrap="nowrap"
          style={{ flex: 1, minHeight: 0 }}
          data-testid="import-panels"
        >
          {/* Steps and content scroll independently; navigation stays inside the stepper. */}
          <Box
            data-testid="import-stepper-sidebar"
            style={{
              width: 240,
              flexShrink: 0,
              minHeight: 0,
            }}
          >
            <Stepper
              active={activeStep}
              orientation="vertical"
              size="sm"
              data-testid="import-stepper"
              attributes={{
                steps: {
                  "data-testid": "import-stepper-steps",
                  tabIndex: 0,
                  role: "region",
                  "aria-label": "Import steps",
                },
              }}
              styles={{
                root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
                steps: { flex: 1, minHeight: 0, overflowY: "auto", paddingBlock: 4 },
                content: { paddingTop: 0, flexShrink: 0 },
              }}
            >
              {IMPORT_STEPS.map((step, index) => (
                <Stepper.Step
                  key={step.label}
                  label={step.label}
                  description={step.description}
                  icon={<step.icon size={18} />}
                  allowStepSelect={false}
                  data-testid={`import-step-${index}`}
                >
                  <Box ref={setNavigationTarget} data-testid="import-stepper-navigation" />
                </Stepper.Step>
              ))}
            </Stepper>
          </Box>

          {/* Step content panel */}
          <Box
            style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}
            data-testid="import-step-panel"
          >
            {activeStep === 0 && <DicomIngestion />}
            {activeStep === 1 && <PathTokenizer />}
            {activeStep === 2 && <AliasResolution />}
            {activeStep === 3 && <MetadataGrouping />}
            {activeStep === 4 && <ImportPreview />}
            {activeStep === 5 && <ImportExecution />}
          </Box>
        </Group>
      </ImportNavigationTargetContext>
    </Stack>
  );
}
