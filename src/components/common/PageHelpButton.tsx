import {
  ActionIcon,
  Alert,
  Button,
  Group,
  List,
  Modal,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconBook, IconChevronRight, IconHelp, IconInfoCircle } from "@tabler/icons-react";
import { useState } from "react";
import { useInRouterContext, useLocation, useNavigate, useParams } from "react-router";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import { useVisualizationStore } from "../../stores/visualizationStore";

interface HelpContent {
  title: string;
  subtitle: string;
  goal: string;
  steps: string[];
  tipTitle?: string;
  tipContent?: string;
}

const HELP_DATA: Record<string, HelpContent> = {
  "import-0": {
    title: "Ingest DICOMs",
    subtitle: "Phase 1: Import Module",
    goal: "Scan a local raw data directory to recursively find and catalogue MRI image files (DICOMs) for your subjects.",
    steps: [
      "Click 'Select Source Directory' to browse and select the folder containing your raw scanner files.",
      "Set 'How are your DICOM files organised?' — leave ON (default) if each scan series is in its own subfolder (typical for scanner exports). Turn it OFF if all DICOMs are in one flat directory.",
      "Click 'Scan for DICOMs'. The system will walk the folder structure and display all detected DICOM locations.",
      "Confirm that your raw directories and files are detected correctly in the table.",
      "Click 'Next' at the bottom of the screen to proceed to Tokenization.",
    ],
    tipTitle: "Subfolder grouping",
    tipContent:
      "Most DICOM exports organise each scan series into its own subfolder (one folder per series). Leave this ON for that layout. Only turn it OFF when all your DICOM files are dumped into a single flat directory with no series subfolders.",
  },
  "import-1": {
    title: "Tokenize Paths",
    subtitle: "Phase 1: Import Module",
    goal: "Teach ExploreASL how to translate your raw folder structure into standardized BIDS identifiers (Subject, Session, Run, Modality).",
    steps: [
      "Look at the folder path template. You need to assign meaning to each level of your directories.",
      "Drag and drop tokens (Subject, Visit/Session, Session/Run, Scan/Modality) to match your folder hierarchy.",
      "If folder names contain extra characters (e.g., 'sub-01_T1'), you can use custom Regular Expressions (Regex) to extract the exact ID.",
      "Ensure that the tokenized path preview at the bottom correctly maps to your target structure.",
    ],
    tipTitle: "Nomenclature Conversion",
    tipContent:
      "ExploreASL uses: Visit (corresponds to BIDS Session), Session (corresponds to BIDS Run), and Scan (corresponds to BIDS Modality).",
  },
  "import-2": {
    title: "Resolve Aliases",
    subtitle: "Phase 1: Import Module",
    goal: "Map raw scanner labels to standardized BIDS modalities, adjust subject names, and set session/run ordering.",
    steps: [
      "Subject Rename: Click to rename subjects to conform to your study naming convention (e.g., anonymizing IDs).",
      "Session/Run Order: If your subjects have multiple scans, check the order of sessions/runs to ensure longitudinal consistency.",
      "Modality Map: Map detected scanner/raw labels (e.g., '3D_T1w', 'ASL_2D') to standard BIDS types ('T1w', 'FLAIR', 'ASL', 'M0').",
      "Unmapped modalities will be ignored during import. Map all scans you want to analyze.",
    ],
    tipTitle: "Important Modality Mapping",
    tipContent:
      "Ensure your ASL scan and its corresponding M0 scan (if acquired separately for calibration) are correctly mapped so quantification works.",
  },
  "import-3": {
    title: "Acquisition Metadata",
    subtitle: "Phase 1: Import Module",
    goal: "Specify the scanner-specific and sequence-specific acquisition parameters required for accurate ASL blood flow quantification.",
    steps: [
      "Decide on the scope of each parameter (Global, Per-Scanner, or Per-Subject/Session).",
      "Enter required values: Labelling Type (e.g., PCASL/CASL or PASL), Labelling Duration (ms), and Post-Labelling Delay (ms).",
      "Ensure that any cells highlighted in red (representing validation errors) are filled with correct, positive numbers.",
      "Correct parameters are essential for blood flow calculations; incorrect values will yield invalid results.",
    ],
    tipTitle: "Validation Rule",
    tipContent:
      "All required fields must be validated. If you see validation warnings, hover over the cells or check the tooltips for guidance on valid ranges.",
  },
  "import-4": {
    title: "Preview Import Staging",
    subtitle: "Phase 1: Import Module",
    goal: "Verify the staging dataset layout and the generated ExploreASL configuration parameters before executing the import.",
    steps: [
      "Examine the simulated folder structure on the left (conforming to BIDS: sub-<id>/ses-<id>/asl/).",
      "Ensure that files are placed under the correct subject, session, and modality subfolders.",
      "Review the raw 'dataPar.json' configuration on the right, which will be passed to ExploreASL.",
      "If any details look incorrect, use the Back button to fix them before writing files.",
    ],
    tipTitle: "BIDS Directory Check",
    tipContent:
      "Verify that all subjects have their structural (T1w) and functional (ASL) files correctly placed in their respective modality folders.",
  },
  "import-5": {
    title: "Run Import Module",
    subtitle: "Phase 1: Import Module",
    goal: "Run the MATLAB/ExploreASL import command to convert and copy your raw DICOMs into a clean BIDS dataset.",
    steps: [
      "Click the 'Run Import' button to start the execution.",
      "The process runs in the background. Check the live execution logs at the bottom to trace MATLAB stdout.",
      "Monitor the subject list; successful imports will show a green checkmark next to the subject ID.",
      "Once all subjects are completed, you will be unlocked to move to the next phase.",
    ],
    tipTitle: "Background Execution",
    tipContent:
      "The import process copies and converts files (using dcm2niix). Depending on dataset size and hard drive speed, this can take a few minutes.",
  },
  "bids-review": {
    title: "BIDS Review",
    subtitle: "Phase 1: Import Module",
    goal: "Review the detected BIDS dataset, assign or override group labels, and inspect subjects and sessions before importing.",
    steps: [
      "Review the identified BIDS metadata groups in the list.",
      "You can customize the 'Group Label' for each metadata group to your liking.",
      "Check the subject and session list for each group to ensure no data is missing.",
      "If there are any warnings (e.g. skipped subjects), check the reason and resolve them if needed.",
      "Click 'Confirm' at the bottom right to complete the import and proceed to parameters configuration.",
    ],
    tipTitle: "Participants TSV",
    tipContent:
      "If a participants.tsv file exists in the raw BIDS directory, ExploreASL GUI does not modify it, keeping your authored file intact.",
  },
  parameters: {
    title: "Configure Pipeline Parameters",
    subtitle: "Phase 2: Parameters Module",
    goal: "Fine-tune and customize the processing options for the Structural, ASL, and Population modules of the ExploreASL pipeline.",
    steps: [
      "Navigate through the tabs: Structural, ASL, Population, and Atlases.",
      "Structural: Set up tissue segmentation (e.g., CAT12 vs. standard SPM) and registration settings.",
      "ASL: Configure motion correction, registration to structural images, and quantification model parameters.",
      "Population: Choose template space (e.g., MNI) and select standard or custom regions-of-interest (ROIs) for analysis.",
      "Click 'Save Configuration' to persist changes to the project's dataPar.json.",
    ],
    tipTitle: "Study Design",
    tipContent:
      "Keep configurations consistent across all subjects in a single study to ensure that your statistical and group analysis results are valid.",
  },
  processing: {
    title: "Run Processing Pipeline",
    subtitle: "Phase 3: Processing Module",
    goal: "Select subjects and execute the main ExploreASL processing modules on the imported BIDS dataset.",
    steps: [
      "Select Subjects: Check the boxes next to the subjects you wish to process.",
      "Preflight Checks: Confirm that all validation requirements are green (e.g., dataPar.json exists, rawdata folder is populated).",
      "Start Processing: Click 'Start Processing' to begin running the selected modules.",
      "Execution Dashboard: Monitor progress in real-time, inspect log outputs, and check module statuses (Structural, ASL, Population).",
    ],
    tipTitle: "Long Running Process",
    tipContent:
      "ExploreASL processing is highly CPU-intensive and can take 10-30 minutes per subject. You can monitor progress dynamically on this page.",
  },
  "viz-selectData": {
    title: "Select Data Source",
    subtitle: "Phase 4: Visualization Module",
    goal: "Choose a qCBF stats file and optionally join external covariates (CSV/Excel).",
    steps: [
      "Use the dropdown to select a qCBF file from the Population/Stats folder.",
      "Optionally enable 'Join external file' and select a CSV, TSV, or Excel file.",
      "Configure the matching subject/session key pairs to execute a left-join.",
      "After selection, the system inspects the data and infers column types.",
    ],
    tipTitle: "Data Change Detection",
    tipContent:
      "The system tracks file hashes. If any file is modified externally after selection, you will be prompted to reconfigure.",
  },
  "viz-columnTypes": {
    title: "Assign Column Types",
    subtitle: "Phase 4: Visualization Module",
    goal: "Review and adjust the automatically inferred type for each column to ensure correct chart rendering.",
    steps: [
      "Each column is auto-classified as Continuous (numeric), Ordinal (ordered categories), or Nominal (unordered categories).",
      "Use the type dropdown to override any incorrect inference (e.g., change a numeric site code from Continuous to Nominal).",
      "Set a column to Excluded if you do not want it available for plotting.",
      "Identifier columns (Subject, Session, Run) are locked to categorical types and cannot be changed.",
    ],
    tipTitle: "Type Affects Chart Behavior",
    tipContent:
      "Only continuous columns can be assigned to the Y-axis. Categorical columns control swarmplot grouping and color-by options.",
  },
  "viz-levelOrdering": {
    title: "Order Categorical Levels",
    subtitle: "Phase 4: Visualization Module",
    goal: "Control the display order of categories for ordinal and nominal columns on the X-axis.",
    steps: [
      "Each categorical column shows its discovered levels in the current order.",
      "Use the up/down arrow buttons to reorder levels for each column.",
      "Ordinal columns default to alphanumeric sorting; nominal columns default to file encounter order.",
      "This ordering only affects visual tick order on swarmplots — it has no statistical effect.",
    ],
    tipTitle: "Visual Only",
    tipContent:
      "Reordering levels does not imply any statistical relationship or trend. It purely controls the left-to-right display order on the chart.",
  },
  manifest: {
    title: "Project Manifest",
    subtitle: "Phase 5: Manifest",
    goal: "After Population completes, review each SubjectSession as Pass or Fail, then export a journal-ready manifest as Markdown or HTML.",
    steps: [
      "Use the QC Selection table to set a Pass/Fail verdict for each SubjectSession",
      "Neutral rows block progression — resolve all or exclude via No Info",
      "Open Manifest Preview to review the 4 sections (Study Parameters, Software Manifest, QC Summary, Pipeline Summary)",
      "Export Markdown or HTML — both are byte-identical across Windows 11, macOS, and Linux",
    ],
    tipTitle: "Re-run lockout",
    tipContent:
      "Re-running the Population module locks this phase until the new run completes. Verdicts are retained and marked Stale once the new run finishes; confirm or re-triage them before exporting.",
  },
  "viz-visualize": {
    title: "Explore Data",
    subtitle: "Phase 4: Visualization Module",
    goal: "Assign axes, inspect charts, and view qCBF brain images for individual data points.",
    steps: [
      "Use the X-axis, Y-axis, and Color-by dropdowns to configure the chart. Y-axis must be continuous.",
      "Continuous × continuous produces a scatterplot; categorical × continuous produces a swarmplot.",
      "Hover over points to see Subject, Session, Run, and axis values. Click a point to highlight it and load its qCBF image in the NiiVue viewer.",
      "Use the Filters panel (above the chart) to narrow the visible data range on either axis.",
    ],
    tipTitle: "Interactive Viewer",
    tipContent:
      "The NiiVue viewer shows tri-planar (axial, sagittal, coronal) views of the clicked subject's qCBF image.",
  },
};

