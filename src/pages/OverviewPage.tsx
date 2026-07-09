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
  Tooltip,
} from "@mantine/core";
import {
  IconAdjustments,
  IconArrowLeft,
  IconBrain,
  IconBug,
  IconChartDots,
  IconCheck,
  IconCopy,
  IconDatabase,
  IconExclamationMark,
  IconExternalLink,
  IconEye,
  IconFileImport,
  IconFileReport,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconHelpCircle,
  IconListCheck,
  IconPlayerPlay,
  IconPlus,
  IconRoute,
  IconSettings,
  IconTags,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

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
  const location = useLocation();
  const fromPath = location.state?.from;
  const isFromProject = fromPath && fromPath !== "/" && fromPath !== "/overview";
  const [bibtexCopied, setBibtexCopied] = useState(false);
  const [resolvedDevLog, setResolvedDevLog] = useState<string>("");
  const [resolvedReleaseLogDir, setResolvedReleaseLogDir] = useState<string>("");

  useEffect(() => {
    let active = true;
    async function fetchPaths() {
      try {
        const { tempDir, appDataDir, join } = await import("@tauri-apps/api/path");
        const temp = await tempDir();
        const appData = await appDataDir();
        const devPath = await join(temp, "exploreasl-gui-logs", "dev.log");
        const releaseDir = await join(appData, "logs");
        if (active) {
          setResolvedDevLog(devPath);
          setResolvedReleaseLogDir(releaseDir);
        }
      } catch (e) {
        console.warn("Failed to resolve log paths dynamically:", e);
      }
    }
    void fetchPaths();
    return () => {
      active = false;
    };
  }, []);

  const bibtexEntry = `@article{mutsaerts2020exploreasl-a04, 
  year     = {2020}, 
  keywords = {{ASL}, Processing, Software}, 
  title    = {{ExploreASL}: An image processing pipeline for multi-center {ASL} perfusion {MRI} studies}, 
  author   = {Mutsaerts, Henk J.M.M. and Petr, Jan and Groot, Paul and Vandemaele, Pieter and Ingala, Silvia and Robertson, Andrew D. and V\\'a\\clav\\u{}, Lena and Groote, Inge and Kuijf, Hugo and Zelaya, Fernando and O'Daly, Owen and Hilal, Saima and Wink, Alle Meije and Kant, Ilse and Caan, Matthan W.A. and Morgan, Catherine and Bresser, Jeroen de and Lysvik, Elisabeth and Schrantee, Anouk and Bj\\o rnebekk, Astrid and Clement, Patricia and Shirzadi, Zahra and Kuijer, Joost P.A. and Wottschel, Viktor and Anazodo, Udunna C. and Pajkrt, Dasja and Richard, Edo and Bokkers, Reinoud P.H. and Reneman, Liesbeth and Masellis, Mario and G\\u nther, Matthias and {MacIntosh}, Bradley J. and Achten, Eric and Chappell, Michael A. and Osch, Matthias J.P. van and Golay, Xavier and Thomas, David L. and Vita, Enrico De and Bj\\o rnerud, Atle and Nederveen, Aart and Hendrikse, Jeroen and Asllani, Iris and Barkhof, Frederik}, 
  journal  = {{NeuroImage}}, 
  issn     = {1053-8119}, 
  doi      = {10.1016/j.neuroimage.2020.117031}, 
  pmid     = {32526385}, 
  pages    = {117031}, 
  volume   = {219}
}`;

  const handleCopyBibtex = async () => {
    await navigator.clipboard.writeText(bibtexEntry);
    setBibtexCopied(true);
    setTimeout(() => setBibtexCopied(false), 2000);
  };

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
          onClick={() => navigate(isFromProject ? fromPath : "/")}
          data-testid="overview-back-btn"
        >
          {isFromProject ? "Back to Project" : "Back to Home"}
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
        <Grid mt="sm" gap="xs">
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

      {/* Prerequisites & Setup Section */}
      <Stack gap="md" data-testid="section-prerequisites">
        <Group gap="xs">
          <ThemeIcon color="blue" size="lg" radius="xl">
            <IconSettings size={20} />
          </ThemeIcon>
          <Title order={2} component="h1">
            Prerequisites & Setup
          </Title>
        </Group>
        <Text size="sm">
          Before using ExploreASL GUI, you need two pieces of software installed on your machine:{" "}
          <strong>MATLAB</strong> and <strong>ExploreASL</strong>. Follow the steps below in order.
        </Text>

        <Alert
          color="teal"
          title="Detailed Installation Tutorial"
          icon={<IconHelpCircle size={18} />}
          data-testid="install-tutorial-callout"
        >
          <Text size="sm">
            The ExploreASL team maintains a step-by-step installation guide with screenshots:{" "}
            <Text
              component="a"
              href="https://exploreasl.github.io/Documentation/latest/Tutorials-Install/"
              target="_blank"
              rel="noopener noreferrer"
              c="blue"
              size="sm"
            >
              exploreasl.github.io/Documentation/latest/Tutorials-Install
              <IconExternalLink size={12} style={{ marginLeft: 4, verticalAlign: "middle" }} />
            </Text>
          </Text>
        </Alert>

        <Accordion variant="separated" data-testid="prerequisites-accordion">
          <Accordion.Item value="matlab">
            <Accordion.Control
              icon={<IconSettings size={16} color="var(--mantine-color-blue-filled)" />}
            >
              <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                Step 1 — Install MATLAB
              </Title>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" mb="xs">
                MATLAB is commercial software from MathWorks. You need{" "}
                <strong>R2019a or later</strong> (R2023b or newer recommended). No additional
                toolboxes are required for ExploreASL.
              </Text>
              <Text size="sm" component="div" mb="xs">
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  <li>
                    Go to{" "}
                    <Text
                      component="a"
                      href="https://www.mathworks.com/downloads/"
                      target="_blank"
                      rel="noopener noreferrer"
                      c="blue"
                      size="sm"
                    >
                      mathworks.com/downloads
                      <IconExternalLink
                        size={12}
                        style={{ marginLeft: 4, verticalAlign: "middle" }}
                      />
                    </Text>{" "}
                    and sign in with your MathWorks account.
                  </li>
                  <li>
                    If you do not have an account, check with your institution — many universities
                    and hospitals provide campus MATLAB licenses.
                  </li>
                  <li>
                    Download and run the installer for your operating system (Windows, macOS, or
                    Linux).
                  </li>
                  <li>
                    When prompted, select <strong>R2019a or later</strong>. You do not need any
                    additional toolboxes.
                  </li>
                  <li>
                    Complete the installation and launch MATLAB once to confirm it opens without
                    errors.
                  </li>
                </ol>
              </Text>
              <Alert color="blue" title="Already have MATLAB?" variant="light" mt="xs">
                <Text size="xs">
                  You can check your version by opening MATLAB and typing <code>version</code> in
                  the command window. Any version from R2019a onward will work.
                </Text>
              </Alert>
              <Text size="xs" c="dimmed" mt="xs">
                MATLAB is only needed to run the processing pipeline. The GUI itself does not
                require MATLAB to open.
              </Text>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="exploreasl-download">
            <Accordion.Control
              icon={<IconFolder size={16} color="var(--mantine-color-blue-filled)" />}
            >
              <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                Step 2 — Download ExploreASL
              </Title>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" mb="xs">
                ExploreASL is a free, open-source MATLAB toolbox hosted on GitHub. You need version{" "}
                <strong>v11.1.0 or later</strong> (the <code>develop</code> branch / v2+ is
                preferred).
              </Text>

              <Text fw={700} size="sm" mb={4}>
                Option A — Download ZIP (no Git required):
              </Text>
              <Text size="sm" component="div" mb="xs">
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  <li>
                    Go to{" "}
                    <Text
                      component="a"
                      href="https://github.com/ExploreASL/ExploreASL"
                      target="_blank"
                      rel="noopener noreferrer"
                      c="blue"
                      size="sm"
                    >
                      github.com/ExploreASL/ExploreASL
                      <IconExternalLink
                        size={12}
                        style={{ marginLeft: 4, verticalAlign: "middle" }}
                      />
                    </Text>
                    .
                  </li>
                  <li>
                    Near the top of the page, find the dropdown button that says{" "}
                    <strong>main</strong>. Click it and select <strong>develop</strong> — this is
                    the recommended version.
                  </li>
                  <li>
                    Click the green <strong>{"<> Code"}</strong> button, then select{" "}
                    <strong>Download ZIP</strong>.
                  </li>
                  <li>
                    Extract the ZIP file:
                    <ul style={{ margin: "4px 0 0 0", paddingLeft: 20 }}>
                      <li>
                        <strong>Windows:</strong> Right-click the downloaded <code>.zip</code> file
                        and select <strong>Extract All…</strong>, then click{" "}
                        <strong>Extract</strong>. Move the extracted folder to a location like{" "}
                        <code>C:\ExploreASL</code>.
                      </li>
                      <li>
                        <strong>macOS:</strong> Double-click the <code>.zip</code> file (Safari
                        extracts it automatically). Move the resulting folder to your home folder
                        (the folder with your username).
                      </li>
                      <li>
                        <strong>Linux:</strong> Right-click and select <strong>Extract Here</strong>
                        , or run <code>unzip ExploreASL-develop.zip</code> in a terminal.
                      </li>
                    </ul>
                  </li>
                </ol>
              </Text>

              <Text fw={700} size="sm" mb={4}>
                Option B — Clone with Git:
              </Text>
              <Text size="sm" component="div" mb="xs">
                If you are comfortable with the command line:
                <Card
                  withBorder
                  p="xs"
                  mt={4}
                  bg="var(--mantine-color-gray-0)"
                  radius="sm"
                  style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
                >
                  git clone --branch develop https://github.com/ExploreASL/ExploreASL.git
                </Card>
              </Text>

              <Alert
                color="yellow"
                title="Avoid cloud-synced folders"
                icon={<IconExclamationMark size={16} />}
                mt="xs"
              >
                <Text size="xs">
                  Do not place ExploreASL inside a cloud-synced folder (OneDrive, Dropbox, Google
                  Drive, iCloud). Cloud sync can corrupt files during processing. If your Desktop or
                  Documents folder is synced to the cloud, choose a different location.
                </Text>
              </Alert>

              <Alert color="blue" title="Don't move it later" variant="light" mt="xs">
                <Text size="xs">
                  Once you have configured the GUI to use this folder, do not move or rename it. The
                  GUI remembers the path and will need to be updated if the folder is relocated.
                </Text>
              </Alert>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="exploreasl-configure">
            <Accordion.Control
              icon={<IconRoute size={16} color="var(--mantine-color-blue-filled)" />}
            >
              <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                Step 3 — Tell the GUI Where ExploreASL Is
              </Title>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" mb="xs">
                When you first launch ExploreASL GUI, it will ask you to locate your ExploreASL
                installation folder. Navigate to the folder you extracted or cloned in Step 2 — it
                should be named <code>ExploreASL</code> (or <code>ExploreASL-develop</code>) and
                contain a file called <code>ExploreASL.m</code> inside it.
              </Text>
              <Text size="xs" c="dimmed">
                You can change this path at any time from the GUI's global settings.
              </Text>
              <Alert
                color="yellow"
                title="Hospital or institutional users"
                icon={<IconExclamationMark size={16} />}
                mt="xs"
              >
                <Text size="xs">
                  Your IT department may restrict running unsigned software or limit MATLAB network
                  licensing. Contact your IT support if you encounter permission or licensing
                  errors.
                </Text>
              </Alert>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>

      <Divider />

      {/* Project Management Section */}
      <Stack gap="md" data-testid="section-project-management">
        <Group gap="xs">
          <ThemeIcon color="teal" size="lg" radius="xl">
            <IconFolder size={20} />
          </ThemeIcon>
          <Title order={2} component="h1">
            Project Management
          </Title>
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

        <Alert
          color="grape"
          title="Citation Required"
          icon={<IconExclamationMark size={18} />}
          mt="md"
          data-testid="exploreasl-citation-callout"
        >
          <Text size="sm" mb="xs">
            If you use ExploreASL in your work, please reference the release paper:
          </Text>
          <Text size="xs" mb="xs">
            Mutsaerts, H. J. M. M. et al. ExploreASL: An image processing pipeline for multi-center
            ASL perfusion MRI studies. <em>NeuroImage</em> 219, 117031 (2020).
          </Text>
          <Group gap="xs">
            <Text
              component="a"
              href="https://pubmed.ncbi.nlm.nih.gov/32526385/"
              target="_blank"
              rel="noopener noreferrer"
              c="blue"
              size="xs"
            >
              PubMed
            </Text>
            <Text size="xs" c="dimmed">
              |
            </Text>
            <Text
              component="a"
              href="https://doi.org/10.1016/j.neuroimage.2020.117031"
              target="_blank"
              rel="noopener noreferrer"
              c="blue"
              size="xs"
            >
              DOI
            </Text>
          </Group>
          <Tooltip label={bibtexCopied ? "Copied!" : "Copy BibTeX to clipboard"} withArrow>
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={bibtexCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              onClick={handleCopyBibtex}
              mt="xs"
              color={bibtexCopied ? "teal" : "gray"}
              data-testid="copy-bibtex-btn"
            >
              {bibtexCopied ? "Copied!" : "Copy BibTeX"}
            </Button>
          </Tooltip>
        </Alert>
      </Stack>

      <Divider />

      {/* Troubleshooting & Debugging */}
      <Stack gap="md" data-testid="section-troubleshooting">
        <Group gap="xs">
          <ThemeIcon color="orange" size="lg" radius="xl">
            <IconBug size={20} />
          </ThemeIcon>
          <Title order={2} component="h1">
            Troubleshooting & Debugging
          </Title>
        </Group>
        <Text size="sm">
          If you encounter issues, errors, or unexpected behavior while using the GUI, several
          built-in debugging features are available to help you diagnose the problem or share
          diagnostic info with developers/AI coding assistants.
        </Text>
        <Accordion variant="separated" data-testid="troubleshooting-accordion">
          <Accordion.Item value="shortcuts">
            <Accordion.Control
              icon={<IconCopy size={16} color="var(--mantine-color-orange-filled)" />}
            >
              <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                Capturing State Snapshots (Ctrl+Shift+D)
              </Title>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" mb="xs">
                Pressing <strong>Ctrl+Shift+D</strong> anywhere in the application will
                automatically capture a diagnostic snapshot of the application state and copy it to
                your clipboard.
              </Text>
              <Text size="sm" mb="xs">
                This snapshot includes a JSON report of:
              </Text>
              <div style={{ fontSize: "0.875rem" }}>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>The active route (current screen).</li>
                  <li>
                    Contents of the global settings store and project metadata store (including
                    import and processing settings).
                  </li>
                  <li>A rolling action replay log of recent events.</li>
                  <li>System details like your user agent.</li>
                </ul>
              </div>
              <Text size="sm" mt="xs">
                You can paste this JSON snapshot directly into a bug report or share it with an AI
                assistant to help reconstruct the exact application state.
              </Text>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="logs">
            <Accordion.Control
              icon={<IconFileText size={16} color="var(--mantine-color-orange-filled)" />}
            >
              <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                Accessing Log Files
              </Title>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" mb="xs">
                The application writes detailed execution logs (including command tracing,
                stdout/stderr from MATLAB, and frontend console outputs) to disk.
              </Text>
              <Text size="sm" component="div">
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>
                    <strong>Development Mode:</strong> Logs are stored in your OS temporary
                    directory:{" "}
                    {resolvedDevLog ? (
                      <code style={{ wordBreak: "break-all" }}>{resolvedDevLog}</code>
                    ) : (
                      <code style={{ wordBreak: "break-all" }}>
                        &lt;OS_TEMP_DIR&gt;/exploreasl-gui-logs/dev.log
                      </code>
                    )}
                  </li>
                  <li>
                    <strong>Release Mode:</strong> Logs are stored in the standard OS application
                    data directory for the GUI app:{" "}
                    {resolvedReleaseLogDir ? (
                      <code style={{ wordBreak: "break-all" }}>{resolvedReleaseLogDir}</code>
                    ) : (
                      <code style={{ wordBreak: "break-all" }}>&lt;APP_DATA_DIR&gt;/logs/</code>
                    )}
                  </li>
                </ul>
              </Text>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="error-boundary">
            <Accordion.Control
              icon={<IconExclamationMark size={16} color="var(--mantine-color-orange-filled)" />}
            >
              <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                React Crashes & Error Boundary
              </Title>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm">
                If a critical rendering error occurs in the user interface, the GUI will show a
                fallback crash screen. Click the <strong>"Copy error report"</strong> button on that
                screen to copy the error stack trace to your clipboard to paste into a bug report.
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
        <Grid gap="md" align="stretch" data-testid="workflow-map-grid">
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
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

          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
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

          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
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
                  3. Process
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Run CAT12 structural segmentation, ASL quantification, and population ROI
                statistics.
              </Text>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
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
                Explore interactive scatterplots and swarmplots with WebGL volume rendering of
                individual subject CBF maps.
              </Text>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
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
                  <IconFileReport size={14} />
                </ThemeIcon>
                <Text fw={700} size="sm">
                  5. Manifest
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Triage subject-sessions as Pass or Fail, then export a journal-ready reproducibility
                manifest (Markdown / HTML) for publication.
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
                  The primary purpose of this step is to understand where the DICOM raw data is
                  located and how it is organized. The GUI scans the raw project folders to identify
                  all available DICOM series. ExploreASL converts raw multi-slice DICOM datasets
                  into single or 4D NIfTI (Neuroimaging Informatics Technology Initiative) image
                  files (`.nii` or `.nii.gz`).
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
                  1.4 Metadata (ASL Acquisition Parameters)
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  The primary purpose of this step is to specify the acquisition parameters for the
                  collection of ASL scans that were ingested in the previous step (e.g.,
                  Post-Labeling Delay, Labeling Duration, M0 calibration type) and choose whether to
                  apply structural defacing.
                </Text>
                <Text size="sm" mb="xs">
                  By default, there is assumed to be a single acquisition scheme implemented in the
                  project (i.e., single site, single scanner, single protocol). However, additional
                  acquisition scheme overrides can be specified to account for multi-site,
                  multi-scanner, or multi-protocol combinations, and subjects/sessions can be
                  assigned to these overrides.
                </Text>
                <Alert
                  color="yellow"
                  title="Unsure about acquisition parameters?"
                  icon={<IconHelpCircle size={16} />}
                  mt="xs"
                >
                  <Text size="xs">
                    If you are unsure about your ASL acquisition parameters, contact your local MR
                    physicist or technician. If you cannot access one, you can use{" "}
                    <Text
                      component="a"
                      href="https://dicom.offis.de/en/dcmtk/dcmtk-tools/"
                      target="_blank"
                      rel="noopener noreferrer"
                      c="blue"
                      size="xs"
                    >
                      DCMTK command line tools
                    </Text>{" "}
                    to view the DICOM headers and note down the acquisition parameters.
                  </Text>
                </Alert>
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
                  Review the mapping summary. The GUI uses a pre-planned staging directory layout
                  which will be temporarily created at{" "}
                  <code>&lt;project_root&gt;/.easl_staging/</code>. The screen displays a grid
                  showing each raw file path and its planned staging destination.
                </Text>
                <Text size="xs" c="dimmed" mb="xs">
                  This sanity check ensures that you don't accidentally mix up subject IDs or
                  overwrite existing scans before writing files to disk.
                </Text>
                <Alert
                  color="blue"
                  title="Tip"
                  variant="light"
                  icon={<IconHelpCircle size={16} />}
                  mt="xs"
                >
                  <Text size="xs">
                    While the <code>.easl_staging/</code> directory is usually automatically deleted
                    after the import, it can be preserved by enabling the{" "}
                    <strong>"Preserve staging directory"</strong> global setting.
                  </Text>
                </Alert>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="execution">
              <Accordion.Control
                icon={<IconPlayerPlay size={16} color="var(--mantine-color-blue-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  1.6 Run Import Module
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  This executes the ExploreASL import module and provides user feedback based on:
                </Text>
                <div style={{ fontSize: "0.875rem" }}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      A table of the subjects being imported, their status (pending, running,
                      completed, failed), and the ability to view subject-specific logs once the
                      import is complete.
                    </li>
                    <li>
                      A real-time log of the import process forwarded from the behind-the-scenes
                      MATLAB process.
                    </li>
                  </ul>
                </div>
                <Text size="sm" mt="xs" mb="xs">
                  ExploreASL will create the BIDS structure in the{" "}
                  <code>&lt;project_root&gt;/rawdata/</code> directory.
                </Text>
                <Text size="xs" c="dimmed" mb="xs">
                  During this, raw BIDS structure is matched with the legacy ExploreASL format
                  (`[Subject]/[Visit]/[Session]/[Scan]`) internally to ensure complete compatibility
                  with ExploreASL's MATLAB processing engine.
                </Text>
                <Alert
                  color="blue"
                  title="Tip"
                  variant="light"
                  icon={<IconHelpCircle size={16} />}
                  mt="xs"
                >
                  <Text size="xs">
                    For debugging purposes, the GUI generates a{" "}
                    <code>&lt;project_root&gt;/derivatives/ExploreASL_GUI/</code> directory that
                    contains the <code>sourcestructure.json</code> and <code>studyPar.json</code>{" "}
                    files used during the import.
                  </Text>
                </Alert>
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
          </Group>
          <Text size="sm">
            This is fundamentally where the global settings are defined regarding how ExploreASL
            will process this dataset. ExploreASL relies on a `dataPar.json` parameter configuration
            file to customize the processing engine to your cohort.
          </Text>

          <Accordion variant="separated" data-testid="parameters-accordion">
            <Accordion.Item value="options">
              <Accordion.Control
                icon={<IconRoute size={16} color="var(--mantine-color-grape-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  2.1 Basic Processing Options
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Configure the fundamental parameters that govern how ExploreASL processes your
                  dataset. These include settings such as the processing quality level, the fallback
                  M0 behavior when no dedicated M0 calibration scan is available, and atlas
                  selection for extracting ROI (Region of Interest) CBF data.
                </Text>
                <Text size="xs" c="dimmed">
                  Selecting correct baseline settings ensures consistent and appropriate processing
                  across all subjects in your cohort.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="advanced">
              <Accordion.Control
                icon={<IconAdjustments size={16} color="var(--mantine-color-grape-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  2.2 Advanced Settings
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Fine-tune the ASL processing pipeline with advanced options. These include
                  controlling the ASL modeling assumptions (see the{" "}
                  <Text
                    component="a"
                    href="https://pubmed.ncbi.nlm.nih.gov/24715426/"
                    target="_blank"
                    rel="noopener noreferrer"
                    c="blue"
                    size="sm"
                  >
                    ASL consensus paper
                  </Text>
                  ), partial volume correction (PVC) methods to account for tissue mixture effects,
                  and specifics of the registration algorithms employed between structural T1w and
                  ASL modalities.
                </Text>
                <Text size="xs" c="dimmed">
                  Advanced settings are typically adjusted by experienced users or when processing
                  data with non-standard acquisition protocols.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>

        <Divider />

        {/* STEP 3: PROCESS SUBJECTS & RUN POPULATION */}
        <Stack gap="md" data-testid="section-processing">
          <Group gap="xs">
            <ThemeIcon color="teal" size="lg" radius="xl">
              <IconBrain size={20} />
            </ThemeIcon>
            <Title order={2} component="h1">
              3. Process Images & Population Module
            </Title>
          </Group>
          <Text size="sm">
            This is the core computational engine. ExploreASL runs three sequentially dependent
            modules to process individual scans and perform group-level statistics.
          </Text>

          <Text size="sm" fw={600} mt="xs">
            GUI Processing Features:
          </Text>
          <div style={{ fontSize: "0.875rem" }}>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>
                <strong>Multiprocessing:</strong> Run multiple subjects in parallel to significantly
                reduce total processing time.
              </li>
              <li>
                <strong>Subject/Session Logs & Errors:</strong> View detailed logs and error
                messages at the subject and session level for better understanding of what went
                wrong during processing.
              </li>
              <li>
                <strong>Image Reports:</strong> Access subject and session level image reports
                showing registration and segmentation outcomes for immediate QC (Quality Control)
                assessment.
              </li>
            </ul>
          </div>

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
              4. Interactive Dataset Visualization
            </Title>
          </Group>
          <Text size="sm">
            Once processing is completed, you can interactively explore your study outcomes within
            the GUI:
          </Text>

          <Accordion variant="separated" data-testid="visualization-accordion">
            <Accordion.Item value="data-contract">
              <Accordion.Control
                icon={<IconFileText size={16} color="var(--mantine-color-orange-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  4.0 Data Contract (Column Type Configuration)
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  Before visualization, the GUI presents a preliminary "data contract" series of
                  steps to ensure proper data interpretation. This includes specifying whether each
                  variable is continuous, nominal, or ordinal, and defining the ordering of levels
                  for categorical variables.
                </Text>
                <Text size="xs" c="dimmed">
                  Correctly classifying variables ensures that charts render appropriately (e.g.,
                  scatterplots for continuous data, swarmplots for categorical data) and that
                  statistical comparisons are valid.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

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
                  Filter and plot ROI results against clinical parameters using dynamic, interactive
                  charts. Categorical variables (e.g., patient group, genotype) render as
                  Swarmplots, while continuous variables plot as Scatterplots with fit-lines.
                </Text>
                <Text size="xs" c="dimmed" mb="xs">
                  Currently, the available variables are restricted to those provided by ExploreASL:
                  mean, median, and CoV (Coefficient of Variation) CBF regional measures; structural
                  wholebrain GM/WM/CSF measures; and subject/session designation.
                </Text>
                <Alert
                  color="orange"
                  title="Upcoming Feature"
                  variant="light"
                  icon={<IconExclamationMark size={16} />}
                  mt="xs"
                >
                  <Text size="xs">
                    Merging with <code>participants.tsv</code> or external spreadsheets for
                    additional clinical variables will be an upcoming feature, but is not currently
                    implemented.
                  </Text>
                </Alert>
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
                  three-dimensional WebGL volume renders of their CBF scans.
                </Text>
                <Text size="xs" c="dimmed">
                  This lets you inspect outlier subjects visually in real-time, verifying whether
                  their high or low CBF values represent pathology or processing artifacts.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>

        <Divider />

        {/* STEP 5: PROJECT MANIFEST */}
        <Stack gap="md" data-testid="section-manifest">
          <Group gap="xs">
            <ThemeIcon color="teal" size="lg" radius="xl">
              <IconFileReport size={20} />
            </ThemeIcon>
            <Title order={2} component="h1">
              5. Project Manifest
            </Title>
          </Group>
          <Text size="sm">
            After Population completes, journals like <em>NeuroImage</em>,{" "}
            <em>Human Brain Mapping</em>, and other neuroimaging venues increasingly require authors
            to document their analysis pipeline, software versions, and cohort-level quality control
            decisions. The Manifest module generates this documentation automatically from your
            ExploreASL project — no manual write-up needed.
          </Text>

          <Alert
            color="teal"
            title="Why a Manifest?"
            icon={<IconFileReport size={18} />}
            data-testid="manifest-why-callout"
          >
            <Text size="sm">
              Reproducibility is a central requirement of modern neuroimaging research. Reviewers
              and data-sharing repositories expect a clear record of: which subjects passed QC and
              why, what software version was used, and what acquisition parameters were applied. The
              Manifest module captures all of this from your project's existing data, saving hours
              of manual documentation per study.
            </Text>
          </Alert>

          <Accordion variant="separated" data-testid="manifest-accordion">
            <Accordion.Item value="qc-triage">
              <Accordion.Control
                icon={<IconListCheck size={16} color="var(--mantine-color-teal-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  5.1 Subject-Level QC Triage
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  The QC Selection table presents every subject-session in your cohort alongside the
                  key quality metrics computed by ExploreASL during Population processing:
                </Text>
                <div style={{ fontSize: "0.875rem" }}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      <strong>Spatial CoV (sCoV):</strong> Coefficient of Variation of the CBF map —
                      a high sCoV typically indicates poor ASL signal quality or motion corruption.
                    </li>
                    <li>
                      <strong>Temporal SNR (tSNR):</strong> Signal-to-noise ratio across the ASL
                      time series — low tSNR may reflect excessive head motion or scanner
                      instability.
                    </li>
                    <li>
                      <strong>Mean CBF:</strong> Whole-brain mean perfusion in mL/100g/min — values
                      far outside the physiological range (roughly 30–80) may flag processing
                      failures or pathological outliers.
                    </li>
                  </ul>
                </div>
                <Text size="sm" mt="sm" mb="xs">
                  For each subject-session you assign one of four verdicts:
                </Text>
                <div style={{ fontSize: "0.875rem" }}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      <strong>Pass</strong> — data are acceptable for inclusion in the final
                      analysis.
                    </li>
                    <li>
                      <strong>Fail</strong> — data are excluded; the reason is recorded in the
                      manifest.
                    </li>
                    <li>
                      <strong>No Info</strong> — subject is excluded due to missing or unprocessable
                      data (e.g., DICOM conversion failure, missing T1w).
                    </li>
                    <li>
                      <strong>Neutral</strong> — undecided; the GUI will not allow you to advance
                      until every session has a resolved verdict, ensuring no subject is
                      accidentally overlooked.
                    </li>
                  </ul>
                </div>
                <Alert
                  color="blue"
                  title="Tip"
                  variant="light"
                  icon={<IconHelpCircle size={16} />}
                  mt="xs"
                >
                  <Text size="xs">
                    Verdicts are saved automatically to your <code>project.easl</code> file as you
                    work, so you can close and reopen the project without losing your triage
                    decisions.
                  </Text>
                </Alert>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="manifest-sections">
              <Accordion.Control
                icon={<IconFileReport size={16} color="var(--mantine-color-teal-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  5.2 The Four Manifest Sections
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  The generated manifest document is divided into four standardized sections,
                  mirroring the information that journals such as <em>NeuroImage</em> request in the
                  Methods and Supplementary Material:
                </Text>
                <div style={{ fontSize: "0.875rem" }}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      <strong>Study Parameters:</strong> A human-readable summary of your{" "}
                      <code>dataPar.json</code> configuration — acquisition parameters (PLD,
                      labeling duration, M0 type), processing quality level, atlas selection, and
                      any advanced overrides. This corresponds directly to the{" "}
                      <em>"Data acquisition"</em> and <em>"Image processing"</em> subsections of a
                      typical Methods section.
                    </li>
                    <li>
                      <strong>Software Manifest:</strong> Records the exact ExploreASL version
                      (including Git commit hash when available), the GUI version, MATLAB version,
                      and the host operating system. Sufficient for a reviewer to reproduce your
                      environment.
                    </li>
                    <li>
                      <strong>QC Summary:</strong> Tabulates pass/fail/no-info counts per
                      subject-session with the assigned verdict and the quantitative metrics that
                      informed the decision. Suitable for a Supplementary Table in a journal
                      submission.
                    </li>
                    <li>
                      <strong>Pipeline Summary:</strong> A high-level narrative of the processing
                      steps executed, including which ExploreASL modules ran, the multiprocessing
                      configuration, and the date the pipeline was completed.
                    </li>
                  </ul>
                </div>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="manifest-export">
              <Accordion.Control
                icon={<IconFileText size={16} color="var(--mantine-color-teal-filled)" />}
              >
                <Title order={3} style={{ fontSize: "1rem" }} component="h2">
                  5.3 Export Formats
                </Title>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="xs">
                  The Preview &amp; Export step shows a live rendered preview of the manifest before
                  writing anything to disk. You can export to two formats:
                </Text>
                <div style={{ fontSize: "0.875rem" }}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      <strong>Markdown (.md):</strong> Plain-text format with lightweight
                      formatting. Can be pasted directly into GitHub READMEs, OSF repositories, or
                      supplementary files submitted alongside a manuscript. Rendered by most
                      code-hosting and preprint platforms.
                    </li>
                    <li>
                      <strong>HTML (.html):</strong> A self-contained, browser-viewable document
                      with full styling. Suitable for attaching as a standalone supplementary file
                      to a journal submission or sharing with collaborators via email.
                    </li>
                  </ul>
                </div>
                <Alert
                  color="teal"
                  title="Reproducibility tip"
                  variant="light"
                  icon={<IconHelpCircle size={16} />}
                  mt="xs"
                >
                  <Text size="xs">
                    Archive both the exported manifest <em>and</em> your <code>project.easl</code>{" "}
                    file alongside your dataset (e.g., on OSF or Zenodo). Together they provide a
                    complete, machine-readable record of every configuration decision and QC outcome
                    for your study.
                  </Text>
                </Alert>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>
      </Stack>
    </Stack>
  );
}
