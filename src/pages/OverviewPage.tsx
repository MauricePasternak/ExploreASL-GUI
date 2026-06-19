import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAdjustments,
  IconArrowLeft,
  IconBrain,
  IconChartDots,
  IconDatabase,
  IconEye,
  IconFileImport,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconHelpCircle,
  IconPlayerPlay,
  IconPlus,
  IconRoute,
  IconTags,
} from "@tabler/icons-react";
import { useNavigate } from "react-router";

interface TreeRowProps {
  level: number;
  label: string;
  badge?: string;
  badgeColor?: string;
  isFolder?: boolean;
}

function TreeRow({ level, label, badge, badgeColor = "blue", isFolder = false }: TreeRowProps) {
  const Icon = isFolder ? IconFolder : IconFileText;
  return (
    <Group
      gap="xs"
      style={{ paddingLeft: level * 20, paddingTop: 2, paddingBottom: 2 }}
      wrap="nowrap"
    >
      {level > 0 && (
        <span
          style={{
            color: "var(--mantine-color-gray-4)",
            fontFamily: "monospace",
            userSelect: "none",
          }}
        >
          └──{" "}
        </span>
      )}
      <ThemeIcon color={isFolder ? "teal" : "gray"} size="xs" variant="subtle">
        <Icon size={14} />
      </ThemeIcon>
      <Text ff="monospace" size="sm" style={{ whiteSpace: "nowrap" }}>
        {label}
      </Text>
      {badge && (
        <Badge size="xs" color={badgeColor} variant="light">
          {badge}
        </Badge>
      )}
    </Group>
  );
}