const inlineButtonStyles = `
.page-help-btn-inline {
  border: 1px solid rgba(255, 255, 255, 0.2);
  transition: transform 0.15s ease;
}
.page-help-btn-inline:hover {
  transform: scale(1.08);
}
`;

function PageHelpButtonInner() {
  const [opened, setOpened] = useState(false);
  const location = useLocation();
  const params = useParams<{ phase?: string }>();
  const navigate = useNavigate();

  const phase = params.phase;
  const activeStep = useImportStore((s) => s.activeStep);
  const vizStage = useVisualizationStore((s) => s.stage);

  const dataSource = useProjectStore((s) => s.project?.projectMeta?.dataSource);

  // Determine help content key
  let contentKey = "";
  if (phase === "import") {
    if (dataSource === "bids") {
      contentKey = "bids-review";
    } else {
      contentKey = `import-${activeStep}`;
    }
  } else if (phase === "parameters") {
    contentKey = "parameters";
  } else if (phase === "processing") {
    contentKey = "processing";
  } else if (phase === "visualization") {
    contentKey = `viz-${vizStage}`;
  } else if (phase === "manifest") {
    contentKey = "manifest";
  }

  const helpContent = HELP_DATA[contentKey];

  // Only render on project phase sub-pages that have defined help content
  if (!phase || !helpContent) {
    return null;
  }

  return (
    <>
      <style>{inlineButtonStyles}</style>
      <Tooltip label="Need help with this page?" position="top" withArrow>
        <ActionIcon
          size={30}
          radius="xl"
          variant="gradient"
          gradient={{ from: "teal", to: "blue" }}
          onClick={() => setOpened(true)}
          className="page-help-btn-inline"
          aria-label="Need help with this page?"
          data-testid="page-help-btn"
        >
          <IconHelp size={16} />
        </ActionIcon>
      </Tooltip>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        transitionProps={{ duration: 0 }}
        title={
          <Stack gap={2}>
            <Text size="xs" c="dimmed" fw={700} tt="uppercase" lts="1.5px">
              {helpContent.subtitle}
            </Text>
            <Title order={3} style={{ color: "var(--mantine-color-teal-filled)" }}>
              {helpContent.title}
            </Title>
          </Stack>
        }
        size="lg"
        centered
        data-testid="page-help-modal"
      >
        <Stack gap="md">
          <Text size="sm" style={{ lineHeight: 1.6 }}>
            {helpContent.goal}
          </Text>

          <Text fw={600} size="sm" mt="xs">
            What you need to do here:
          </Text>

          <List
            type="ordered"
            spacing="sm"
            size="sm"
            icon={
              <ThemeIcon color="teal" size={20} radius="xl">
                <IconChevronRight size={12} />
              </ThemeIcon>
            }
          >
            {helpContent.steps.map((step, idx) => (
              <List.Item key={idx}>{step}</List.Item>
            ))}
          </List>

          {helpContent.tipTitle && helpContent.tipContent && (
            <Alert
              variant="light"
              color="blue"
              title={helpContent.tipTitle}
              icon={<IconInfoCircle size={18} />}
              mt="sm"
            >
              <Text size="sm" style={{ lineHeight: 1.5 }}>
                {helpContent.tipContent}
              </Text>
            </Alert>
          )}

          <Group justify="flex-end" mt="md">
            <Button
              variant="light"
              color="teal"
              leftSection={<IconBook size={16} />}
              onClick={() => {
                setOpened(false);
                navigate("/overview", { state: { from: location.pathname } });
              }}
              data-testid="page-help-modal-overview-btn"
            >
              Open Full Overview Guide
            </Button>
            <Button variant="default" onClick={() => setOpened(false)}>
              Got it
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export default function PageHelpButton() {
  const inRouter = useInRouterContext();
  if (!inRouter) {
    return null;
  }
  return <PageHelpButtonInner />;
}
