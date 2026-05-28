import { Box, Group, Stepper } from "@mantine/core";
import {
  IconDatabase,
  IconFileImport,
  IconPlayerPlay,
  IconRoute,
  IconTags,
} from "@tabler/icons-react";

import { useImportStore } from "../stores/importStore";
import DicomIngestion from "../components/import/DicomIngestion";
import PathTokenizer from "../components/import/PathTokenizer";
import AliasResolution from "../components/import/AliasResolution";
import MetadataGrouping from "../components/import/MetadataGrouping";
import ImportRunner from "../components/import/ImportRunner";

const IMPORT_STEPS = [
  { label: "Ingest DICOMs", icon: IconDatabase, description: "Scan folders" },
  { label: "Tokenize Paths", icon: IconRoute, description: "Assign tags" },
  { label: "Resolve Aliases", icon: IconTags, description: "Map names" },
  { label: "Metadata", icon: IconFileImport, description: "BIDS params" },
  { label: "Run Import", icon: IconPlayerPlay, description: "Execute" },
] as const;

/**
 * Import wizard page with vertical stepper on the left.
 * Each step renders its own content panel on the right.
 */
export default function ImportPage() {
  const activeStep = useImportStore((s) => s.activeStep);
  const setActiveStep = useImportStore((s) => s.setActiveStep);

  return (
    <Group align="flex-start" gap="lg" wrap="nowrap" style={{ minHeight: "calc(100vh - 140px)" }}>
      {/* Vertical stepper sidebar */}
      <Box style={{ width: 240, flexShrink: 0 }}>
        <Stepper
          active={activeStep}
          onStepClick={setActiveStep}
          orientation="vertical"
          size="sm"
        >
          {IMPORT_STEPS.map((step, index) => (
            <Stepper.Step
              key={step.label}
              label={step.label}
              description={step.description}
              icon={<step.icon size={18} />}
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
        {activeStep === 4 && <ImportRunner />}
      </Box>
    </Group>
  );
}