export default function OverviewPage() {
  const navigate = useNavigate();

  return (
    <Stack
      gap="xl"
      style={{ maxWidth: 1000, margin: "0 auto", paddingBottom: 40 }}
      data-testid="overview-page"
    >
      {/* Header section */}
      <Group justify="space-between" align="center">
        <Stack gap={4}>
          <Title
            order={1}
            data-testid="overview-title"
            style={{ color: "var(--mantine-color-teal-filled)" }}
          >
            ExploreASL GUI Overview
          </Title>
          <Text c="dimmed" size="sm">
            Welcome! This guide outlines the overall pipeline workflow, terminology, and what
            happens at each step of your ASL project.
          </Text>
        </Stack>
        <Button
          leftSection={<IconArrowLeft size={16} />}
          variant="light"
          onClick={() => navigate("/")}
          data-testid="overview-back-btn"
        >
          Back to Home
        </Button>
      </Group>

      {/* Nomenclature Callout */}
      <Alert
        color="blue"
        title="Terminology Callout"
        icon={<IconHelpCircle size={18} />}
        data-testid="nomenclature-callout"
      >
        <Text size="sm">
          ExploreASL is currently transitioning to proper BIDS (Brain Imaging Data Structure)
          nomenclature. In the GUI, we stick strictly to BIDS terminology, but if you look at the
          raw MATLAB configuration or older files, you might encounter these legacy equivalents:
        </Text>
        <Grid mt="sm" gutter="xs">
          <Grid.Col span={{ base: 6, sm: 3 }}>
            <Card p="xs" withBorder>
              <Text fw={700} size="xs">
                Subject
              </Text>
              <Text size="xs" c="dimmed">
                Subject (ExploreASL)
              </Text>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 3 }}>
            <Card p="xs" withBorder>
              <Text fw={700} size="xs">
                Session
              </Text>
              <Text size="xs" c="dimmed">
                Visit (ExploreASL)
              </Text>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 3 }}>
            <Card p="xs" withBorder>
              <Text fw={700} size="xs">
                Run
              </Text>
              <Text size="xs" c="dimmed">
                Session (ExploreASL)
              </Text>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 3 }}>
            <Card p="xs" withBorder>
              <Text fw={700} size="xs">
                Modality
              </Text>
              <Text size="xs" c="dimmed">
                Scan (ExploreASL)
              </Text>
            </Card>
          </Grid.Col>
        </Grid>
      </Alert>

      {/* Project Management Section */}
      <Stack gap="md" data-testid="section-project-management">
        <Group gap="xs">
          <ThemeIcon color="teal" size="lg" radius="xl">
            <IconFolder size={20} />
          </ThemeIcon>
          <Title order={2} component="h1">
            Project Management
          </Title>
          <Badge color="teal" variant="outline">
            Overview
          </Badge>
        </Group>
        <Text size="sm">
          ExploreASL GUI processes data inside structured workspaces called{" "}
          <strong>Projects</strong>. Each project corresponds to a folder on your computer that
          contains all your raw files, BIDS mappings, configurations, and processing outputs.
        </Text>

        <Accordion variant="separated" data-testid="project-management-accordion">
          <Accordion.Item value="what-is-project">
            <Accordion.Control
              icon={<IconFolder size={16} color="var(--mantine-color-teal-filled)" />}
            >
              <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                What is a "Project"?
              </Title>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" mb="xs">
                A project acts as an isolated workspace. When you create or load a project, the GUI
                creates a <code>project.easl</code> file in the root of the folder. This file tracks
                your progress, BIDS tokenizer rules, and parameter selections.
              </Text>
              <Text size="xs" c="dimmed" mb="md">
                Keeping each study in its own folder prevents data mixing and makes it easy to
                share, archive, or back up the entire cohort's raw data and configurations together.
              </Text>

              <Text fw={600} size="sm" mt="md" mb="xs" data-testid="project-structure-title">
                Visual Project Directory Structure
              </Text>
              <Card
                withBorder
                p="md"
                bg="var(--mantine-color-gray-0)"
                radius="sm"
                style={{ overflowX: "auto" }}
              >
                <Stack gap={2}>
                  <TreeRow level={0} label="my_exploreasl_project/" isFolder />
                  <TreeRow
                    level={1}
                    label="project.easl"
                    badge="Project config"
                    badgeColor="grape"
                  />
                  <TreeRow
                    level={1}
                    label="sourcedata/"
                    isFolder
                    badge="Raw scans (symlinks or copies)"
                    badgeColor="blue"
                  />
                  <TreeRow level={2} label="sub-C9ORF007Philips/" isFolder />
                  <TreeRow level={3} label="ses-01/" isFolder />
                  <TreeRow level={4} label="T1w/" isFolder />
                  <TreeRow level={4} label="ASL/" isFolder />
                  <TreeRow
                    level={1}
                    label="rawdata/"
                    isFolder
                    badge="Standardized BIDS format"
                    badgeColor="teal"
                  />
                  <TreeRow level={2} label="dataset_description.json" />
                  <TreeRow level={2} label="sub-C9ORF007Philips/" isFolder />
                  <TreeRow level={3} label="ses-01/" isFolder />
                  <TreeRow level={4} label="anat/" isFolder />
                  <TreeRow level={5} label="sub-C9ORF007Philips_ses-01_T1w.nii.gz" />
                  <TreeRow level={5} label="sub-C9ORF007Philips_ses-01_T1w.json" />
                  <TreeRow level={4} label="perf/" isFolder />
                  <TreeRow level={5} label="sub-C9ORF007Philips_ses-01_asl.nii.gz" />
                  <TreeRow level={5} label="sub-C9ORF007Philips_ses-01_asl.json" />
                  <TreeRow level={5} label="sub-C9ORF007Philips_ses-01_aslcontext.tsv" />
                  <TreeRow
                    level={1}
                    label="derivatives/"
                    isFolder
                    badge="Outputs & QC reports"
                    badgeColor="orange"
                  />
                  <TreeRow level={2} label="ExploreASL/" isFolder />
                  <TreeRow
                    level={3}
                    label="dataPar.json"
                    badge="Parameters sent to MATLAB"
                    badgeColor="grape"
                  />
                  <TreeRow level={3} label="sub-C9ORF007Philips/" isFolder />
                  <TreeRow level={4} label="QC/" isFolder />
                  <TreeRow level={5} label="Structural_QC.json" />
                  <TreeRow level={3} label="Population/" isFolder />
                </Stack>
              </Card>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="create-project">
            <Accordion.Control
              icon={<IconPlus size={16} color="var(--mantine-color-teal-filled)" />}
            >
              <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                Creating a New Project
              </Title>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" mb="xs">
                Click <strong>New Project</strong> on the landing page, and select a folder on your
                computer.
              </Text>
              <Text size="sm" mb="xs">
                The selected folder will become the project's root. The GUI checks that the
                directory is writable and that no other <code>project.easl</code> file exists there,
                then initializes it as a fresh workspace.
              </Text>
              <Text size="xs" c="dimmed">
                It is recommended to start with a new, empty folder or a folder that already
                contains your raw DICOM scans inside a <code>sourcedata</code> subdirectory.
              </Text>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="open-project">
            <Accordion.Control
              icon={<IconFolderOpen size={16} color="var(--mantine-color-teal-filled)" />}
            >
              <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                Opening an Existing Project
              </Title>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" mb="xs">
                You can reload any previously created workspace in two ways:
              </Text>
              <Text size="sm" component="div" mb="xs">
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>
                    <strong>Open Project Button:</strong> Click "Open Project" on the landing page,
                    and navigate to and select the <code>project.easl</code> file in your project
                    directory.
                  </li>
                  <li>
                    <strong>Recent Projects List:</strong> Click "Open" next to the project name in
                    the "Recent Projects" table on the landing page to load it instantly.
                  </li>
                </ul>
              </Text>
              <Text size="xs" c="dimmed">
                The GUI automatically remembers your last active phase and import stepper step,
                letting you pick up exactly where you left off.
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>

      <Divider />

      {/* Workflow Map */}
      <Card padding="lg" radius="md" withBorder>
        <Title order={3} mb="md" data-testid="workflow-map-title">
          Interactive Workflow Map
        </Title>
        <Grid gutter="md" align="stretch">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <Card
              p="sm"
              radius="sm"
              style={{
                backgroundColor: "var(--mantine-color-blue-light)",
                borderLeft: "4px solid var(--mantine-color-blue-filled)",
                height: "100%",
              }}
            >
              <Group gap="xs" mb={8}>
                <ThemeIcon color="blue" size="sm">
                  <IconDatabase size={14} />
                </ThemeIcon>
                <Text fw={700} size="sm">
                  1. Import DICOM
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Ingest directories, tokenize paths, and map metadata to create standard BIDS
                structures.
              </Text>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 3 }}>
            <Card
              p="sm"
              radius="sm"
              style={{
                backgroundColor: "var(--mantine-color-grape-light)",
                borderLeft: "4px solid var(--mantine-color-grape-filled)",
                height: "100%",
              }}
            >
              <Group gap="xs" mb={8}>
                <ThemeIcon color="grape" size="sm">
                  <IconRoute size={14} />
                </ThemeIcon>
                <Text fw={700} size="sm">
                  2. Define Parameters
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Configure processing parameters, ASL/M0 options, and study-level settings.
              </Text>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 3 }}>
            <Card
              p="sm"
              radius="sm"
              style={{
                backgroundColor: "var(--mantine-color-teal-light)",
                borderLeft: "4px solid var(--mantine-color-teal-filled)",
                height: "100%",
              }}
            >
              <Group gap="xs" mb={8}>
                <ThemeIcon color="teal" size="sm">
                  <IconPlayerPlay size={14} />
                </ThemeIcon>
                <Text fw={700} size="sm">
                  3. Process & Population
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Run CAT12 structural segmentation, ASL quantification, and population ROI
                statistics.
              </Text>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 3 }}>
            <Card
              p="sm"
              radius="sm"
              style={{
                backgroundColor: "var(--mantine-color-orange-light)",
                borderLeft: "4px solid var(--mantine-color-orange-filled)",
                height: "100%",
              }}
            >
              <Group gap="xs" mb={8}>
                <ThemeIcon color="orange" size="sm">
                  <IconChartDots size={14} />
                </ThemeIcon>
                <Text fw={700} size="sm">
                  4. Visualize Dataset
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                [Future Feature] Explore interactive scatterplots and swarmplots with WebGL volume
                rendering.
              </Text>
            </Card>
          </Grid.Col>
        </Grid>
      </Card>

      <Divider />

      {/* DETAILED WORKFLOW BREAKDOWN */}
      <Stack gap="xl">
        {/* STEP 1: IMPORT FROM DICOM */}
        <Stack gap="md" data-testid="section-import">
          <Group gap="xs">
            <ThemeIcon color="blue" size="lg" radius="xl">
              <IconDatabase size={20} />
            </ThemeIcon>
            <Title order={2} component="h1">
              1. Import from DICOM
            </Title>
            <Badge color="blue" variant="outline">
              Phase 1
            </Badge>
          </Group>
          <Text size="sm">
            Translating raw MRI scanner outputs into structured BIDS (Brain Imaging Data Structure)
            formats. The process breaks down into several automated and user-guided sub-steps:
          </Text>

          <Accordion variant="separated" data-testid="import-accordion">
            <Accordion.Item value="ingest">
              <Accordion.Control
                icon={<IconDatabase size={16} color="var(--mantine-color-blue-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  1.1 Ingest DICOMs (DICOM to NIfTI)
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  The GUI scans the raw project folders to identify all available DICOM series.
                  ExploreASL converts raw multi-slice DICOM datasets into single or 4D NIfTI
                  (Neuroimaging Informatics Technology Initiative) image files (`.nii` or
                  `.nii.gz`).
                </Text>
                <Text size="xs" c="dimmed">
                  This consolidates thousands of separate medical slices into individual volumes,
                  simplifying file management and speeding up processing.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="tokenize">
              <Accordion.Control
                icon={<IconRoute size={16} color="var(--mantine-color-blue-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  1.2 Tokenize Paths (NIfTI to BIDS)
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Map the directory segments of your raw data paths to BIDS categories like Subject,
                  Session, Run, and Modality.
                </Text>
                <Text size="xs" c="dimmed">
                  Since different scanners and labs organize directories differently (e.g.,
                  `Project/Subject_01/Visit_A/ASL` vs `Project/Visit_A/Subject_01/T1`), this step
                  tells the GUI how to parse folder names using a regular expression generator
                  behind the scenes.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="aliases">
              <Accordion.Control
                icon={<IconTags size={16} color="var(--mantine-color-blue-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  1.3 Resolve Aliases
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Map irregular or non-standard subject names, visit labels, or modality strings
                  into standardized names.
                </Text>
                <Text size="xs" c="dimmed">
                  For example, if your folder contains "visit1", "V1", or "baseline", you can map
                  them all to the standard BIDS session alias "01".
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="metadata">
              <Accordion.Control
                icon={<IconFileImport size={16} color="var(--mantine-color-blue-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  1.4 Configure BIDS Metadata (Defacing)
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Specify important acquisition parameters (e.g., Post-Labeling Delay, Labeling
                  Duration, M0 calibration type) and choose whether to apply structural defacing.
                </Text>
                <Text size="xs" c="dimmed">
                  Defacing strips identifiable facial features from structural MRIs to comply with
                  participant privacy regulations before exporting or publishing.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="preview">
              <Accordion.Control
                icon={<IconEye size={16} color="var(--mantine-color-blue-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  1.5 Preview Import
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Review the mapping summary. The screen displays a grid showing each raw file path
                  and its planned BIDS destination file path.
                </Text>
                <Text size="xs" c="dimmed">
                  This sanity check ensures that you don't accidentally mix up subject IDs or
                  overwrite existing scans before writing files to disk.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="execution">
              <Accordion.Control
                icon={<IconPlayerPlay size={16} color="var(--mantine-color-blue-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  1.6 Run Import Module (BIDS to ExploreASL Legacy)
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Execute the import process. ExploreASL runs the mapping scripts, moves files into
                  the BIDS directory tree, and compiles the project structure.
                </Text>
                <Text size="xs" c="dimmed">
                  During this, raw BIDS structure is matched with the legacy ExploreASL format
                  (`[Subject]/[Visit]/[Session]/[Scan]`) internally to ensure complete compatibility
                  with ExploreASL's MATLAB processing engine.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>

        <Divider />

        {/* STEP 2: DEFINE DATA PARAMETERS */}
        <Stack gap="md" data-testid="section-parameters">
          <Group gap="xs">
            <ThemeIcon color="grape" size="lg" radius="xl">
              <IconAdjustments size={20} />
            </ThemeIcon>
            <Title order={2} component="h1">
              2. Define Data Parameters
            </Title>
            <Badge color="grape" variant="outline">
              Phase 2
            </Badge>
          </Group>
          <Text size="sm">
            ExploreASL relies on a `dataPar.json` parameter configuration file to customize the
            processing engine to your cohort.
          </Text>

          <Accordion variant="separated" data-testid="parameters-accordion">
            <Accordion.Item value="options">
              <Accordion.Control
                icon={<IconRoute size={16} color="var(--mantine-color-grape-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  2.1 Define Processing Options
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Set baseline parameters such as magnetic field strength (e.g., 3.0T), patient age
                  presets (adult vs. pediatric), and CAT12 structural segmentation parameters.
                </Text>
                <Text size="xs" c="dimmed">
                  Selecting correct baseline settings ensures that tissues (Grey Matter, White
                  Matter, CSF) are segmented with appropriate tissue priors.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="quirks">
              <Accordion.Control
                icon={<IconHelpCircle size={16} color="var(--mantine-color-grape-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  2.2 Specify ASL / M0 Quirks
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Configure special options for Arterial Spin Labeling scans, including
                  quantification scales, slice gradient corrections, and M0 calibration settings.
                </Text>
                <Text size="xs" c="dimmed">
                  This handles scanner-specific quirks (e.g. whether the M0 calibration is stored in
                  the same series, scaled differently, or needs separate background suppression
                  correction).
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="presets">
              <Accordion.Control
                icon={<IconTags size={16} color="var(--mantine-color-grape-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  2.3 Cohort Presets
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Save your settings configuration as a reusable template or choose from built-in
                  presets (e.g. Standard 3D PCASL, Siemens Product Sequence, GE 3D Spiral).
                </Text>
                <Text size="xs" c="dimmed">
                  Presets ensure standard parameters are applied identically across multi-center or
                  long-term studies.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>

        <Divider />

        {/* STEP 3: PROCESS IMAGES & RUN POPULATION */}
        <Stack gap="md" data-testid="section-processing">
          <Group gap="xs">
            <ThemeIcon color="teal" size="lg" radius="xl">
              <IconBrain size={20} />
            </ThemeIcon>
            <Title order={2} component="h1">
              3. Process Images & Population Module
            </Title>
            <Badge color="teal" variant="outline">
              Phase 3
            </Badge>
          </Group>
          <Text size="sm">
            This is the core computational engine. ExploreASL runs three sequentially dependent
            modules to process individual scans and perform group-level statistics.
          </Text>

          <Accordion variant="separated" data-testid="processing-accordion">
            <Accordion.Item value="structural">
              <Accordion.Control
                icon={<IconBrain size={16} color="var(--mantine-color-teal-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  3.1 Structural Module (T1w/CAT12)
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Processes the high-resolution T1-weighted structural scan.
                </Text>
                <Text fw={700} size="xs" c="teal" mb={4}>
                  Sub-steps:
                </Text>
                <div style={{ fontSize: "0.875rem" }}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      <strong>WMH Correction:</strong> Corrects for White Matter Hyperintensities to
                      prevent misclassification of tissues.
                    </li>
                    <li>
                      <strong>Segmentation:</strong> Segments the brain tissue into Grey Matter,
                      White Matter, and Cerebrospinal Fluid (CSF) using the CAT12/SPM12 engine.
                    </li>
                    <li>
                      <strong>Spatial Normalization:</strong> Warps the individual brain scan to
                      match the standard MNI152 template space.
                    </li>
                  </ul>
                </div>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="asl">
              <Accordion.Control
                icon={<IconPlayerPlay size={16} color="var(--mantine-color-teal-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  3.2 ASL Module (Perfusion/CBF)
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Processes the 4D Arterial Spin Labeling scans to calculate Cerebral Blood Flow
                  (CBF).
                </Text>
                <Text fw={700} size="xs" c="teal" mb={4}>
                  Sub-steps:
                </Text>
                <div style={{ fontSize: "0.875rem" }}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      <strong>Motion Correction:</strong> Aligns the multi-volume ASL time-series to
                      correct for participant movement.
                    </li>
                    <li>
                      <strong>Outlier Exclusion:</strong> Detects and discards individual volumes
                      corrupted by sudden motion spikes.
                    </li>
                    <li>
                      <strong>Registration:</strong> Co-registers the ASL perfusion images to the
                      high-resolution structural T1w scan.
                    </li>
                    <li>
                      <strong>M0 Processing:</strong> Computes and normalizes the M0 calibration
                      scan (equilibrium magnetization) to scale the signal.
                    </li>
                    <li>
                      <strong>Quantification:</strong> Applies kinetic models to calculate raw CBF
                      maps in physiological units (mL/100g/min).
                    </li>
                    <li>
                      <strong>PVC (Partial Volume Correction):</strong> Adjusts CBF values to
                      correct for tissue mixture/atrophy effects.
                    </li>
                    <li>
                      <strong>Mask Creation:</strong> Builds brain masks and grey matter masks to
                      isolate valid perfusion areas.
                    </li>
                  </ul>
                </div>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="population">
              <Accordion.Control
                icon={<IconTags size={16} color="var(--mantine-color-teal-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  3.3 Population Module (Group Stats & QC)
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Aggregates findings across the entire cohort to enable statistical group
                  comparisons.
                </Text>
                <Text fw={700} size="xs" c="teal" mb={4}>
                  Sub-steps:
                </Text>
                <div style={{ fontSize: "0.875rem" }}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      <strong>Template Creation:</strong> Builds study-specific average perfusion
                      and structural templates.
                    </li>
                    <li>
                      <strong>Multi-sequence Equalization:</strong> Normalizes signal intensity
                      across subjects to correct for scanner drift or coil differences.
                    </li>
                    <li>
                      <strong>ROI Statistics:</strong> Extracts mean CBF values from anatomical
                      regions of interest (e.g. Hippocampus, Frontal Lobe) based on standardized
                      atlases.
                    </li>
                    <li>
                      <strong>Quality Control:</strong> Computes spatial Coefficient of Variation
                      (sCoV) and temporal SNR metrics to flag poor scans.
                    </li>
                  </ul>
                </div>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>

        <Divider />

        {/* STEP 4: INTERACTIVE DATASET VISUALIZATION */}
        <Stack gap="md" data-testid="section-visualization">
          <Group gap="xs">
            <ThemeIcon color="orange" size="lg" radius="xl">
              <IconChartDots size={20} />
            </ThemeIcon>
            <Title order={2} component="h1">
              4. Interactive Dataset Visualization [Future Feature]
            </Title>
            <Badge color="orange" variant="outline">
              Phase 4
            </Badge>
          </Group>
          <Text size="sm">
            Once processing is completed, you will be able to interactively explore your study
            outcomes within the GUI:
          </Text>

          <Accordion variant="separated" data-testid="visualization-accordion">
            <Accordion.Item value="charts">
              <Accordion.Control
                icon={<IconChartDots size={16} color="var(--mantine-color-orange-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  4.1 Scatterplots & Swarmplots
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Filter and plot ROI CBF results against clinical parameters (e.g., Age, Cognitive
                  Score) using dynamic, interactive charts.
                </Text>
                <Text size="xs" c="dimmed">
                  Categorical variables (e.g., patient group, genotype) will render as Swarmplots,
                  while continuous variables will plot as Scatterplots with fit-lines.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="webgl">
              <Accordion.Control
                icon={<IconBrain size={16} color="var(--mantine-color-orange-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  4.2 WebGL Volume Renders
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Click directly on any subject's data point in the plot to immediately load
                  three-dimensional WebGL volume renders of their CBF and T1w scans.
                </Text>
                <Text size="xs" c="dimmed">
                  This lets you inspect outlier subjects visually in real-time, verifying whether
                  their high or low CBF values represent pathology or processing artifacts.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>
      </Stack>
    </Stack>
  );
}
