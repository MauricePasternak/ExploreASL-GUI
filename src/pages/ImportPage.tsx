import { Box, Group, Stepper } from "@mantine/core";
import {
  IconDatabase,
  IconEye,
  IconFileImport,
  IconPlayerPlay,
  IconRoute,
  IconTags,
} from "@tabler/icons-react";
import { useEffect, useRef } from "react";

import AliasResolution from "../components/import/AliasResolution";
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

const AUTOSAVE_DEBOUNCE_MS = 2000;

/** Keep in sync with Layout AppShell header/footer heights and padding. */
const APP_SHELL_HEADER_HEIGHT = 56;
const APP_SHELL_FOOTER_HEIGHT = 40;

/** Sticky offset when the window (not just Main) is the scroll container. */
const IMPORT_STEPPER_STICKY_TOP = `calc(${APP_SHELL_HEADER_HEIGHT}px + var(--mantine-spacing-md))`;
const IMPORT_STEPPER_MAX_HEIGHT = `calc(100vh - ${APP_SHELL_HEADER_HEIGHT}px - ${APP_SHELL_FOOTER_HEIGHT}px - 2 * var(--mantine-spacing-md))`;

/**
 * Import wizard page with vertical stepper on the left.
 * Each step renders its own content panel on the right.
 * Auto-syncs import state to project file with debounced saves.
 *
 * The stepper is display-only — navigation happens via
 * Next/Back buttons inside each step component.
 */
export default function ImportPage() {
  const activeStep = useImportStore((s) => s.activeStep);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-sync import state → project mappingState → file (debounced)
  useEffect(() => {
    const unsubscribe = useImportStore.subscribe((state) => {
      const project = useProjectStore.getState().project;
      if (!project) return;
      const projectId = project.projectMeta.id;

      useProjectStore.getState().syncImportState(state);

      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = setTimeout(() => {
        const current = useProjectStore.getState();
        if (current.project?.projectMeta.id === projectId) {
          current.saveProject();
        }
        autosaveTimerRef.current = null;
      }, AUTOSAVE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  return (
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
  );
}
